//! Export Diagnostics, from Settings, About: every log Bomby writes, and a short summary,
//! in one zip on the user's Desktop ("Bomby Diagnostics 2026-11-10 18-05.zip"), shown in
//! Finder, for the user to attach to a bug report.
//!
//! The logs: `app.log` (app_log.rs), `agent.log` (agent.rs) and `livekit.log`
//! (local_server.rs), with any other `*.log`, from the app's log folder
//! (`~/Library/Logs/app.bomby.desktop`), and the adapters' `install.log` (adapters.rs). A
//! log that isn't there is left out and named in `diagnostics.txt`, never an error; one
//! that can't be read, or a log folder that can't be listed, is noted there too. A log over
//! `MAX_LOG_BYTES` keeps its end, where the latest run is.
//!
//! No log is meant to hold a secret (keys live in the keychain and the worker's
//! environment), but a library may print one, so every log is redacted on its way into the
//! zip (`Redactor`): every key, secret and token the core has held this run, word for word
//! and JSON-escaped, current or since replaced (`Vault::secrets_this_run`,
//! `LocalServer::secrets_this_run`), then anything shaped like a key or token. That is all it
//! promises: anything else stays as logged, so the summary asks the user to look the logs
//! over before sharing them publicly.
//!
//! One export runs at a time (`Exports`), off the async runtime. Each writes a hidden
//! temporary file of its own, then links it to the first free name, never over a file.

use std::borrow::Cow;
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{LazyLock, Mutex};

use aho_corasick::{AhoCorasick, MatchKind};
use chrono::{DateTime, Datelike, Local, Timelike};
use regex::{Captures, Regex};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::credentials::Vault;
use crate::error::{Error, Result};
use crate::local_server::{self, LocalServer};
use crate::{adapters, agent, app_log, sync};

/// The logs the core writes in the app's log folder, always named in the summary.
const KNOWN_LOGS: [&str; 3] = [app_log::LOG_FILE, agent::LOG_FILE, local_server::LOG_FILE];
/// The zip's folder for the adapters' log.
const ADAPTERS_FOLDER: &str = "adapters";
/// What a log over this keeps: its last 8 MiB.
const MAX_LOG_BYTES: u64 = 8 * 1024 * 1024;
/// What stands in for a secret.
const REDACTED: &str = "[redacted]";
/// Shorter values aren't taken out word for word: they'd match ordinary text.
const MIN_SECRET_LEN: usize = 8;
/// How many names (`<stem>.zip`, `<stem> 2.zip`, ...) and temporary files to try.
const MAX_ATTEMPTS: u32 = 1000;

/// The zip that was written, for the page: its name, to show, and what to do when Finder
/// couldn't show it (the zip is saved all the same). Its path stays in the core.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "about.ts"))]
pub struct DiagnosticsExport {
    pub file_name: String,
    pub finder_error: Option<String>,
}

/// What the page says when Finder can't show the zip.
const FINDER_FAILED: &str = "Finder couldn't show the file. Look on your Desktop.";

/// Exports, one at a time, and the last zip written this run, for Show in Finder; the page
/// never sends a path. Tauri state.
#[derive(Default)]
pub struct Exports {
    /// Held for a whole export.
    running: Mutex<()>,
    last: Mutex<Option<PathBuf>>,
}

impl Exports {
    /// Runs `export` once no other export is running.
    fn one_at_a_time<T>(&self, export: impl FnOnce() -> T) -> T {
        let _one = sync::lock(&self.running);
        export()
    }
}

/// Writes the zip to the Desktop, then shows it in Finder. Reading and zipping the logs
/// blocks, so it runs on a blocking thread, as `adapters::install_adapters` does.
#[tauri::command]
pub async fn export_diagnostics<R: Runtime>(app: AppHandle<R>) -> Result<DiagnosticsExport> {
    tauri::async_runtime::spawn_blocking(move || {
        let exports = app.state::<Exports>();
        exports.one_at_a_time(|| {
            // The raw error goes to app.log; the page gets what to do.
            let path =
                export(&app, &app.state::<Vault>(), &app.state::<LocalServer>()).map_err(|e| {
                    let _ = app_log::append(&app, &format!("export diagnostics: {e}"));
                    Error::Invalid(
                        "Bomby couldn't save the diagnostics to your Desktop. Try again?".into(),
                    )
                })?;
            // Saved is saved: Finder failing to show it is said, not an error.
            let finder_error = reveal(&app, &path).err();
            let file_name = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            *sync::lock(&exports.last) = Some(path);
            Ok(DiagnosticsExport {
                file_name,
                finder_error,
            })
        })
    })
    .await?
}

