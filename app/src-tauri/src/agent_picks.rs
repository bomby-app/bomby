//! The session settings the user picked for each agent: its model, how hard it thinks and,
//! for goose, its provider (docs/decisions/pick-agent-settings-like-buzz-and-zed.md).
//! Picking is optional; an agent without picks runs on its own defaults. Each call applies
//! the picks to every session it opens, as the agent's own session settings over ACP, so
//! nothing in the agent's own config changes.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{Connection, params};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::agent_checks::{self, Fingerprint};
use crate::agents::{self, Agents, CHANGED, Started};
use crate::db::Db;
use crate::error::{Error, Result};
use crate::setup::{self, Listed, Pick, Setup, Skipped, Why};
use crate::sync;

/// Every agent's picks, in the order they're applied. An agent on its defaults has none.
pub fn saved(conn: &Connection) -> Result<HashMap<String, Vec<Pick>>> {
    let mut picks: HashMap<String, Vec<Pick>> = HashMap::new();
    let mut rows =
        conn.prepare("SELECT agent, setting, value FROM agent_picks ORDER BY agent, position")?;
    let picked = rows.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            Pick {
                setting: row.get(1)?,
                value: row.get(2)?,
            },
        ))
    })?;
    for row in picked {
        let (agent, pick) = row?;
        picks.entry(agent).or_default().push(pick);
    }
    Ok(picks)
}

/// `agent`'s picks, in the order they're applied.
fn saved_for(conn: &Connection, agent: &str) -> Result<Vec<Pick>> {
    let mut rows =
        conn.prepare("SELECT setting, value FROM agent_picks WHERE agent = ?1 ORDER BY position")?;
    let picks = rows.query_map([agent], |row| {
        Ok(Pick {
            setting: row.get(0)?,
            value: row.get(1)?,
        })
    })?;
    Ok(picks.collect::<rusqlite::Result<_>>()?)
}

/// Replaces `agent`'s picks; none puts it back on its defaults.
fn save(conn: &mut Connection, agent: &str, picks: &[Pick]) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM agent_picks WHERE agent = ?1", [agent])?;
    let mut insert = tx.prepare(
        "INSERT INTO agent_picks (agent, position, setting, value) VALUES (?1, ?2, ?3, ?4)",
    )?;
    for (position, pick) in (0_i64..).zip(picks) {
        insert.execute(params![agent, position, pick.setting, pick.value])?;
    }
    drop(insert);
    tx.commit()?;
    Ok(())
}

/// The installed `agent`'s program, as the last look found it.
fn program<R: Runtime>(app: &AppHandle<R>, agent: &str) -> Result<PathBuf> {
    let found = app.state::<Agents>().cached().unwrap_or_default();
    agents::installed(&found)
        .into_iter()
        .find_map(|(id, path)| (id == agent).then_some(path))
        .ok_or(Error::NotFound("agent"))
}

const UNREACHABLE: &str = "Bomby couldn't reach the agent. Try again?";

/// A live answer from `agent`, with what it was asked with, so it's recorded against
/// exactly that.
struct Asked {
    /// `None` when the probe couldn't run.
    listed: Option<Listed>,
    program: PathBuf,
    /// The variables with a key saved for it, as it was started.
    keys: Vec<String>,
    started: Started,
}

/// What `agent` lets the user pick, with `picks` applied and its saved keys in its
/// environment, asked of the agent itself (one short-lived probe, a few seconds). With
/// `listing` off, only its setup, from a session.
fn ask<R: Runtime>(
    app: &AppHandle<R>,
    agent: &str,
    picks: &[Pick],
    listing: bool,
) -> Result<Asked> {
    let program = program(app, agent)?;
    // Before anything it reads: what changes after this is the next check's.
    let started = app.state::<Agents>().start_check();
    let keys = agents::saved_keys(app);
    let by_agent = HashMap::from([(agent.to_owned(), picks.to_vec())]);
    let (listing, sessions) = if listing {
        (Some(agent), Vec::new())
    } else {
        (None, vec![agent.to_owned()])
    };
    let listed = setup::probe(
        &[(agent.to_owned(), program.clone())],
        &by_agent,
        listing,
        &sessions,
        &keys,
    )
    .and_then(|mut listed| listed.remove(agent));
    Ok(Asked {
        listed,
        program,
        keys: keys
            .get(agent)
            .map(|v| v.keys().cloned().collect())
            .unwrap_or_default(),
        started,
    })
}

