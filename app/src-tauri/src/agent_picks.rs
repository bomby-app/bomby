//! The session settings the user picked for each agent: its model, how hard it thinks and,
//! for goose, its provider (docs/decisions/pick-agent-settings-like-buzz-and-zed.md).
//! Picking is optional; an agent without picks runs on its own defaults. Each call applies
//! the picks to every session it opens, as the agent's own session settings over ACP, so
//! nothing in the agent's own config changes.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};

use rusqlite::{Connection, params};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::agents::{self, Agents, CHANGED};
use crate::db::Db;
use crate::error::{Error, Result};
use crate::setup::{self, Listed, Pick, Why};
use crate::sync;

/// One pick or listing per agent at a time, so two windows can't leave its saved picks and
/// its row apart. Each takes a probe of seconds; other agents' don't wait on it.
static PICKING: LazyLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = LazyLock::new(Default::default);

/// `agent`'s lock in [`PICKING`].
fn one_at_a_time(agent: &str) -> Arc<Mutex<()>> {
    Arc::clone(sync::lock(&PICKING).entry(agent.to_owned()).or_default())
}

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

/// What `agent` lets the user pick, with `picks` applied, asked of the agent itself (one
/// short-lived probe, a few seconds).
fn list<R: Runtime>(app: &AppHandle<R>, agent: &str, picks: &[Pick]) -> Result<Listed> {
    let path = program(app, agent)?;
    let picks = HashMap::from([(agent.to_owned(), picks.to_vec())]);
    setup::probe(&[(agent.to_owned(), path)], &picks, Some(agent))
        .and_then(|mut listed| listed.remove(agent))
        .ok_or_else(|| Error::Invalid(UNREACHABLE.into()))
}

/// Tells every window about `found`, the list after a row changed, if one did.
fn show<R: Runtime>(app: &AppHandle<R>, found: Option<Vec<agents::AgentStatus>>) {
    if let Some(found) = found {
        // Only fails for an invalid event name or payload.
        let _ = app.emit(CHANGED, &found);
    }
}

/// What the model picker shows for `agent` when it opens: its settings, its picks applied.
/// Its row follows, so it shows a pick found gone, and the model of an agent the looks open
/// no session in (omp).
#[tauri::command(async)]
pub fn agent_settings<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    agent: String,
) -> Result<Listed> {
    let lock = one_at_a_time(&agent);
    let _one = sync::lock(&lock);
    let listed = list(&app, &agent, &saved_for(&db.conn(), &agent)?)?;
    if listed.setup.session {
        show(
            &app,
            app.state::<Agents>().replace_setup(&agent, &listed.setup),
        );
    }
    Ok(listed)
}

/// Adds `pick` to `agent`'s saved picks, in place of an earlier one for the same setting, and
/// returns its settings with them applied. Only what the user picked is saved: a setting they
/// never touched keeps following the agent's own default. A pick can change what the next
/// one offers (goose's models follow its provider), so the picker shows this answer.
///
/// Saved only once the agent has answered with a session and taken `pick`; until then the
/// saved picks stay as they were, and the error says why. Only this agent's row changes.
#[tauri::command(async)]
pub fn pick_agent_settings<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    agent: String,
    pick: Pick,
) -> Result<Listed> {
    let lock = one_at_a_time(&agent);
    let _one = sync::lock(&lock);
    let mut picks = saved_for(&db.conn(), &agent)?;
    picks.retain(|p| p.setting != pick.setting);
    picks.push(pick.clone());
    let listed = list(&app, &agent, &picks)?;
    if !listed.setup.session {
        // It didn't get as far as a session (it timed out, say).
        return Err(Error::Invalid(
            listed.setup.problem.unwrap_or_else(|| UNREACHABLE.into()),
        ));
    }
    if let Some(why) = not_taken(&listed, &pick, &agent) {
        return Err(Error::Invalid(why));
    }
    save(&mut db.conn(), &agent, &held(picks, &listed))?;
    show(&app, app.state::<Agents>().picked(&agent, &listed.setup));
    Ok(listed)
}

/// Why the agent didn't take `pick`, if it didn't: "Codex wouldn't take that model".
fn not_taken(listed: &Listed, pick: &Pick, agent: &str) -> Option<String> {
    let skipped = listed
        .setup
        .skipped
        .iter()
        .find(|s| s.setting == pick.setting)?;
    let (name, setting) = (
        agents::name(agent).unwrap_or(agent),
        skipped.name.to_lowercase(),
    );
    Some(match skipped.why {
        Why::Refused => {
            format!("{name} wouldn't take that {setting}, so nothing changed. Pick another.")
        }
        Why::Gone => format!("{name} doesn't offer that {setting} any more. Pick another."),
    })
}

/// The `picks` that held in `listed`, in the agent's own order: one that fell away with the
/// new pick (a model gone with its provider) leaves its default rather than being saved.
fn held(mut picks: Vec<Pick>, listed: &Listed) -> Vec<Pick> {
    picks.retain(|p| !listed.setup.skipped.iter().any(|s| s.setting == p.setting));
    let order = |p: &Pick| {
        listed
            .settings
            .iter()
            .position(|s| s.id == p.setting)
            .unwrap_or(usize::MAX)
    };
    picks.sort_by_key(order);
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

    #[test]
    fn keeps_each_agents_picks_in_order_and_replaces_them() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn();
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

        assert_eq!(
            not_taken(&listed(vec![skipped("model", Why::Refused)]), &new, "codex").as_deref(),
            Some("Codex wouldn't take that model, so nothing changed. Pick another.")
        );
        assert_eq!(
            not_taken(&listed(vec![skipped("effort", Why::Gone)]), &new, "codex"),
            None,
            "another setting falling away doesn't undo this pick"
        );
    }

    #[test]
    fn keeps_only_the_picks_that_held_in_the_agents_order() {
        let setting = |id: &str| setup::Setting {
            id: id.into(),
            name: id.into(),
            category: None,
            current: String::new(),
            options: Vec::new(),
        };
        let listed = Listed {
            setup: setup::Setup {
                skipped: vec![setup::Skipped {
                    setting: "effort".into(),
                    name: "Effort".into(),
                    value: "max".into(),
                    why: setup::Why::Refused,
                }],
                ..setup::Setup::default()
            },
            settings: vec![setting("provider"), setting("model"), setting("effort")],
        };
        let picks = vec![
            pick("model", "kimi"),
            pick("effort", "max"),
            pick("provider", "p"),
        ];

        assert_eq!(
            held(picks, &listed),
            [pick("provider", "p"), pick("model", "kimi")]
        );
    }
}