/// Shows the last zip in Finder again.
#[tauri::command(async)]
pub fn show_diagnostics<R: Runtime>(app: AppHandle<R>, exports: State<'_, Exports>) -> Result<()> {
    let path = sync::lock(&exports.last)
        .clone()
        .filter(|path| path.is_file())
        .ok_or_else(|| {
            Error::Invalid("The diagnostics file isn't there any more. Export it again.".into())
        })?;
    reveal(&app, &path).map_err(Error::Invalid)
}

/// Shows `path` in Finder. The cause goes to app.log; the page gets what to do.
fn reveal<R: Runtime>(app: &AppHandle<R>, path: &Path) -> std::result::Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| {
        let _ = app_log::append(app, &format!("show diagnostics in Finder: {e}"));
        FINDER_FAILED.to_owned()
    })
}

fn export<R: Runtime>(app: &AppHandle<R>, vault: &Vault, server: &LocalServer) -> Result<PathBuf> {
    let desktop = app.path().desktop_dir()?;
    let mut secrets = vault.secrets_this_run();
    secrets.extend(server.secrets_this_run());
    let redactor = Redactor::new(&secrets)?;
    let now = Local::now();
    let summary = Summary {
        version: app.package_info().version.to_string(),
        build: if cfg!(debug_assertions) {
            "development"
        } else {
            "release"
        },
        macos: macos_version(),
        arch: std::env::consts::ARCH,
        created: now.format("%Y-%m-%d %H:%M:%S %:z").to_string(),
    };
    let logs = sources(&app.path().app_log_dir()?, adapters::install_log());
    write_bundle(&desktop, now, &logs, &redactor, &summary)
}

/// One log to collect: its name in the zip and where it is.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Source {
    name: String,
    path: PathBuf,
}

/// The logs to collect, and what listing them ran into, for the summary.
#[derive(Debug, Default)]
struct Logs {
    sources: Vec<Source>,
    notes: Vec<String>,
}

/// The known logs, any other `*.log` in the log folder, then the adapters' log. A log
/// folder that isn't there yet holds no other logs; one that can't be listed is noted.
fn sources(log_dir: &Path, install_log: Option<PathBuf>) -> Logs {
    let mut notes = Vec::new();
    let mut others: Vec<String> = Vec::new();
    match fs::read_dir(log_dir) {
        Ok(entries) => {
            for entry in entries {
                match entry {
                    Ok(entry) => {
                        let name = entry.file_name().to_string_lossy().into_owned();
                        if name.ends_with(".log")
                            && !KNOWN_LOGS.contains(&name.as_str())
                            && entry.file_type().is_ok_and(|kind| kind.is_file())
                        {
                            others.push(name);
                        }
                    }
                    Err(e) => notes.push(format!("A file in the log folder couldn't be read: {e}")),
                }
            }
        }
        Err(e) if e.kind() == ErrorKind::NotFound => {}
        Err(e) => notes.push(format!(
            "The log folder couldn't be listed, so only the known logs were looked for: {e}"
        )),
    }
    others.sort();
    let mut sources: Vec<Source> = KNOWN_LOGS
        .iter()
        .map(|&name| name.to_owned())
        .chain(others)
        .map(|name| Source {
            path: log_dir.join(&name),
            name,
        })
        .collect();
    if let Some(path) = install_log {
        sources.push(Source {
            name: format!("{ADAPTERS_FOLDER}/{}", adapters::LOG_FILE),
            path,
        });
    }
    Logs { sources, notes }
}

/// What `diagnostics.txt` says about this Mac and this copy of Bomby.
struct Summary {
    version: String,
    build: &'static str,
    macos: String,
    arch: &'static str,
    created: String,
}

/// What collecting found, for the summary.
#[derive(Debug, Default, PartialEq, Eq)]
struct Collected {
    included: Vec<String>,
    missing: Vec<String>,
    trimmed: Vec<String>,
    notes: Vec<String>,
}

/// Writes the zip into `dir` under a name that's free, through a hidden temporary file of
/// its own so Finder never shows half of one, and never over another file.
fn write_bundle(
    dir: &Path,
    now: DateTime<Local>,
    logs: &Logs,
    redactor: &Redactor,
    summary: &Summary,
) -> Result<PathBuf> {
    let stem = file_stem(now);
    let (partial, file) = create_partial(dir, &stem)?;
    let written =
        write_zip(file, now, logs, redactor, summary).and_then(|()| publish(&partial, dir, &stem));
    // Published or not, the temporary name goes; the zip keeps its own.
    let _ = fs::remove_file(&partial);
    written
}

