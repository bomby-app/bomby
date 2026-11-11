//! Launch checks remembered across launches, so launch and Settings don't start an agent
//! whose setup is known and unchanged (docs/decisions/remember-the-launch-check.md).
//!
//! Only an agent whose harness names the files that hold its setup (`setup_files`, which
//! the probe reports) is remembered, and only a `ready` answer from a session. It stands
//! while its [`Fingerprint`] holds: the same program, the same setup files, the same picks,
//! the same saved keys (by name; a key itself never leaves the keychain) and the same
//! Bomby, for at most a day. Anything else is checked again: at launch, on Check again
//! (which forgets them all), when the model picker or a pick asks the agent live (which
//! remembers its answer), when its keys change, and after a call it wasn't ready for.

use std::collections::HashMap;
use std::path::Path;
use std::time::UNIX_EPOCH;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::db::now_ms;
use crate::error::{Error, Result};
use crate::setup::{Pick, Setup, Step};

/// How long a remembered check stands, however little changed.
const MAX_AGE_MS: i64 = 24 * 60 * 60 * 1000;

/// What a remembered check depends on. Nothing secret: keys go in by name.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Fingerprint {
    /// The program, symlinks resolved, with its size and modification time: an update
    /// replaces it. Read from the file, so fingerprinting starts nothing.
    program: String,
    program_size: Option<u64>,
    program_modified: Option<u128>,
    /// Each setup file with its modification time; `None` while it doesn't exist.
    files: Vec<(String, Option<u128>)>,
    picks: Vec<Pick>,
    /// The variables with a key saved for the agent.
    keys: Vec<String>,
    /// The app's version: a new Bomby may judge an agent differently.
    app: String,
}

/// Now, in ns since 1970, as file modification times are compared.
pub fn now_ns() -> u128 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos())
}

/// When `path` was last modified, in ns since 1970, if it exists.
fn modified(path: &Path) -> Option<u128> {
    let time = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(time.duration_since(UNIX_EPOCH).ok()?.as_nanos())
}

impl Fingerprint {
    pub fn of(program: &Path, files: &[String], picks: &[Pick], keys: &[String]) -> Self {
        let program = program
            .canonicalize()
            .unwrap_or_else(|_| program.to_owned());
        let meta = std::fs::metadata(&program).ok();
        Self {
            program: program.display().to_string(),
            program_size: meta.as_ref().map(std::fs::Metadata::len),
            program_modified: modified(&program),
            files: files
                .iter()
                .map(|f| (f.clone(), modified(Path::new(f))))
                .collect(),
            picks: picks.to_vec(),
            keys: keys.to_vec(),
            app: env!("CARGO_PKG_VERSION").to_owned(),
        }
    }

    /// Whether the program or a setup file was modified at `since` (ns since 1970) or
    /// after: a check that started then may have seen it either way.
    fn changed_since(&self, since: u128) -> bool {
        self.program_modified
            .into_iter()
            .chain(self.files.iter().filter_map(|(_, modified)| *modified))
            .any(|modified| modified >= since)
    }
}

/// A check that found an agent ready, and what it depended on.
#[derive(Debug, Clone, PartialEq)]
pub struct Remembered {
    pub setup: Setup,
    pub fingerprint: Fingerprint,
    /// When, in ms since 1970.
    pub checked_at: i64,
}

impl Remembered {
    /// The files the check depends on, to fingerprint again.
    pub fn files(&self) -> &[String] {
        &self.setup.setup_files
    }

    /// Whether it still stands for an agent whose fingerprint is now `now`, at `at`.
    pub fn holds(&self, now: &Fingerprint, at: i64) -> bool {
        self.fingerprint == *now && (0..MAX_AGE_MS).contains(&(at - self.checked_at))
    }
}

/// Whether `setup` may be remembered: ready, from a session, with files to watch.
pub fn rememberable(setup: &Setup) -> bool {
    setup.step == Step::Ready && setup.session && !setup.setup_files.is_empty()
}

/// Every remembered check, by agent id. One that can't be read is left out, so it's
/// checked again.
pub fn all(conn: &Connection) -> Result<HashMap<String, Remembered>> {
    let mut rows =
        conn.prepare("SELECT agent, setup, fingerprint, checked_at FROM agent_checks")?;
    let found = rows.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;
    let mut remembered = HashMap::new();
    for row in found {
        let (agent, setup, fingerprint, checked_at) = row?;
        let (Ok(mut setup), Ok(fingerprint)) = (
            serde_json::from_str::<Setup>(&setup),
            serde_json::from_str::<Fingerprint>(&fingerprint),
        ) else {
            continue;
        };
        // Kept as the page gets it (`setupFiles`), which reads back without them.
        setup.setup_files = fingerprint.files.iter().map(|(f, _)| f.clone()).collect();
        remembered.insert(
            agent,
            Remembered {
                setup,
                fingerprint,
                checked_at,
            },
        );
    }
    Ok(remembered)
}

/// Keeps `setup`, a check of `agent` that started at `started` (ns since 1970), if it may be
/// remembered, with `fingerprint`, what it depends on as read once it answered; forgets
/// what was kept for `agent` otherwise. Something it depends on that changed after the
/// check started may or may not be in its answer, so that answer isn't kept either.
pub fn record(
    conn: &Connection,
    agent: &str,
    setup: &Setup,
    fingerprint: &Fingerprint,
    started: u128,
) -> Result<()> {
    if !rememberable(setup) || fingerprint.changed_since(started) {
        return forget(conn, agent);
    }
    conn.execute(
        "INSERT INTO agent_checks (agent, setup, fingerprint, checked_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (agent) DO UPDATE SET setup = excluded.setup,
           fingerprint = excluded.fingerprint, checked_at = excluded.checked_at",
        params![agent, json(setup)?, json(fingerprint)?, now_ms()],
    )?;
    Ok(())
}