/// [`ask`] for the model picker. An answer without a session is a failed check: it's
/// settled ([`settle_failure`]) and the error says why.
fn list<R: Runtime>(app: &AppHandle<R>, agent: &str, picks: &[Pick]) -> Result<(Listed, Asked)> {
    let mut asked = ask(app, agent, picks, true)?;
    match asked.listed.take() {
        Some(listed) if listed.setup.session => Ok((listed, asked)),
        failed => {
            let db = app.state::<Db>();
            let shown = settle_failure(
                &*db.conn()?,
                &app.state::<Agents>(),
                agent,
                failed.as_ref().map(|l| &l.setup),
            )?;
            show(app, shown);
            Err(Error::Invalid(
                failed
                    .and_then(|l| l.setup.problem)
                    .unwrap_or_else(|| UNREACHABLE.into()),
            ))
        }
    }
}

/// A live check of `agent` that failed (`setup` without a session, or `None` when the probe
/// couldn't run): whatever was remembered of it goes, and its row shows the failure, so
/// calls leave it out as after a look. The new list when the row changed.
fn settle_failure(
    conn: &Connection,
    agents: &Agents,
    agent: &str,
    setup: Option<&Setup>,
) -> Result<Option<Vec<agents::AgentStatus>>> {
    agent_checks::forget(conn, agent)?;
    Ok(setup.and_then(|setup| agents.replace_setup(agent, setup)))
}

/// Keeps `setup`, a live answer from a session of `agent` with `picks` saved, for the
/// launch check, against what it was `asked` with, or forgets what it had (`agent_checks`).
fn remember<R: Runtime>(
    app: &AppHandle<R>,
    agent: &str,
    setup: &Setup,
    picks: &[Pick],
    asked: &Asked,
) -> Result<()> {
    let fingerprint = Fingerprint::of(&asked.program, &setup.setup_files, picks, &asked.keys);
    app.state::<Agents>().record_check(
        &*app.state::<Db>().conn()?,
        agent,
        setup,
        &fingerprint,
        &asked.started,
    )
}

/// Agent `id`'s keys changed: its model list is forgotten now, so the next ask gets one made
/// with them, and nothing asked or checked before is kept or recorded ([`Agents::invalidate`]).
pub(crate) fn keys_changed(
    agents: &Agents,
    listings: &Listings,
    conn: &Connection,
    id: &str,
) -> Result<()> {
    listings.forget_one(id);
    agents.invalidate(conn, id)
}

/// Checks `agent` again, alone, with its saved picks and keys, and shows the answer in its
/// row, kept over a look that started before (its keys changed). Logged when it fails.
pub fn recheck<R: Runtime>(app: &AppHandle<R>, agent: &str) {
    match recheck_with(app, agent, |picks| ask(app, agent, picks, false)) {
        Ok(shown) => show(app, shown),
        Err(e) => {
            let _ = crate::app_log::append(app, &format!("checking {agent} again: {e}"));
        }
    }
}

/// [`recheck`], with how the agent is asked (a probe of seconds) passed in, so a test can
/// answer for it. The new list when the row changed.
fn recheck_with<R: Runtime>(
    app: &AppHandle<R>,
    agent: &str,
    ask: impl FnOnce(&[Pick]) -> Result<Asked>,
) -> Result<Option<Vec<agents::AgentStatus>>> {
    let lock = app.state::<Agents>().one_at_a_time(agent);
    let _one = sync::lock(&lock);
    app.state::<Listings>().forget_one(agent);
    // A `let`, so the database is free again before the probe, and for `remember`.
    let picks = saved_for(&*app.state::<Db>().conn()?, agent)?;
    let asked = ask(&picks)?;
    match &asked.listed {
        Some(listed) if listed.setup.session => {
            remember(app, agent, &listed.setup, &picks, &asked)?;
            Ok(app.state::<Agents>().picked(agent, &listed.setup))
        }
        // It didn't get as far as a session: the row shows why, as a look would.
        failed => settle_failure(
            &*app.state::<Db>().conn()?,
            &app.state::<Agents>(),
            agent,
            failed.as_ref().map(|l| &l.setup),
        ),
    }
}