/// A new hidden file beside where the zip goes, created exclusively, so two exports never
/// write the same one.
fn create_partial(dir: &Path, stem: &str) -> Result<(PathBuf, File)> {
    let pid = std::process::id();
    for attempt in 0..MAX_ATTEMPTS {
        let path = dir.join(format!(".{stem} {pid}-{attempt}.partial"));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.into()),
        }
    }
    Err(Error::Invalid(
        "No free name for the diagnostics' temporary file.".into(),
    ))
}

/// Gives the finished zip at `partial` the first free name of `<stem>.zip`, `<stem> 2.zip`
/// and on, as Finder names copies. A hard link fails rather than replace a file, so a name
/// taken meanwhile (another export, the user's file) is skipped, never overwritten.
fn publish(partial: &Path, dir: &Path, stem: &str) -> Result<PathBuf> {
    for copy in 1..=MAX_ATTEMPTS {
        let path = dir.join(zip_name(stem, copy));
        match fs::hard_link(partial, &path) {
            Ok(()) => return Ok(path),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.into()),
        }
    }
    Err(Error::Invalid(
        "No free name for the diagnostics on the Desktop.".into(),
    ))
}

/// `<stem>.zip`, then `<stem> 2.zip` and on.
fn zip_name(stem: &str, copy: u32) -> String {
    if copy <= 1 {
        format!("{stem}.zip")
    } else {
        format!("{stem} {copy}.zip")
    }
}

fn write_zip(
    file: File,
    now: DateTime<Local>,
    logs: &Logs,
    redactor: &Redactor,
    summary: &Summary,
) -> Result<()> {
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .last_modified_time(zip_time(now))
        .unix_permissions(0o644);
    let mut collected = Collected {
        notes: logs.notes.clone(),
        ..Collected::default()
    };
    for log in &logs.sources {
        let (text, trimmed) = match read_log(&log.path) {
            Ok(Some(read)) => read,
            Ok(None) => {
                collected.missing.push(log.name.clone());
                continue;
            }
            Err(e) => {
                collected
                    .notes
                    .push(format!("{} couldn't be read: {e}", log.name));
                continue;
            }
        };
        zip.start_file(&log.name, options)?;
        zip.write_all(redactor.redact(&text).as_bytes())?;
        collected.included.push(log.name.clone());
        if trimmed {
            collected.trimmed.push(log.name.clone());
        }
    }
    zip.start_file("diagnostics.txt", options)?;
    let text = summary_text(summary, &collected);
    zip.write_all(redactor.redact(&text).as_bytes())?;
    zip.finish()?.sync_all()?;
    Ok(())
}

/// A log's text, and whether it was trimmed to its end; `None` when it isn't there.
fn read_log(path: &Path) -> Result<Option<(String, bool)>> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Ok(None);
    }
    let len = metadata.len();
    let trimmed = len > MAX_LOG_BYTES;
    if trimmed {
        file.seek(SeekFrom::Start(len - MAX_LOG_BYTES))?;
    }
    let mut bytes = Vec::new();
    file.take(MAX_LOG_BYTES).read_to_end(&mut bytes)?;
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if trimmed {
        // Start at a whole line.
        if let Some(newline) = text.find('\n') {
            text.drain(..=newline);
        }
    }
    Ok(Some((text, trimmed)))
}

fn summary_text(summary: &Summary, collected: &Collected) -> String {
    let list = |names: &[String]| {
        if names.is_empty() {
            "none".to_owned()
        } else {
            names.join(", ")
        }
    };
    let mut text = format!(
        "Bomby diagnostics\n\n\
         Version: {}\n\
         Build: {}\n\
         macOS: {}\n\
         Architecture: {}\n\
         Created: {}\n\n\
         Included: {}\n\
         Missing: {}\n",
        summary.version,
        summary.build,
        summary.macos,
        summary.arch,
        summary.created,
        list(&collected.included),
        list(&collected.missing),
    );
    if !collected.trimmed.is_empty() {
        text.push_str(&format!(
            "Trimmed to their last {} MiB: {}\n",
            MAX_LOG_BYTES / 1024 / 1024,
            list(&collected.trimmed)
        ));
    }
    for note in &collected.notes {
        text.push_str(&format!("Note: {note}\n"));
    }
    text.push_str(
        "\nThe keys, secrets and tokens Bomby held this run, and text shaped like a key or \
         token, are replaced with [redacted]. Everything else is as logged, such as folder \
         names and what was said on a call: look the logs over before you share them \
         publicly.\n",
    );
    text
}

/// "Bomby Diagnostics 2026-11-10 18-05", in the Mac's local time.
fn file_stem(now: DateTime<Local>) -> String {
    format!("Bomby Diagnostics {}", now.format("%Y-%m-%d %H-%M"))
}