/// Forgets `agent`'s check, so the next look starts it.
pub fn forget(conn: &Connection, agent: &str) -> Result<()> {
    conn.execute("DELETE FROM agent_checks WHERE agent = ?1", [agent])?;
    Ok(())
}

/// Forgets every check (Check again).
pub fn forget_all(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM agent_checks", [])?;
    Ok(())
}

fn json(value: &impl Serialize) -> Result<String> {
    serde_json::to_string(value).map_err(Error::Corrupt)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{Duration, SystemTime};

    use super::*;
    use crate::db::Db;

    fn ready(files: Vec<String>) -> Setup {
        Setup {
            model: Some("Kimi".into()),
            session: true,
            setup_files: files,
            ..Setup::default()
        }
    }

    fn touch(path: &Path, seconds: u64) {
        let file = fs::File::options().write(true).open(path).unwrap();
        file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(seconds))
            .unwrap();
    }

    #[test]
    fn only_a_ready_session_with_setup_files_is_remembered() {
        let files = vec!["/Users/me/.config/goose/config.yaml".to_owned()];
        assert!(rememberable(&ready(files.clone())));
        assert!(
            !rememberable(&ready(vec![])),
            "a harness that names no files"
        );
        let sessionless = Setup {
            session: false,
            ..ready(files.clone())
        };
        assert!(!rememberable(&sessionless));
        for step in [Step::SignIn, Step::Pick, Step::Unreachable, Step::Connect] {
            assert!(!rememberable(&Setup {
                step,
                ..ready(files.clone())
            }));
        }
    }

    #[test]
    fn a_check_holds_until_its_program_files_picks_or_keys_change_or_a_day_passes() {
        let dir = std::env::temp_dir().join(format!("bomby-checks-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let program = dir.join("goose");
        let config = dir.join("config.yaml");
        fs::write(&program, "v1").unwrap();
        fs::write(&config, "GOOSE_PROVIDER: openrouter").unwrap();
        touch(&config, 1_000);
        let files = vec![config.display().to_string()];
        let picks = vec![Pick {
            setting: "provider".into(),
            value: "openrouter".into(),
        }];
        let keys = vec!["OPENROUTER_API_KEY".to_owned()];
        let then = Fingerprint::of(&program, &files, &picks, &keys);
        let remembered = Remembered {
            setup: ready(files.clone()),
            fingerprint: then.clone(),
            checked_at: 0,
        };
        let now = || Fingerprint::of(&program, &files, &picks, &keys);

        assert!(remembered.holds(&now(), 1));
        assert!(!remembered.holds(&now(), MAX_AGE_MS), "a day old");
        assert!(!remembered.holds(&now(), -1), "from a clock that went back");

        touch(&config, 2_000);
        assert!(!remembered.holds(&now(), 1), "its setup changed");
        touch(&config, 1_000);
        assert!(remembered.holds(&now(), 1));

        assert!(!remembered.holds(&Fingerprint::of(&program, &files, &[], &keys), 1));
        assert!(!remembered.holds(&Fingerprint::of(&program, &files, &picks, &[]), 1));

        fs::write(&program, "version 2").unwrap();
        assert!(!remembered.holds(&now(), 1), "goose updated");

        fs::remove_file(&config).unwrap();
        assert_ne!(now(), then, "its setup file went");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_check_isnt_kept_when_its_setup_changed_after_it_started() {
        let dir = std::env::temp_dir().join(format!("bomby-checks-race-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let config = dir.join("config.yaml");
        fs::write(&config, "GOOSE_PROVIDER: openrouter").unwrap();
        touch(&config, 1_000);
        let files = vec![config.display().to_string()];
        let program = Path::new("/no/such/goose");
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        let started = 2_000 * 1_000_000_000;

        // Unchanged since the check started: kept.
        let before = Fingerprint::of(program, &files, &[], &[]);
        record(&conn, "goose", &ready(files.clone()), &before, started).unwrap();
        assert!(all(&conn).unwrap().contains_key("goose"));

        // Edited while the check ran (or while another agent held up its answer).
        touch(&config, 3_000);
        let after = Fingerprint::of(program, &files, &[], &[]);
        record(&conn, "goose", &ready(files), &after, started).unwrap();
        assert!(
            all(&conn).unwrap().is_empty(),
            "not certified, and the old one goes"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn records_forgets_and_reads_back() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        let files = vec!["/Users/me/.config/goose/config.yaml".to_owned()];
        let fingerprint = Fingerprint::of(Path::new("/no/such/goose"), &files, &[], &[]);

        record(&conn, "goose", &ready(files.clone()), &fingerprint, 0).unwrap();
        let kept = all(&conn).unwrap().remove("goose").unwrap();
        assert_eq!(
            kept.setup,
            ready(files.clone()),
            "the setup files come back too"
        );
        assert_eq!(kept.fingerprint, fingerprint);

        let signed_out = Setup {
            step: Step::SignIn,
            ..ready(files.clone())
        };
        record(&conn, "goose", &signed_out, &fingerprint, 0).unwrap();
        assert!(
            all(&conn).unwrap().is_empty(),
            "anything but ready is forgotten"
        );

        record(&conn, "goose", &ready(files), &fingerprint, 0).unwrap();
        forget_all(&conn).unwrap();
        assert!(all(&conn).unwrap().is_empty());
    }
}