/// What each agent let the user pick, as it last answered, for the whole launch: asking
/// starts the agent, seconds each time, so the model picker asks each agent once, and every
/// pick keeps the answer current. Forgotten only on a full check (`refresh_agents`).
#[derive(Default)]
pub struct Listings(Mutex<HashMap<String, Listed>>);

impl Listings {
    fn get(&self, agent: &str) -> Option<Listed> {
        sync::lock(&self.0).get(agent).cloned()
    }

    fn keep(&self, agent: &str, listed: &Listed) {
        sync::lock(&self.0).insert(agent.to_owned(), listed.clone());
    }

    /// Every agent is asked again when its picker next opens.
    pub fn forget(&self) {
        sync::lock(&self.0).clear();
    }

    /// `agent` is asked again when its picker next opens.
    fn forget_one(&self, agent: &str) {
        sync::lock(&self.0).remove(agent);
    }
}

/// Tells every window about `found`, the list after a row changed, if one did.
fn show<R: Runtime>(app: &AppHandle<R>, found: Option<Vec<agents::AgentStatus>>) {
    if let Some(found) = found {
        // Only fails for an invalid event name or payload.
        let _ = app.emit(CHANGED, &found);
    }
}

/// What the model picker shows for `agent` when it opens: its settings, its picks applied,
/// asked of the agent once per launch ([`Listings`]). Its row follows, so it shows a pick
/// found gone.
#[tauri::command]
pub async fn agent_settings<R: Runtime>(app: AppHandle<R>, agent: String) -> Result<Listed> {
    // A probe of seconds: off the async runtime, like every look (docs/tauri-notes.md).
    tauri::async_runtime::spawn_blocking(move || {
        let lock = app.state::<Agents>().one_at_a_time(&agent);
        let _one = sync::lock(&lock);
        // Inside the lock, so a second window asking meanwhile gets this answer.
        if let Some(listed) = app.state::<Listings>().get(&agent) {
            return Ok(listed);
        }
        let picks = saved_for(&*app.state::<Db>().conn()?, &agent)?;
        let (listed, asked) = list(&app, &agent, &picks)?;
        remember(&app, &agent, &listed.setup, &picks, &asked)?;
        // Asked with keys that changed meanwhile: shown to this caller, kept nowhere.
        let agents = app.state::<Agents>();
        if agents.unrevised(&asked.started, &agent) {
            app.state::<Listings>().keep(&agent, &listed);
            show(&app, agents.replace_setup(&agent, &listed.setup));
        }
        Ok(listed)
    })
    .await?
}

/// Adds `pick` to `agent`'s saved picks, in place of an earlier one for the same setting, and
/// returns its settings with them applied. Only what the user picked is saved: a setting they
/// never touched keeps following the agent's own default. A pick can change what the next
/// one offers (goose's models follow its provider), so the picker shows this answer.
///
/// Saved only once the agent has answered with a session and taken `pick`; until then the
/// saved picks stay as they were, and the error says why. Only this agent's row changes.
#[tauri::command]
pub async fn pick_agent_settings<R: Runtime>(
    app: AppHandle<R>,
    agent: String,
    pick: Pick,
) -> Result<Listed> {
    tauri::async_runtime::spawn_blocking(move || {
        let lock = app.state::<Agents>().one_at_a_time(&agent);
        let _one = sync::lock(&lock);
        let db = app.state::<Db>();
        let mut picks = saved_for(&*db.conn()?, &agent)?;
        picks.retain(|p| p.setting != pick.setting);
        picks.push(pick.clone());
        // One that didn't get as far as a session (it timed out, say) fails in `list`.
        let (mut listed, asked) = list(&app, &agent, &picks)?;
        if let Some(skipped) = not_taken(&listed, &pick) {
            // Refused for want of a key (a provider without its key): its row offers that
            // key, so the user can save it and pick again.
            let offered = app.state::<Agents>().offer_keys(&agent, &listed.setup.keys);
            let asks_for_key = offered.is_some();
            show(&app, offered);
            return Err(Error::Invalid(why_not_taken(skipped, &agent, asks_for_key)));
        }
        let saved = to_save(picks, &listed, &pick);
        save(&mut *db.conn()?, &agent, &saved)?;
        remember(&app, &agent, &listed.setup, &saved, &asked)?;
        // A pick that fell away with this one isn't the user's any more: no note for it.
        listed
            .setup
            .skipped
            .retain(|s| saved.iter().any(|p| p.setting == s.setting));
        let agents = app.state::<Agents>();
        if agents.unrevised(&asked.started, &agent) {
            app.state::<Listings>().keep(&agent, &listed);
            show(&app, agents.picked(&agent, &listed.setup));
        }
        Ok(listed)
    })
    .await?
}