fn zip_time(now: DateTime<Local>) -> zip::DateTime {
    let part = |value: u32| u8::try_from(value).unwrap_or(0);
    zip::DateTime::from_date_and_time(
        u16::try_from(now.year()).unwrap_or(1980),
        part(now.month()),
        part(now.day()),
        part(now.hour()),
        part(now.minute()),
        part(now.second()),
    )
    .unwrap_or_default()
}

/// "26.1 (25B78)" from `sw_vers`, or "unknown".
fn macos_version() -> String {
    let read = |flag: &str| {
        Command::new("sw_vers")
            .arg(flag)
            .output()
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
            .filter(|value| !value.is_empty())
    };
    match (read("-productVersion"), read("-buildVersion")) {
        (Some(version), Some(build)) => format!("{version} ({build})"),
        (Some(version), None) => version,
        _ => "unknown".to_owned(),
    }
}

/// Shapes of secrets, each replaced whole, in one pattern.
static SHAPES: LazyLock<Regex> = LazyLock::new(|| {
    let shapes = [
        // JSON Web Tokens: LiveKit's call tokens, OAuth ID and access tokens.
        r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*",
        // Google API keys.
        r"\bAIza[0-9A-Za-z_-]{30,}",
        // OpenAI and other `sk-` keys.
        r"\bsk-[A-Za-z0-9_-]{16,}",
        // The local LiveKit server's secret, 32 bytes in hex (local_server.rs).
        r"\b[0-9a-fA-F]{64}\b",
        // Authorization headers.
        r"(?i:\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,})",
    ];
    Regex::new(&shapes.map(|shape| format!("(?:{shape})")).join("|")).expect("a valid pattern")
});

/// `name=value`, `name: value`, `"name": "value"` and the same JSON-escaped inside a JSON
/// string (`\"name\": \"value\"`, as LiveKit Agents' JSON log lines hold a message), where
/// the name says it's secret. A quoted value goes whole, spaces, escaped quotes and all.
static NAMED: LazyLock<Regex> = LazyLock::new(|| {
    let quoted: Vec<String> = (0..=MAX_ESCAPE_DEPTH).map(quoted_at).collect();
    Regex::new(&format!(
        "{}{}({}|{}|{})",
        r"(?i)\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|password|passwd|authorization|credential)[A-Za-z0-9_.-]*)",
        r#"(\\*["']?\s*[:=]\s*)"#,
        // A double-quoted string, plain or JSON-escaped inside a JSON string.
        quoted.join("|"),
        // Single-quoted string (Python's repr), with escapes.
        r"'(?:[^'\\\n]|\\.)*'",
        // A bare value.
        r#"[^\s"'\\&,;)}\]]+"#,
    ))
    .expect("a valid pattern")
});

/// How deep a JSON string inside JSON strings `NAMED` reads: 0 is a plain `"..."`, 1 one
/// inside a JSON string (`\"...\"`), 2 one more (`\\\"...\\\"`), and 3.
const MAX_ESCAPE_DEPTH: u32 = 3;

