//! The session settings the user picked for each agent: its model, how hard it thinks and,
//! for goose, its provider (docs/decisions/pick-agent-settings-like-buzz-and-zed.md).
//! Picking is optional; an agent without picks runs on its own defaults. Each call applies
//! the picks to every session it opens, as the agent's own session settings over ACP, so
//! nothing in the agent's own config changes.

use std::collections::HashMap;
use std::path::PathBuf;

use rusqlite::{Connection, params};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::agents::{self, Agents, CHANGED};
use crate::db::Db;
use crate::error::{Error, Result};
use crate::setup::{self, Listed, Pick};

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

/// What `agent` lets the user pick, with `picks` applied, asked of the agent itself (one
/// short-lived probe, a few seconds).
fn list<R: Runtime>(app: &AppHandle<R>, agent: &str, picks: &[Pick]) -> Result<Listed> {
    let path = program(app, agent)?;
    let picks = HashMap::from([(agent.to_owned(), picks.to_vec())]);
    setup::probe(&[(agent.to_owned(), path)], &picks, Some(agent))
        .and_then(|mut listed| listed.remove(agent))
        .ok_or_else(|| Error::Unreachable("Bomby couldn't reach the agent. Try again?".into()))
}

/// What the model picker shows for `agent` when it opens: its settings, its picks applied.
#[tauri::command(async)]
pub fn agent_settings<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    agent: String,
) -> Result<Listed> {
    let picks = saved(&db.conn())?.remove(&agent).unwrap_or_default();
    list(&app, &agent, &picks)
}

/// Applies `agent`'s picks, saves them once the agent has answered, and returns its settings
/// with them applied. A pick can change what the next one offers (goose's models follow its
/// provider), so the picker shows this answer. Only this agent's row changes: the windows get
/// the list with its new setup.
#[tauri::command(async)]
pub fn pick_agent_settings<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    agent: String,
    picks: Vec<Pick>,
) -> Result<Listed> {
    // Asked first, so a pick is saved only with a setup to show for it.
    let listed = list(&app, &agent, &picks)?;
    save(&mut db.conn(), &agent, &picks)?;
    if let Some(found) = app.state::<Agents>().replace_setup(&agent, &listed.setup) {
        // Only fails for an invalid event name or payload.
        let _ = app.emit(CHANGED, &found);
    }
    Ok(listed)
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

        save(&mut conn, "goose", &[pick("model", "deepseek")]).unwrap();
        assert_eq!(saved(&conn).unwrap()["goose"], [pick("model", "deepseek")]);

        save(&mut conn, "claude", &[]).unwrap();
        assert!(
            !saved(&conn).unwrap().contains_key("claude"),
            "back on its defaults"
        );
    }
}
