//! What the user picked when setting each agent up: its model, how hard it thinks and, for
//! goose, its provider (docs/decisions/set-up-every-agent-the-same-way.md). Only an agent
//! set up here is offered to calls, and each call applies its choices to every session it
//! opens. The choices are the agent's own session settings over ACP, so nothing in the
//! agent's own config changes.

use std::collections::HashMap;

use rusqlite::{Connection, params};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::agents::{self, AgentStatus, Agents};
use crate::db::{Db, now_ms};
use crate::error::{Error, Result};
use crate::setup::{self, Choice, Setup};

/// Every set-up agent's choices, in the order they're applied. An agent set up with no
/// settings to pick (one that lists none) has an empty list.
pub fn saved(conn: &Connection) -> Result<HashMap<String, Vec<Choice>>> {
    let mut choices: HashMap<String, Vec<Choice>> = conn
        .prepare("SELECT agent FROM agent_setups")?
        .query_map([], |row| row.get(0))?
        .map(|agent| agent.map(|agent| (agent, Vec::new())))
        .collect::<rusqlite::Result<_>>()?;
    let mut rows =
        conn.prepare("SELECT agent, setting, value FROM agent_choices ORDER BY agent, position")?;
    let picked = rows.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            Choice {
                setting: row.get(1)?,
                value: row.get(2)?,
            },
        ))
    })?;
    for row in picked {
        let (agent, choice) = row?;
        choices.entry(agent).or_default().push(choice);
    }
    Ok(choices)
}

/// Saves `agent`'s setup, replacing the one before.
fn save(conn: &mut Connection, agent: &str, choices: &[Choice]) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO agent_setups (agent, set_up_at) VALUES (?1, ?2)
         ON CONFLICT (agent) DO UPDATE SET set_up_at = excluded.set_up_at",
        params![agent, now_ms()],
    )?;
    tx.execute("DELETE FROM agent_choices WHERE agent = ?1", [agent])?;
    let mut insert = tx.prepare(
        "INSERT INTO agent_choices (agent, position, setting, value) VALUES (?1, ?2, ?3, ?4)",
    )?;
    for (position, choice) in (0_i64..).zip(choices) {
        insert.execute(params![agent, position, choice.setting, choice.value])?;
    }
    drop(insert);
    tx.commit()?;
    Ok(())
}

/// The installed `agent`'s program, as the last look found it.
fn program<R: Runtime>(app: &AppHandle<R>, agent: &str) -> Result<std::path::PathBuf> {
    let found = app.state::<Agents>().cached().unwrap_or_default();
    agents::installed(&found)
        .into_iter()
        .find_map(|(id, path)| (id == agent).then_some(path))
        .ok_or(Error::NotFound("agent"))
}

/// What setting `agent` up offers with `choices` picked so far: its sign-in, and its
/// settings as they stand once those are applied. A choice can change what the next one
/// offers (goose's models follow its provider), so the setup flow asks again after each.
#[tauri::command(async)]
pub fn agent_setup_options<R: Runtime>(
    app: AppHandle<R>,
    agent: String,
    choices: Vec<Choice>,
) -> Result<Setup> {
    let path = program(&app, &agent)?;
    let choices = HashMap::from([(agent.clone(), choices)]);
    setup::probe(&[(agent.clone(), path)], &choices, Some(&agent))
        .and_then(|mut setups| setups.remove(&agent))
        .ok_or_else(|| Error::Invalid("Bomby couldn't reach the agent. Try again?".into()))
}

/// Saves `agent`'s setup, then looks at the agents again, so Settings and the next call
/// see it, and returns what that look found.
#[tauri::command(async)]
pub fn save_agent_setup<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    agent: String,
    choices: Vec<Choice>,
) -> Result<Vec<AgentStatus>> {
    let _ = program(&app, &agent)?;
    save(&mut db.conn(), &agent, &choices)?;
    Ok(agents::refresh_after_change(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choice(setting: &str, value: &str) -> Choice {
        Choice {
            setting: setting.into(),
            value: value.into(),
        }
    }

    #[test]
    fn keeps_each_agents_choices_in_order_and_replaces_them_on_a_new_setup() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn();
        assert!(
            saved(&conn).unwrap().is_empty(),
            "nothing is set up at first"
        );

        let goose = [choice("provider", "openrouter"), choice("model", "kimi")];
        save(&mut conn, "goose", &goose).unwrap();
        save(&mut conn, "omp", &[]).unwrap();
        let all = saved(&conn).unwrap();
        assert_eq!(all["goose"], goose);
        assert_eq!(all["omp"], [], "set up with nothing to pick");

        save(&mut conn, "goose", &[choice("model", "deepseek")]).unwrap();
        assert_eq!(
            saved(&conn).unwrap()["goose"],
            [choice("model", "deepseek")]
        );
    }
}
