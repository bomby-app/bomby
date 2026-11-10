//! Export Diagnostics, from Settings, About: every log Bomby writes, and a short summary,
//! in one zip on the user's Desktop ("Bomby Diagnostics 2026-11-10 18-05.zip"), shown in
//! Finder, for the user to attach to a bug report.
//!
//! The logs: `app.log` (app_log.rs), `agent.log` (agent.rs) and `livekit.log`
//! (local_server.rs), with any other `*.log`, from the app's log folder
//! (`~/Library/Logs/app.bomby.desktop`), and the adapters' `install.log` (adapters.rs). A
//! log that isn't there is left out and named in `diagnostics.txt`, never an error. A log
//! over `MAX_LOG_BYTES` keeps its end, where the latest run is.
//!
//! No log is meant to hold a secret (keys live in the keychain and the worker's
//! environment), but a library may print one, so every line is redacted on its way into
//! the zip: the secrets the core has read this run, word for word, then anything shaped
//! like a key or token (`redact`).

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{LazyLock, Mutex};

use chrono::{DateTime, Datelike, Local, Timelike};
use regex::{Captures, Regex};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::credentials::Vault;
use crate::error::{Error, Result};
use crate::local_server::LocalServer;
use crate::{adapters, app_log, sync};

/// The logs the core writes in the app's log folder, always named in the summary.
const KNOWN_LOGS: [&str; 3] = ["app.log", "agent.log", "livekit.log"];
/// The adapters' log, in the zip's `adapters/` folder.
const INSTALL_LOG: &str = "adapters/install.log";
/// What a log over this keeps: its last 8 MiB.
const MAX_LOG_BYTES: u64 = 8 * 1024 * 1024;
/// What stands in for a secret.
const REDACTED: &str = "[redacted]";
/// Shorter values aren't taken out word for word: they'd match ordinary text.
const MIN_SECRET_LEN: usize = 8;

/// The zip that was written, for the page: its name, to show. Its path stays in the core.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "about.ts"))]
pub struct DiagnosticsExport {
    pub file_name: String,
}

/// The last zip written this run, for Show in Finder; the page never sends a path. Tauri state.
#[derive(Default)]
pub struct LastExport(Mutex<Option<PathBuf>>);

/// Writes the zip to the Desktop, then shows it in Finder.
#[tauri::command(async)]
pub fn export_diagnostics<R: Runtime>(
    app: AppHandle<R>,
    vault: State<'_, Vault>,
    server: State<'_, LocalServer>,
    last: State<'_, LastExport>,
) -> Result<DiagnosticsExport> {
    // The raw error goes to app.log; the page gets what to do.
    let path = export(&app, &vault, &server).map_err(|e| {
        let _ = app_log::append(&app, &format!("export diagnostics: {e}"));
        Error::Invalid("Bomby couldn't save the diagnostics to your Desktop. Try again?".into())
    })?;
    let _ = tauri_plugin_opener::reveal_item_in_dir(&path);
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    *sync::lock(&last.0) = Some(path);
    Ok(DiagnosticsExport { file_name })
}

/// Shows the last zip in Finder again.
#[tauri::command(async)]
pub fn show_diagnostics(last: State<'_, LastExport>) -> Result<()> {
    let path = sync::lock(&last.0)
        .clone()
        .filter(|path| path.is_file())
        .ok_or_else(|| {
            Error::Invalid("The diagnostics file isn't there any more. Export it again.".into())
        })?;
    tauri_plugin_opener::reveal_item_in_dir(&path)
        .map_err(|_| Error::Invalid("Finder couldn't show the file. Look on your Desktop.".into()))
}

fn export<R: Runtime>(app: &AppHandle<R>, vault: &Vault, server: &LocalServer) -> Result<PathBuf> {
    let desktop = app.path().desktop_dir()?;
    let mut secrets = vault.cached_secrets();
    secrets.extend(server.current().map(|keys| keys.api_secret));
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
    write_bundle(&desktop, now, &logs, &secrets, &summary)
}

/// One log to collect: its name in the zip and where it is.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Source {
    name: String,
    path: PathBuf,
}

/// The known logs, any other `*.log` in the log folder, then the adapters' log.
fn sources(log_dir: &Path, install_log: Option<PathBuf>) -> Vec<Source> {
    let mut names: Vec<String> = KNOWN_LOGS.iter().map(|&name| name.to_owned()).collect();
    let mut others: Vec<String> = fs::read_dir(log_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".log") && !KNOWN_LOGS.contains(&name.as_str()))
        .collect();
    others.sort();
    names.extend(others);
    let mut sources: Vec<Source> = names
        .into_iter()
        .map(|name| Source {
            path: log_dir.join(&name),
            name,
        })
        .collect();
    if let Some(path) = install_log {
        sources.push(Source {
            name: INSTALL_LOG.to_owned(),
            path,
        });
    }
    sources
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
}

/// Writes the zip into `dir` under a name that's free, through a hidden temporary file so
/// Finder never shows half of one.
fn write_bundle(
    dir: &Path,
    now: DateTime<Local>,
    logs: &[Source],
    secrets: &[String],
    summary: &Summary,
) -> Result<PathBuf> {
    let path = free_path(dir, &file_stem(now));
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let partial = dir.join(format!(".{file_name}.partial"));
    let written = write_zip(&partial, now, logs, secrets, summary)
        .and_then(|()| fs::rename(&partial, &path).map_err(Error::from));
    if written.is_err() {
        let _ = fs::remove_file(&partial);
    }
    written.map(|()| path)
}