/// The note on `pick`, if the agent didn't take it.
fn not_taken<'a>(listed: &'a Listed, pick: &Pick) -> Option<&'a Skipped> {
    listed
        .setup
        .skipped
        .iter()
        .find(|s| s.setting == pick.setting)
}

/// Why the agent didn't take a pick: "Codex wouldn't take that model". `asks_for_key` when
/// it refused it and its row now offers a key it lacked.
fn why_not_taken(skipped: &Skipped, agent: &str, asks_for_key: bool) -> String {
    let (name, setting) = (
        agents::name(agent).unwrap_or(agent),
        skipped.name.to_lowercase(),
    );
    match skipped.why {
        Why::Refused if asks_for_key => {
            format!(
                "{name} wouldn't take that {setting} without its key. Save the key below, then pick it again."
            )
        }
        Why::Refused => {
            format!("{name} wouldn't take that {setting}, so nothing changed. Pick another.")
        }
        Why::Gone => format!("{name} doesn't offer that {setting} any more. Pick another."),
    }
}

/// What to save once `new` held, in the agent's own order: all of `picks` but those that
/// fell away with it, a value no longer offered for a setting the agent applies after it (a
/// model gone with its provider), which leave their default. Any other the agent couldn't
/// apply now (a provider refused for a missing key today) stays saved, with its note.
fn to_save(mut picks: Vec<Pick>, listed: &Listed, new: &Pick) -> Vec<Pick> {
    let order = |setting: &str| {
        listed
            .settings
            .iter()
            .position(|s| s.id == setting)
            .unwrap_or(usize::MAX)
    };
    let after_new = |setting: &str| order(setting) > order(&new.setting);
    picks.retain(|p| {
        !listed
            .setup
            .skipped
            .iter()
            .any(|s| s.setting == p.setting && s.why == Why::Gone && after_new(&p.setting))
    });
    picks.sort_by_key(|p| order(&p.setting));
    picks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pick(setting: &str, value: &str) -> Pick {
        Pick {
            setting: setting.into(),
            value: value.into(),
        }
    }

    /// The answer a probe gives for goose, through `recheck_with`'s `ask`.
    fn asked(app: &tauri::App<tauri::test::MockRuntime>, setup: Option<Setup>) -> Asked {
        Asked {
            listed: setup.map(|setup| Listed {
                setup,
                settings: Vec::new(),
            }),
            program: PathBuf::from("/Users/me/.local/bin/goose"),
            keys: vec!["OPENROUTER_API_KEY".into()],
            started: app.state::<Agents>().start_check(),
        }
    }

    #[test]
    fn checking_again_lets_the_database_go_for_the_probe_and_takes_it_once_after() {
        // 0.3.2 held the database from reading the picks through the probe and then took
        // it again to keep the answer: it hung for good after every key saved for an agent.
        let shown = Setup {
            session: true,
            ..Setup::default()
        };
        let app = crate::testing::app_with(Agents::showing(
            "goose",
            "/Users/me/.local/bin/goose",
            shown,
        ));
        save(
            &mut app.state::<Db>().conn().unwrap(),
            "goose",
            &[pick("model", "kimi")],
        )
        .unwrap();
        let ready = Setup {
            session: true,
            model: Some("Kimi".into()),
            setup_files: vec!["/Users/me/.config/goose/config.yaml".into()],
            ..Setup::default()
        };

        let changed = recheck_with(app.handle(), "goose", |picks| {
            assert_eq!(picks, [pick("model", "kimi")]);
            assert!(
                !app.state::<Db>().held_here(),
                "free while the agent answers"
            );
            Ok(asked(&app, Some(ready.clone())))
        })
        .unwrap();

        assert!(changed.is_some(), "its row shows the new answer");
        let remembered = agent_checks::all(&app.state::<Db>().conn().unwrap()).unwrap();
        assert!(remembered.contains_key("goose"), "kept for the next launch");

        // One that didn't get a session: forgotten, and its row says why.
        let signed_out = Setup {
            step: setup::Step::SignIn,
            problem: Some("Sign in to goose.".into()),
            ..Setup::default()
        };
        let changed = recheck_with(app.handle(), "goose", |_| {
            Ok(asked(&app, Some(signed_out.clone())))
        })
        .unwrap();
        assert!(changed.is_some());
        assert!(
            agent_checks::all(&app.state::<Db>().conn().unwrap())
                .unwrap()
                .is_empty()
        );
        assert!(!app.state::<Db>().held_here());
    }

    #[test]
    fn keeps_each_agents_picks_in_order_and_replaces_them() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        assert!(
            saved(&conn).unwrap().is_empty(),
            "every agent starts on its defaults"
        );

        let goose = [pick("provider", "openrouter"), pick("model", "kimi")];
        save(&mut conn, "goose", &goose).unwrap();
        save(&mut conn, "claude", &[pick("model", "opus")]).unwrap();
        assert_eq!(saved(&conn).unwrap()["goose"], goose);
        assert_eq!(saved_for(&conn, "goose").unwrap(), goose);
        assert!(saved_for(&conn, "codex").unwrap().is_empty());

        save(&mut conn, "goose", &[pick("model", "deepseek")]).unwrap();
        assert_eq!(saved(&conn).unwrap()["goose"], [pick("model", "deepseek")]);

        save(&mut conn, "claude", &[]).unwrap();
        assert!(
            !saved(&conn).unwrap().contains_key("claude"),
            "back on its defaults"
        );
    }

    #[test]
    fn a_pick_the_agent_didnt_take_says_why() {
        let skipped = |setting: &str, why| setup::Skipped {
            setting: setting.into(),
            name: "Model".into(),
            value: "b".into(),
            why,
        };
        let listed = |skipped| Listed {
            setup: setup::Setup {
                skipped,
                ..setup::Setup::default()
            },
            settings: Vec::new(),
        };
        let new = pick("model", "b");

        let refused = listed(vec![skipped("model", Why::Refused)]);
        let note = not_taken(&refused, &new).unwrap();
        assert_eq!(
            why_not_taken(note, "codex", false),
            "Codex wouldn't take that model, so nothing changed. Pick another."
        );
        assert_eq!(
            why_not_taken(note, "goose", true),
            "goose wouldn't take that model without its key. Save the key below, then pick it again."
        );
        assert_eq!(
            not_taken(&listed(vec![skipped("effort", Why::Gone)]), &new),
            None,
            "another setting falling away doesn't undo this pick"
        );
    }

    fn key(name: &str) -> setup::KeyField {
        setup::KeyField {
            name: name.into(),
            label: name.into(),
            secret: true,
            optional: false,
        }
    }

    fn goose_row(setup: setup::Setup) -> Agents {
        Agents::showing("goose", "/b/goose", setup)
    }

    #[test]
    fn a_key_change_forgets_the_model_list_before_anyone_asks_again() {
        let db = Db::in_memory().unwrap();
        let (agents, listings) = (Agents::default(), Listings::default());
        let old = Listed {
            setup: setup::Setup::default(),
            settings: Vec::new(),
        };
        listings.keep("goose", &old);
        // A picker that asked with the old key, still on its way.
        let asked_before = agents.start_check();

        keys_changed(&agents, &listings, &db.conn().unwrap(), "goose").unwrap();

        assert_eq!(
            listings.get("goose"),
            None,
            "the next ask lists with the new key"
        );
        assert!(
            !agents.unrevised(&asked_before, "goose"),
            "the answer on its way isn't kept or shown"
        );
        assert!(agents.unrevised(&agents.start_check(), "goose"));
    }

    #[test]
    fn a_provider_refused_for_its_key_offers_that_key_on_the_row() {
        let on_openrouter = setup::Setup {
            session: true,
            keys: vec![key("OPENROUTER_API_KEY")],
            ..setup::Setup::default()
        };
        let agents = goose_row(on_openrouter);
        assert!(!agents.offers_key("goose", "ANTHROPIC_API_KEY"));

        // The refused pick's answer asks for Anthropic's key.
        assert!(
            agents
                .offer_keys("goose", &[key("ANTHROPIC_API_KEY")])
                .is_some()
        );
        assert_eq!(
            agents.offered_keys("goose"),
            ["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"]
        );
        assert!(
            agents.offers_key("goose", "ANTHROPIC_API_KEY"),
            "so it can be saved"
        );
        assert_eq!(
            agents.offer_keys("goose", &[key("ANTHROPIC_API_KEY")]),
            None,
            "offered already"
        );
    }

    #[test]
    fn a_failed_live_check_forgets_the_remembered_one_and_shows_on_the_row() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        let ready = setup::Setup {
            session: true,
            setup_files: vec!["/Users/me/.config/goose/config.yaml".into()],
            ..setup::Setup::default()
        };
        let fingerprint = Fingerprint::of(
            std::path::Path::new("/b/goose"),
            &ready.setup_files,
            &[],
            &[],
        );
        agent_checks::record(&conn, "goose", &ready, &fingerprint, 0).unwrap();
        let agents = goose_row(ready);
        assert_eq!(agents::usable(&agents.cached().unwrap()).len(), 1);

        let timed_out = setup::Setup {
            step: setup::Step::Unreachable,
            problem: Some("It didn't answer in time".into()),
            ..setup::Setup::default()
        };
        let shown = settle_failure(&conn, &agents, "goose", Some(&timed_out)).unwrap();

        assert!(
            agent_checks::all(&conn).unwrap().is_empty(),
            "the next launch checks it"
        );
        assert!(
            agents::usable(&shown.unwrap()).is_empty(),
            "calls leave it out"
        );

        // A probe that couldn't run at all forgets it too.
        let again = setup::Setup {
            setup_files: vec!["/x".into()],
            ..timed_out.clone()
        };
        let ready_again = setup::Setup {
            step: setup::Step::Ready,
            session: true,
            ..again
        };
        agent_checks::record(&conn, "goose", &ready_again, &fingerprint, 0).unwrap();
        assert!(!agent_checks::all(&conn).unwrap().is_empty());
        assert_eq!(settle_failure(&conn, &agents, "goose", None).unwrap(), None);
        assert!(agent_checks::all(&conn).unwrap().is_empty());
    }

    #[test]
    fn keeps_every_pick_but_those_that_fell_away_with_the_new_one() {
        let setting = |id: &str| setup::Setting {
            id: id.into(),
            name: id.into(),
            category: None,
            current: String::new(),
            options: Vec::new(),
        };
        let skipped = |setting: &str, why| setup::Skipped {
            setting: setting.into(),
            name: setting.into(),
            value: String::new(),
            why,
        };
        let listed = |skipped| Listed {
            setup: setup::Setup {
                skipped,
                ..setup::Setup::default()
            },
            settings: vec![setting("provider"), setting("model"), setting("effort")],
        };
        let picks = vec![
            pick("effort", "max"),
            pick("model", "kimi"),
            pick("provider", "p"),
        ];

        // A new provider: the model it no longer offers falls away with it.
        assert_eq!(
            to_save(
                picks.clone(),
                &listed(vec![skipped("model", Why::Gone)]),
                &pick("provider", "p")
            ),
            [pick("provider", "p"), pick("effort", "max")]
        );
        // A new effort: a provider refused today and its model stay saved.
        assert_eq!(
            to_save(
                picks,
                &listed(vec![
                    skipped("provider", Why::Refused),
                    skipped("model", Why::Gone)
                ]),
                &pick("effort", "max")
            ),
            [
                pick("provider", "p"),
                pick("model", "kimi"),
                pick("effort", "max")
            ]
        );
    }
}
