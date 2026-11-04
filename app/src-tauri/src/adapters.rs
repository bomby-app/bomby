//! The ACP adapters for agents that don't speak ACP themselves (Claude Code, Codex),
//! installed into the app's own folder when the user sets one up
//! (docs/decisions/install-adapters-on-setup.md). Bomby ships only their lockfile
//! (`agent/adapters/`): the user's Mac downloads bun and the packages from npm, and compiles
//! each adapter into one program, as `just agent install` does in the repo.
//!
//! The voice agent finds them through `BOMBY_ADAPTERS` (`agent::command`). An app update
//! with a new lockfile installs them again in the background at launch.

use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Runtime};

use crate::agents;
use crate::error::{Error, Result};
use crate::process;
use crate::sync;

const PACKAGE: &str = include_str!("../../../agent/adapters/package.json");
const LOCKFILE: &str = include_str!("../../../agent/adapters/bun.lock");

/// The bun that installs and compiles them: the version `mise.toml` pins for the repo.
const BUN_VERSION: &str = "1.4.4";
/// bun's macOS release zips by CPU, with their SHA-256 from the release's SHASUMS256.txt.
const BUN: &[(&str, &str, &str)] = &[
    (
        "aarch64",
        "bun-darwin-aarch64",
        "c240d7f0ccb90c263a849fcdb09b7ee62630d921348ed6aafda86b9d577bc510",
    ),
    (
        "x86_64",
        "bun-darwin-x64",
        "50a3491f73abc2fe81673171a85762d3bc2cc1680ccecadd983de99adf77977e",
    ),
];

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);
const STEP_TIMEOUT: Duration = Duration::from_secs(300);

static DIR: OnceLock<PathBuf> = OnceLock::new();
static INSTALLING: Mutex<()> = Mutex::new(());

/// Where the adapters live: `<app data>/adapters`. Set once at launch.
pub fn init(app_data: &Path) {
    let _ = DIR.set(app_data.join("adapters"));
}

/// The folder of built adapters the voice agent runs, once `init` ran.
pub fn bin_dir() -> Option<PathBuf> {
    DIR.get().map(|dir| dir.join("bin"))
}

/// Whether the adapters were built from an older lockfile than this app ships.
fn stale(dir: &Path) -> bool {
    let built = fs::read_to_string(dir.join("bin").join("bun.lock")).ok();
    built.is_some_and(|built| built != LOCKFILE)
}

/// Rebuilds adapters left from an older version of the app, in the background.
pub fn update_in_background<R: Runtime>(app: &AppHandle<R>) {
    let Some(dir) = DIR.get().filter(|dir| stale(dir)).cloned() else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _one = sync::lock(&INSTALLING);
        if install(&dir).is_err() {
            // A half-updated set must not run; Settings offers Set up again.
            let _ = fs::remove_dir_all(dir.join("bin"));
        }
        agents::refresh_after_change(&app);
    });
}

/// Installs every adapter in the lockfile, then looks for the agents again so the probe
/// sees them. One install runs at a time.
#[tauri::command]
pub async fn install_adapters<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    let dir = DIR
        .get()
        .cloned()
        .ok_or_else(|| Error::Invalid("The app isn't ready yet.".into()))?;
    tauri::async_runtime::spawn_blocking(move || -> Result<()> {
        let _one = sync::lock(&INSTALLING);
        install(&dir)?;
        agents::refresh_after_change(&app);
        Ok(())
    })
    .await?
}

/// Downloads bun the first time, then the adapters from npm, and compiles each into one
/// program.
fn install(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir)?;
    let log = dir.join("install.log");
    let bun = runtime(dir, &log)?;

    let work = dir.join("packages");
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work)?;
    fs::write(work.join("package.json"), PACKAGE)?;
    fs::write(work.join("bun.lock"), LOCKFILE)?;
    let mut packages = Command::new(&bun);
    // Optional packages hold the agents' own bundled binaries; the adapters run the user's.
    packages
        .args(["install", "--frozen-lockfile", "--omit", "optional"])
        .current_dir(&work)
        .env("BUN_INSTALL_CACHE_DIR", dir.join("cache"));
    run(packages, &log, "Downloading the adapters")?;

    let staging = dir.join("bin.new");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging)?;
    for (name, entry) in entries(&work)? {
        let mut build = Command::new(&bun);
        build
            .args(["build", "--compile", "--minify"])
            .arg(&entry)
            .arg("--outfile")
            .arg(staging.join(&name))
            .current_dir(&work);
        run(build, &log, "Building the adapters")?;
    }
    fs::write(staging.join("bun.lock"), LOCKFILE)?;
    let bin = dir.join("bin");
    let _ = fs::remove_dir_all(&bin);
    fs::rename(&staging, &bin)?;

    let _ = fs::remove_dir_all(&work);
    let _ = fs::remove_dir_all(dir.join("cache"));
    Ok(())
}