fn write_zip(
    path: &Path,
    now: DateTime<Local>,
    logs: &[Source],
    secrets: &[String],
    summary: &Summary,
) -> Result<()> {
    let mut zip = ZipWriter::new(File::create(path)?);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .last_modified_time(zip_time(now))
        .unix_permissions(0o644);
    let mut collected = Collected::default();
    for log in logs {
        let Some((text, trimmed)) = read_log(&log.path)? else {
            collected.missing.push(log.name.clone());
            continue;
        };
        zip.start_file(&log.name, options)?;
        zip.write_all(redact(&text, secrets).as_bytes())?;
        collected.included.push(log.name.clone());
        if trimmed {
            collected.trimmed.push(log.name.clone());
        }
    }
    zip.start_file("diagnostics.txt", options)?;
    zip.write_all(redact(&summary_text(summary, &collected), secrets).as_bytes())?;
    zip.finish()?.sync_all()?;
    Ok(())
}

/// A log's text, and whether it was trimmed to its end; `None` when it isn't there.
fn read_log(path: &Path) -> Result<Option<(String, bool)>> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    if !file.metadata()?.is_file() {
        return Ok(None);
    }
    let len = file.metadata()?.len();
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
    text.push_str("\nKeys, secrets and tokens are replaced with [redacted].\n");
    text
}

/// "Bomby Diagnostics 2026-11-10 18-05", in the Mac's local time.
fn file_stem(now: DateTime<Local>) -> String {
    format!("Bomby Diagnostics {}", now.format("%Y-%m-%d %H-%M"))
}

/// `<stem>.zip` in `dir`, or `<stem> 2.zip` and on when that's taken, as Finder names copies.
fn free_path(dir: &Path, stem: &str) -> PathBuf {
    let mut path = dir.join(format!("{stem}.zip"));
    let mut copy = 2;
    while path.exists() {
        path = dir.join(format!("{stem} {copy}.zip"));
        copy += 1;
    }
    path
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

/// Shapes of secrets, each replaced whole.
static SHAPES: LazyLock<[Regex; 5]> = LazyLock::new(|| {
    [
        // JSON Web Tokens: LiveKit's call tokens, OAuth ID and access tokens.
        r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*",
        // Google API keys.
        r"\bAIza[0-9A-Za-z_-]{30,}",
        // OpenAI and other `sk-` keys.
        r"\bsk-[A-Za-z0-9_-]{16,}",
        // The local LiveKit server's secret, 32 bytes in hex (local_server.rs).
        r"\b[0-9a-fA-F]{64}\b",
        // Authorization headers.
        r"(?i)\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}",
    ]
    .map(|shape| Regex::new(shape).expect("a valid pattern"))
});

/// `name=value` or `"name": "value"` where the name says it's secret.
static NAMED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|password|passwd|authorization|credential)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)([^\s"'&,;)}\]]+)"#,
    )
    .expect("a valid pattern")
});

/// `text` with the given secrets, and anything shaped like one, replaced by `[redacted]`.
fn redact(text: &str, secrets: &[String]) -> String {
    let mut text = text.to_owned();
    let mut secrets: Vec<&str> = secrets
        .iter()
        .map(|secret| secret.trim())
        .filter(|secret| secret.chars().count() >= MIN_SECRET_LEN)
        .collect();
    // Longest first, so a secret that contains another goes whole.
    secrets.sort_by_key(|secret| std::cmp::Reverse(secret.len()));
    for secret in secrets {
        text = text.replace(secret, REDACTED);
    }
    for shape in SHAPES.iter() {
        text = shape.replace_all(&text, REDACTED).into_owned();
    }
    NAMED
        .replace_all(&text, |caps: &Captures<'_>| {
            let value = &caps[3];
            // Counts ("tokens=1234") and what's already out stay as they are; the value
            // stops before a `]`, so one already out reads "[redacted".
            let out = REDACTED.trim_end_matches(']');
            if value.chars().all(|c| c.is_ascii_digit()) || value.starts_with(out) {
                caps[0].to_owned()
            } else {
                format!("{}{}{REDACTED}", &caps[1], &caps[2])
            }
        })
        .into_owned()
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
                (file.name().to_owned(), text)
            })
            .collect()
    }

    #[test]
    fn the_name_is_the_local_minute_and_a_taken_one_gets_a_number() {
        let dir = temp_dir("naming");
        let stem = file_stem(at(8, 5));
        assert_eq!(stem, "Bomby Diagnostics 2026-11-10 08-05");
        assert_eq!(free_path(&dir, &stem), dir.join(format!("{stem}.zip")));
        fs::write(dir.join(format!("{stem}.zip")), "").unwrap();
        assert_eq!(free_path(&dir, &stem), dir.join(format!("{stem} 2.zip")));
        fs::write(dir.join(format!("{stem} 2.zip")), "").unwrap();
        assert_eq!(free_path(&dir, &stem), dir.join(format!("{stem} 3.zip")));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sources_are_the_known_logs_then_other_logs_then_the_install_log() {
        let dir = temp_dir("sources");
        fs::write(dir.join("zeta.log"), "z").unwrap();
        fs::write(dir.join("notes.txt"), "not a log").unwrap();
        fs::create_dir(dir.join("folder.log")).unwrap();
        let names: Vec<String> = sources(&dir, Some(dir.join("install.log")))
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
                INSTALL_LOG
            ]
        );
        assert_eq!(sources(&dir.join("gone"), None).len(), KNOWN_LOGS.len());
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
            &[],
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
            &[],
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
    }

    #[test]
    fn redacting_twice_changes_nothing_more() {
        let once = redact("secret=abcdefgh and Bearer abcdefghijkl", &[]);
        assert_eq!(redact(&once, &[]), once);
    }
}