/// A double-quoted JSON string `depth` JSON strings deep, whole. Its quotes are
/// `2^depth - 1` backslashes and a `"`. Inside it, a quote of its own is escaped once more,
/// so it reads with `2^(depth + 1) - 1` backslashes, and escaped backslashes add
/// `2^(depth + 1)` at a time: counting a run of backslashes before a `"` tells an escaped
/// quote inside the value from the one that closes it. Every part but a quote ends on a
/// character that is neither, so a run is always counted whole.
fn quoted_at(depth: u32) -> String {
    let quote = (1usize << depth) - 1;
    let pair = 1usize << (depth + 1);
    let run = |count: usize| {
        if count == 0 {
            String::new()
        } else {
            format!(r"\\{{{count}}}")
        }
    };
    let pairs = format!(r"(?:\\{{{pair}}})*");
    let delimiter = format!(r#"{pairs}{}""#, run(quote));
    let inner_quote = format!(r#"{pairs}{}""#, run(pair - 1));
    format!(
        r#"{}"(?:[^"\\]|\\+[^"\\]|{inner_quote})*{delimiter}"#,
        run(quote)
    )
}

/// Whether a name counts something ("tokens", "prompt_tokens", "token_count"): its number
/// stays. Any other name's value goes, numbers too.
fn is_counter(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.ends_with("tokens") || name.ends_with("token_count")
}

/// `NAMED`'s replacement: the value goes, its quotes stay.
fn redact_named(caps: &Captures<'_>) -> String {
    let (name, separator, value) = (&caps[1], &caps[2], &caps[3]);
    let open = value
        .find(['"', '\''])
        .filter(|_| value.starts_with(['"', '\'', '\\']))
        .map_or(0, |at| at + 1);
    // A quoted value closes as it opens.
    let close = if open == 0 {
        value.len()
    } else {
        (value.len() - open).max(open)
    };
    let inner = &value[open..close];
    let keep = inner.is_empty()
        // What's already out: a bare value stops before `]`, so it reads "[redacted".
        || inner.starts_with(REDACTED.trim_end_matches(']'))
        || (open == 0 && is_counter(name) && inner.chars().all(|c| c.is_ascii_digit()));
    if keep {
        caps[0].to_owned()
    } else {
        format!(
            "{name}{separator}{}{REDACTED}{}",
            &value[..open],
            &value[close..]
        )
    }
}

/// `text` with `replace`'s change, borrowed still when it changed nothing (a match it kept,
/// such as a count, changes nothing).
fn apply<'a>(text: Cow<'a, str>, replace: impl FnOnce(&str) -> Cow<'_, str>) -> Cow<'a, str> {
    let changed = match replace(&text) {
        Cow::Owned(changed) if changed != *text => Some(changed),
        _ => None,
    };
    changed.map_or(text, Cow::Owned)
}

/// Takes secrets out of text: built once per export.
struct Redactor {
    /// The known secrets, longest first where they overlap; `None` when there are none.
    known: Option<AhoCorasick>,
}

impl Redactor {
    /// Matches each secret as is and JSON-escaped, once and twice (a JSON log line's
    /// message holding JSON).
    fn new(secrets: &[String]) -> Result<Self> {
        let mut forms: Vec<String> = Vec::new();
        for secret in secrets.iter().map(|secret| secret.trim()) {
            if secret.chars().count() < MIN_SECRET_LEN {
                continue;
            }
            let once = json_escaped(secret);
            let twice = json_escaped(&once);
            forms.extend([secret.to_owned(), once, twice]);
        }
        forms.sort();
        forms.dedup();
        if forms.is_empty() {
            return Ok(Self { known: None });
        }
        let known = AhoCorasick::builder()
            .match_kind(MatchKind::LeftmostLongest)
            .build(&forms)
            .map_err(|e| Error::Invalid(format!("Couldn't prepare the redaction: {e}")))?;
        Ok(Self { known: Some(known) })
    }

    /// `text` with the known secrets, and anything shaped like one, replaced by
    /// `[redacted]`; borrowed when there was nothing to take out.
    fn redact<'a>(&self, text: &'a str) -> Cow<'a, str> {
        let mut out = Cow::Borrowed(text);
        if let Some(known) = &self.known
            && known.is_match(text)
        {
            let mut replaced = String::with_capacity(text.len());
            known.replace_all_with(text, &mut replaced, |_, _, dst| {
                dst.push_str(REDACTED);
                true
            });
            out = Cow::Owned(replaced);
        }
        out = apply(out, |text| SHAPES.replace_all(text, REDACTED));
        apply(out, |text| NAMED.replace_all(text, redact_named))
    }
}