/// The bun in `<dir>/runtime`, downloaded and checked against its SHA-256 the first time.
fn runtime(dir: &Path, log: &Path) -> Result<PathBuf> {
    let bun = dir.join("runtime").join("bun");
    let mut version = Command::new(&bun);
    version.arg("--version");
    let current = version
        .output()
        .ok()
        .is_some_and(|out| String::from_utf8_lossy(&out.stdout).trim() == BUN_VERSION);
    if current {
        return Ok(bun);
    }

    let (_, asset, sha256) = BUN
        .iter()
        .find(|(arch, _, _)| *arch == std::env::consts::ARCH)
        .ok_or_else(|| Error::Invalid("This Mac's processor isn't supported.".into()))?;
    let zip = dir.join("bun.zip");
    let url =
        format!("https://github.com/oven-sh/bun/releases/download/bun-v{BUN_VERSION}/{asset}.zip");
    let mut download = Command::new("curl");
    download
        .args(["-fsSL", "--max-time", "280", "-o"])
        .arg(&zip)
        .arg(&url);
    run_for(download, log, "Downloading bun", DOWNLOAD_TIMEOUT)?;
    if sha256_of(&zip)? != *sha256 {
        let _ = fs::remove_file(&zip);
        return Err(Error::Invalid(
            "The bun download didn't match its checksum. Try again.".into(),
        ));
    }

    let unpacked = dir.join("runtime.new");
    let _ = fs::remove_dir_all(&unpacked);
    let mut unzip = Command::new("ditto");
    unzip.args(["-x", "-k"]).arg(&zip).arg(&unpacked);
    run(unzip, log, "Unpacking bun")?;
    let runtime = dir.join("runtime");
    let _ = fs::remove_dir_all(&runtime);
    fs::create_dir_all(&runtime)?;
    fs::rename(unpacked.join(asset).join("bun"), &bun)?;
    let _ = fs::remove_dir_all(&unpacked);
    let _ = fs::remove_file(&zip);
    Ok(bun)
}

fn sha256_of(file: &Path) -> Result<String> {
    let out = Command::new("shasum")
        .args(["-a", "256"])
        .arg(file)
        .output()?;
    Ok(String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_owned())
}

/// A package manifest, parsed; `what` names it in the error.
fn json(text: &str, what: &str) -> Result<serde_json::Value> {
    serde_json::from_str(text).map_err(|e| Error::Invalid(format!("Couldn't read {what}: {e}")))
}

/// Each adapter in the lockfile's package list: the program it installs, and its script.
fn entries(work: &Path) -> Result<Vec<(String, PathBuf)>> {
    let package = json(PACKAGE, "agent/adapters/package.json")?;
    let dependencies = package["dependencies"]
        .as_object()
        .ok_or_else(|| Error::Invalid("agent/adapters/package.json has no dependencies".into()))?;
    let mut entries = Vec::new();
    for name in dependencies.keys() {
        let root = work.join("node_modules").join(name);
        let manifest = json(
            &fs::read_to_string(root.join("package.json"))?,
            &format!("{name}'s package.json"),
        )?;
        let bins: Vec<(String, String)> = match &manifest["bin"] {
            serde_json::Value::String(path) => {
                let program = name.rsplit('/').next().unwrap_or(name).to_owned();
                vec![(program, path.clone())]
            }
            serde_json::Value::Object(map) => map
                .iter()
                .filter_map(|(program, path)| Some((program.clone(), path.as_str()?.to_owned())))
                .collect(),
            _ => Vec::new(),
        };
        entries.extend(
            bins.into_iter()
                .map(|(program, path)| (program, root.join(path))),
        );
    }
    Ok(entries)
}

fn run(command: Command, log: &Path, what: &str) -> Result<()> {
    run_for(command, log, what, STEP_TIMEOUT)
}

/// Runs `command` with its output appended to `log`, killing it after `timeout`.
fn run_for(mut command: Command, log: &Path, what: &str, timeout: Duration) -> Result<()> {
    let out = File::options().create(true).append(true).open(log)?;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(out.try_clone()?)
        .stderr(out)
        .spawn()?;
    let status = process::wait_timeout(&mut child, timeout)?;
    if status.is_none() {
        process::kill(&mut child);
    }
    match status {
        Some(status) if status.success() => Ok(()),
        Some(_) => Err(Error::Invalid(format!(
            "{what} failed. Check your internet connection and try again."
        ))),
        None => Err(Error::Invalid(format!("{what} took too long. Try again."))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_bun_for_this_mac() {
        assert!(
            BUN.iter()
                .any(|(arch, _, _)| *arch == std::env::consts::ARCH)
        );
    }

    #[test]
    fn finds_each_adapter_program_in_its_package() {
        let work = std::env::temp_dir().join(format!("bomby-adapters-{}", std::process::id()));
        let package = work.join("node_modules/@agentclientprotocol/codex-acp");
        fs::create_dir_all(&package).unwrap();
        fs::write(
            package.join("package.json"),
            r#"{"bin": {"codex-acp": "dist/index.js"}}"#,
        )
        .unwrap();
        let claude = work.join("node_modules/@agentclientprotocol/claude-agent-acp");
        fs::create_dir_all(&claude).unwrap();
        fs::write(claude.join("package.json"), r#"{"bin": "dist/index.js"}"#).unwrap();

        let mut found = entries(&work).unwrap();
        found.sort();
        assert_eq!(
            found,
            vec![
                ("claude-agent-acp".into(), claude.join("dist/index.js")),
                ("codex-acp".into(), package.join("dist/index.js")),
            ]
        );
        fs::remove_dir_all(&work).unwrap();
    }

    #[test]
    fn adapters_built_from_another_lockfile_are_stale() {
        let dir = std::env::temp_dir().join(format!("bomby-stale-{}", std::process::id()));
        fs::create_dir_all(dir.join("bin")).unwrap();
        assert!(!stale(&dir));
        fs::write(dir.join("bin/bun.lock"), "older").unwrap();
        assert!(stale(&dir));
        fs::write(dir.join("bin/bun.lock"), LOCKFILE).unwrap();
        assert!(!stale(&dir));
        fs::remove_dir_all(&dir).unwrap();
    }
}
