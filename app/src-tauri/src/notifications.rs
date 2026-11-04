//! A notification when an agent finishes or fails while the user is away from Bomby: "Claude's
//! done · fix-login". The main window's page sees the call's tasks (`bomby.tasks`) and reports
//! each one that ends; the core shows it only when no Bomby window is focused. A click opens
//! the project, and so the call.
//!
//! `tauri-plugin-notification` posts through macOS's `NSUserNotificationCenter`: as Terminal
//! under `tauri dev`, as `app.bomby.desktop` once built (docs/tauri-notes.md).

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_notification::NotificationExt;

use crate::error::Result;
use crate::{app_log, windows};

/// Sent to the main window: show this project (its id).
pub const OPEN_PROJECT: &str = "open-project";

const PROJECT: &str = "projectId";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Done,
    Failed,
}

/// A task that ended, as the page reports it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishedTask {
    pub project_id: i64,
    /// "Claude": the agent's short name.
    pub agent_name: String,
    pub session: String,
    pub status: Outcome,
    /// What it was asked, already shortened by the agent.
    pub task: String,
}

impl FinishedTask {
    fn title(&self) -> String {
        let (agent, session) = (&self.agent_name, &self.session);
        match self.status {
            Outcome::Done => format!("{agent}'s done · {session}"),
            Outcome::Failed => format!("{agent} couldn't finish · {session}"),
        }
    }
}

/// Opens the project when a notification is clicked. With a handler registered, the plugin
/// waits on a thread for each notification's click.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let handle = app.clone();
    app.notification().on_action(move |performed| {
        if performed.action_id() != "tap" {
            return;
        }
        let project = performed
            .notification()
            .and_then(|n| n.extra().get(PROJECT))
            .and_then(Value::as_i64);
        let shown = windows::show_main(&handle).and_then(|()| match project {
            Some(id) => Ok(handle.emit_to(windows::MAIN, OPEN_PROJECT, id)?),
            None => Ok(()),
        });
        if let Err(e) = shown {
            let _ = app_log::append(&handle, &format!("notification click: {e}"));
        }
    })?;
    Ok(())
}

#[tauri::command]
pub fn task_finished<R: Runtime>(app: AppHandle<R>, task: FinishedTask) -> Result<()> {
    // The user is looking at Bomby, where the agents panel already says so.
    if app
        .webview_windows()
        .values()
        .any(|window| window.is_focused().unwrap_or(false))
    {
        return Ok(());
    }
    app.notification()
        .builder()
        .title(task.title())
        .body(&task.task)
        .extra(PROJECT, task.project_id)
        .show()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(status: Outcome) -> FinishedTask {
        FinishedTask {
            project_id: 1,
            agent_name: "Claude".into(),
            session: "fix-login".into(),
            status,
            task: "Fix the login redirect".into(),
        }
    }

    #[test]
    fn says_who_finished_which_session() {
        assert_eq!(task(Outcome::Done).title(), "Claude's done · fix-login");
        assert_eq!(
            task(Outcome::Failed).title(),
            "Claude couldn't finish · fix-login"
        );
    }

    #[test]
    fn reads_the_pages_report() {
        let task: FinishedTask = serde_json::from_str(
            r#"{"projectId":4,"agentName":"Codex","session":"tests","status":"failed","task":"Run the tests"}"#,
        )
        .unwrap();
        assert_eq!(task.project_id, 4);
        assert_eq!(task.status, Outcome::Failed);
    }
}