/// `value` as it reads inside a JSON string, without the quotes.
fn json_escaped(value: &str) -> String {
    let quoted = serde_json::to_string(value).unwrap_or_default();
    quoted
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(value)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("bomby-diagnostics-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn at(hour: u32, minute: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(2026, 11, 10, hour, minute, 7)
            .unwrap()
    }

    fn summary() -> Summary {
        Summary {
            version: "0.2.0".into(),
            build: "release",
            macos: "26.1 (25B78)".into(),
            arch: "aarch64",
            created: "2026-11-10 18:05:07 +01:00".into(),
        }
    }

    fn entries(path: &Path) -> Vec<(String, String)> {
        let mut archive = zip::ZipArchive::new(File::open(path).unwrap()).unwrap();
        (0..archive.len())
            .map(|i| {
                let mut file = archive.by_index(i).unwrap();
                let mut text = String::new();
                file.read_to_string(&mut text).unwrap();
                (file.name().unwrap().into_owned(), text)
            })
            .collect()
    }

    fn redact(text: &str, secrets: &[String]) -> String {
        Redactor::new(secrets).unwrap().redact(text).into_owned()
    }

    fn none() -> Redactor {
        Redactor::new(&[]).unwrap()
    }

    #[test]
    fn the_name_is_the_local_minute_and_a_taken_one_gets_a_number_never_overwritten() {
        let dir = temp_dir("naming");
        let stem = file_stem(at(8, 5));
        assert_eq!(stem, "Bomby Diagnostics 2026-11-10 08-05");
        fs::write(dir.join(format!("{stem}.zip")), "the user's own").unwrap();
        fs::write(dir.join(format!("{stem} 2.zip")), "an earlier export").unwrap();
        let path = write_bundle(&dir, at(8, 5), &Logs::default(), &none(), &summary()).unwrap();
        assert_eq!(path, dir.join(format!("{stem} 3.zip")));
        assert_eq!(
            fs::read_to_string(dir.join(format!("{stem}.zip"))).unwrap(),
            "the user's own"
        );
        assert_eq!(
            fs::read_to_string(dir.join(format!("{stem} 2.zip"))).unwrap(),
            "an earlier export"
        );
        assert_eq!(entries(&path).len(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn overlapping_exports_each_get_their_own_file_and_name() {
        let dir = temp_dir("overlap");
        let logs = temp_dir("overlap-logs");
        fs::write(logs.join("app.log"), "x\n".repeat(200_000)).unwrap();
        let exports = Exports::default();
        let running = std::sync::atomic::AtomicUsize::new(0);
        let paths: Vec<PathBuf> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..4)
                .map(|_| {
                    scope.spawn(|| {
                        exports.one_at_a_time(|| {
                            let at_once = running.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                            assert_eq!(at_once, 0, "one export at a time");
                            let path = write_bundle(
                                &dir,
                                at(9, 30),
                                &sources(&logs, None),
                                &none(),
                                &summary(),
                            );
                            running.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                            path.unwrap()
                        })
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        let mut names: Vec<String> = paths
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        names.sort();
        let stem = file_stem(at(9, 30));
        let mut expected = [1, 2, 3, 4].map(|copy| zip_name(&stem, copy)).to_vec();
        expected.sort();
        assert_eq!(names, expected);
        for path in &paths {
            assert_eq!(entries(path).len(), 2, "{} is whole", path.display());
        }
        // No temporary file is left.
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 4);
        fs::remove_dir_all(&dir).unwrap();
        fs::remove_dir_all(&logs).unwrap();
    }

    #[test]
    fn writing_without_the_guard_never_shares_a_temporary_file_or_clobbers_a_name() {
        let dir = temp_dir("race");
        let paths: Vec<PathBuf> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..8)
                .map(|_| {
                    scope.spawn(|| {
                        write_bundle(&dir, at(10, 0), &Logs::default(), &none(), &summary())
                            .unwrap()
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        let mut unique = paths.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), 8);
        for path in &paths {
            assert_eq!(entries(path).len(), 1);
        }
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 8);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sources_are_the_known_logs_then_other_logs_then_the_install_log() {
        let dir = temp_dir("sources");
        fs::write(dir.join("zeta.log"), "z").unwrap();
        fs::write(dir.join("notes.txt"), "not a log").unwrap();
        fs::create_dir(dir.join("folder.log")).unwrap();
        let listed = sources(&dir, Some(dir.join("install.log")));
        assert!(listed.notes.is_empty());
        let names: Vec<String> = listed
            .sources
            .into_iter()
            .map(|source| source.name)
            .collect();
        assert_eq!(
            names,
            [
                "app.log",
                "agent.log",
                "livekit.log",
                "zeta.log",
                "adapters/install.log"
            ]
        );
        // A log folder not made yet holds only the known logs, with nothing to note.
        let gone = sources(&dir.join("gone"), None);
        assert_eq!(gone.sources.len(), KNOWN_LOGS.len());
        assert!(gone.notes.is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_log_folder_that_cant_be_listed_is_noted_in_the_summary() {
        let dir = temp_dir("unlistable");
        // A file where the folder should be: listing it fails, and not with NotFound.
        let not_a_folder = dir.join("logs");
        fs::write(&not_a_folder, "").unwrap();
        let logs = sources(&not_a_folder, None);
        assert_eq!(logs.sources.len(), KNOWN_LOGS.len());
        assert_eq!(logs.notes.len(), 1, "{:?}", logs.notes);
        let path = write_bundle(&dir, at(11, 0), &logs, &none(), &summary()).unwrap();
        let text = &entries(&path)[0].1;
        assert!(
            text.contains("Note: The log folder couldn't be listed"),
            "{text}"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_logs_are_left_out_and_named_in_the_summary() {
        let logs = temp_dir("missing-logs");
        let out = temp_dir("missing-out");
        fs::write(logs.join("app.log"), "1 started\n").unwrap();
        let path = write_bundle(
            &out,
            at(18, 5),
            &sources(&logs, Some(logs.join("install.log"))),
            &none(),
            &summary(),
        )
        .unwrap();

        assert_eq!(path, out.join("Bomby Diagnostics 2026-11-10 18-05.zip"));
        let entries = entries(&path);
        let names: Vec<&str> = entries.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, ["app.log", "diagnostics.txt"]);
        assert_eq!(entries[0].1, "1 started\n");
        let text = &entries[1].1;
        assert!(
            text.contains(
                "Version: 0.2.0\nBuild: release\nmacOS: 26.1 (25B78)\nArchitecture: aarch64\n"
            ),
            "{text}"
        );
        assert!(text.contains("Included: app.log\n"), "{text}");
        assert!(
            text.contains("Missing: agent.log, livekit.log, adapters/install.log\n"),
            "{text}"
        );
        // Nothing half-written is left beside it.
        assert_eq!(fs::read_dir(&out).unwrap().count(), 1);
        fs::remove_dir_all(&logs).unwrap();
        fs::remove_dir_all(&out).unwrap();
    }

    #[test]
    fn with_no_logs_at_all_the_zip_still_has_its_summary() {
        let out = temp_dir("no-logs");
        let path = write_bundle(
            &out,
            at(9, 0),
            &sources(&out.join("none"), None),
            &none(),
            &summary(),
        )
        .unwrap();
        let entries = entries(&path);
        assert_eq!(entries.len(), 1);
        assert!(entries[0].1.contains("Included: none\n"));
        fs::remove_dir_all(&out).unwrap();
    }

    #[test]
    fn a_long_log_keeps_its_end_from_a_whole_line() {
        let dir = temp_dir("long");
        let path = dir.join("app.log");
        let line = "x".repeat(1023) + "\n";
        let mut text = line.repeat(usize::try_from(MAX_LOG_BYTES / 1024).unwrap() + 4);
        text.push_str("the end\n");
        fs::write(&path, &text).unwrap();
        let (kept, trimmed) = read_log(&path).unwrap().unwrap();
        assert!(trimmed);
        assert!(kept.starts_with('x') && kept.ends_with("the end\n"));
        assert!(kept.len() as u64 <= MAX_LOG_BYTES);
        assert_eq!(kept.len() % 1024, "the end\n".len());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn logs_lose_known_secrets_and_anything_shaped_like_one() {
        let secrets = vec!["rime-key-0123456789".to_owned(), "short".to_owned()];
        let text = [
            "voice key rime-key-0123456789 in use",
            "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib21ieSJ9.c2lnbmF0dXJl",
            "gemini AIzaSyA0123456789abcdefghijklmnopqrstu",
            "openai sk-proj-abcdefghijklmnop0123",
            "keys bomby: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "Authorization: Bearer abc.def.ghi-123456",
            "wss://host/rtc?access_token=abc123xyz&auto_subscribe=1",
            r#"{"api_key": "zep-abc123456", "zep_api_key":"z_abcdefgh"}"#,
            "LIVEKIT_API_SECRET=supersecretvalue",
            "a short word, tokens=1234, prompt_tokens: 56",
            r#"{"password": ""}"#,
        ]
        .join("\n");
        let out = redact(&text, &secrets);
        for leaked in [
            "rime-key-0123456789",
            "eyJhbGci",
            "AIzaSy",
            "sk-proj",
            "0123456789abcdef0123",
            "abc.def.ghi",
            "abc123xyz",
            "zep-abc123456",
            "z_abcdefgh",
            "supersecretvalue",
        ] {
            assert!(!out.contains(leaked), "{leaked} leaked:\n{out}");
        }
        assert!(out.contains("voice key [redacted] in use"), "{out}");
        assert!(
            out.contains("access_token=[redacted]&auto_subscribe=1"),
            "{out}"
        );
        assert!(out.contains("LIVEKIT_API_SECRET=[redacted]"), "{out}");
        // Ordinary words, short values and counts stay.
        assert!(
            out.contains("a short word, tokens=1234, prompt_tokens: 56"),
            "{out}"
        );
        // An empty value has nothing to hide.
        assert!(out.contains(r#"{"password": ""}"#), "{out}");
    }

    #[test]
    fn redacting_twice_changes_nothing_more() {
        let text = [
            "secret=abcdefgh and Bearer abcdefghijkl",
            r#"{"password": "alpha beta"}"#,
            r#"{"message": "{\"api_key\": \"zep-abc123456\"}"}"#,
            "known-secret-123 again",
        ]
        .join("\n");
        let secrets = ["known-secret-123".to_owned()];
        let once = redact(&text, &secrets);
        assert_eq!(redact(&once, &secrets), once);
    }

    #[test]
    fn text_with_nothing_to_take_out_is_borrowed_not_copied() {
        let redactor = Redactor::new(&["known-secret-123".to_owned()]).unwrap();
        let text = "1 started\n2 tokens=1234\n";
        assert!(matches!(redactor.redact(text), Cow::Borrowed(_)));
        assert!(matches!(none().redact(text), Cow::Borrowed(_)));
        assert!(matches!(redactor.redact("known-secret-123"), Cow::Owned(_)));
    }

    #[test]
    fn secrets_replaced_earlier_in_the_run_are_still_taken_out() {
        // What the vault and the local server hand over: current and earlier secrets.
        let secrets = [
            "gemini-key-old-0123".to_owned(),
            "gemini-key-new-4567".to_owned(),
            "refresh-token-gone-89".to_owned(),
            "gemini-key-old-0123".to_owned(),
        ];
        let out = redact(
            "started with gemini-key-old-0123\nthen gemini-key-new-4567\nrefresh refresh-token-gone-89\n",
            &secrets,
        );
        assert_eq!(
            out,
            "started with [redacted]\nthen [redacted]\nrefresh [redacted]\n"
        );
    }

    #[test]
    fn known_secrets_are_taken_out_json_escaped_too() {
        let secrets = [r#"pa"ss\word-123"#.to_owned()];
        let raw = r#"key pa"ss\word-123"#;
        let once = r#"{"message": "key pa\"ss\\word-123"}"#;
        let twice = r#"{"message": "{\"m\": \"key pa\\\"ss\\\\word-123\"}"}"#;
        for text in [raw, once, twice] {
            let out = redact(text, &secrets);
            assert!(!out.contains("word-123"), "{text} became {out}");
            assert!(out.contains(REDACTED), "{out}");
        }
    }

    #[test]
    fn named_values_in_escaped_json_go() {
        // LiveKit Agents logs JSON, with a message that is itself JSON.
        let line = r#"{"message": "config {\"api_key\": \"zep-abc123456\", \"zep_api_key\":\"z_abcdefgh\", \"model\": \"x\"}", "level": "INFO"}"#;
        let out = redact(line, &[]);
        assert_eq!(
            out,
            r#"{"message": "config {\"api_key\": \"[redacted]\", \"zep_api_key\":\"[redacted]\", \"model\": \"x\"}", "level": "INFO"}"#
        );
    }

    #[test]
    fn quoted_values_go_whole_spaces_and_all() {
        let out = redact(
            r#"{"password":"alpha beta gamma", "user": "me"} and {'secret': 'one two'} and api_secret="three four""#,
            &[],
        );
        assert_eq!(
            out,
            r#"{"password":"[redacted]", "user": "me"} and {'secret': '[redacted]'} and api_secret="[redacted]""#
        );
        assert!(!out.contains("beta") && !out.contains("two") && !out.contains("four"));
    }

    #[test]
    fn an_escaped_quote_inside_a_value_never_closes_it() {
        // A JSON-escaped line whose password holds an escaped quote: all of it goes.
        let out = redact(r#"{\"password\":\"alpha\\\" beta gamma\"}"#, &[]);
        assert_eq!(out, r#"{\"password\":\"[redacted]\"}"#);
        // The same in plain JSON, and in Python's repr.
        let out = redact(
            r#"{"password":"alpha\" beta gamma"} {'secret': 'one\' two'}"#,
            &[],
        );
        assert_eq!(out, r#"{"password":"[redacted]"} {'secret': '[redacted]'}"#);
    }

    #[test]
    fn a_value_goes_whole_at_every_depth_and_what_follows_stays() {
        // An escaped quote inside, an escaped backslash at the end, then another field.
        let wrap = |line: &str| format!(r#"{{"message": "{}"}}"#, json_escaped(line));
        let mut line = r#"{"password":"alpha\" beta\\", "user": "me"}"#.to_owned();
        let mut expected = r#"{"password":"[redacted]", "user": "me"}"#.to_owned();
        for depth in 0..=MAX_ESCAPE_DEPTH {
            let out = redact(&line, &[]);
            assert_eq!(out, expected, "depth {depth}");
            assert_eq!(redact(&out, &[]), out, "depth {depth} again");
            line = wrap(&line);
            expected = wrap(&expected);
        }
    }

    #[test]
    fn only_counters_keep_their_numbers() {
        let out = redact(
            "tokens=1234 prompt_tokens: 56 completion_tokens=7 token_count=8 \
             password=12345678 secret=87654321 api_secret: 11223344 \"pin_token\": 9999",
            &[],
        );
        assert_eq!(
            out,
            "tokens=1234 prompt_tokens: 56 completion_tokens=7 token_count=8 \
             password=[redacted] secret=[redacted] api_secret: [redacted] \"pin_token\": [redacted]"
        );
    }
}
