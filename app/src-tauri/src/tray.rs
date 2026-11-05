//! The menu bar icon. The mascot's eyes follow the call, one template image per state (Paper
//! `app assets`, `tray-icon-*-template`); the Motion board's rule is to swap images and never
//! animate the menu bar. The call lives in the main window's page, so the page reports a
//! `TrayStatus` with `set_tray_status` and the core draws the icon and menu from it. Menu
//! choices that belong to the call go back to the main window as events.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, include_image};

use crate::error::Result;
use crate::sync;
use crate::{app_log, windows};

const ID: &str = "bomby";

/// Sent to the main window: start a call on this project (its id).
pub const START_CALL: &str = "tray-start-call";
/// Sent to the main window: end the call.
pub const END_CALL: &str = "tray-end-call";

/// The mascot's state in the menu bar (docs/brand.md, "Mascot states and motion").
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrayState {
    /// No call.
    #[default]
    Idle,
    Waking,
    Listening,
    Thinking,
    Speaking,
    /// An agent is working, and the voice is listening.
    Working,
    Failed,
}

impl TrayState {
    /// 36 px templates: tray-icon draws the image 18 points tall on macOS, so they map 1:1
    /// on a Retina display. macOS tints them for the menu bar.
    fn image(self) -> Image<'static> {
        match self {
            Self::Idle => include_image!("icons/tray/idle.png"),
            Self::Waking => include_image!("icons/tray/waking.png"),
            Self::Listening => include_image!("icons/tray/listening.png"),
            Self::Thinking => include_image!("icons/tray/thinking.png"),
            Self::Speaking => include_image!("icons/tray/speaking.png"),
            Self::Working => include_image!("icons/tray/working.png"),
            Self::Failed => include_image!("icons/tray/failed.png"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct RecentProject {
    pub id: i64,
    pub name: String,
}

/// What the page knows and the tray shows.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayStatus {
    pub state: TrayState,
    /// The project on a call, while there is one.
    pub call: Option<String>,
    /// Whether that call is still starting (the core is getting the agent ready). It can't
    /// be ended yet: ending a call that hasn't joined wouldn't stop it from joining.
    pub starting: bool,
    /// Projects to start a call on, the newest call first.
    pub recent: Vec<RecentProject>,
    /// Why a call can't start yet ("Add your Gemini key in Settings first."), if it can't.
    pub blocked: Option<String>,
}

impl TrayStatus {
    fn same_menu(&self, other: &Self) -> bool {
        self.call == other.call
            && self.starting == other.starting
            && self.recent == other.recent
            && self.blocked == other.blocked
    }
}

/// The last status drawn.
#[derive(Default)]
pub struct Tray(Mutex<TrayStatus>);

/// Whether a call is on, or starting, as the page last reported.
pub fn on_call<R: Runtime>(app: &AppHandle<R>) -> bool {
    sync::lock(&app.state::<Tray>().0).call.is_some()
}

/// Puts the mascot in the menu bar. Its menu opens on a click, as menu bar items do on macOS.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let status = TrayStatus::default();
    TrayIconBuilder::with_id(ID)
        .icon(status.state.image())
        .icon_as_template(true)
        .tooltip("Bomby")
        .show_menu_on_left_click(true)
        .menu(&menu(app, &status)?)
        .on_menu_event(on_menu_event)
        .build(app)?;
    app.manage(Tray::default());
    Ok(())
}

/// The page's latest status. Swaps the icon when the state changes and rebuilds the menu
/// only when what it lists changes, since the state changes with every sentence.
#[tauri::command]
pub fn set_tray_status<R: Runtime>(
    app: AppHandle<R>,
    tray: State<'_, Tray>,
    status: TrayStatus,
) -> Result<()> {
    let mut last = sync::lock(&tray.0);
    let Some(icon) = app.tray_by_id(ID) else {
        return Ok(());
    };
    if last.state != status.state {
        icon.set_icon_with_as_template(Some(status.state.image()), true)?;
    }
    if !last.same_menu(&status) {
        icon.set_menu(Some(menu(&app, &status)?))?;
    }
    *last = status;
    Ok(())
}

fn menu<R: Runtime>(app: &AppHandle<R>, status: &TrayStatus) -> Result<Menu<R>> {
    let menu = Menu::new(app)?;
    if let Some(project) = &status.call {
        let line = if status.starting {
            format!("Starting a call · {project}")
        } else {
            format!("On a call · {project}")
        };
        menu.append(&note(app, &line)?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    menu.append(&item(app, "open", "Open Bomby")?)?;
    menu.append(&start_menu(app, status)?)?;
    if can_end(status) {
        menu.append(&item(app, "end-call", "End call")?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&item(app, "settings", "Settings…")?)?;
    menu.append(&PredefinedMenuItem::quit(app, Some("Quit Bomby"))?)?;
    Ok(menu)
}

/// End call is offered once the call has started, as in the main window.
fn can_end(status: &TrayStatus) -> bool {
    status.call.is_some() && !status.starting
}

/// "Start a call", with the recent projects. Off during a call (one call at a time); when a
/// call can't start, it says why instead.
fn start_menu<R: Runtime>(app: &AppHandle<R>, status: &TrayStatus) -> Result<Submenu<R>> {
    let submenu = Submenu::new(app, "Start a call", status.call.is_none())?;
    if let Some(reason) = &status.blocked {
        submenu.append(&note(app, reason)?)?;
    } else if status.recent.is_empty() {
        submenu.append(&note(app, "Add a folder and start talking.")?)?;
    } else {
        for project in &status.recent {
            submenu.append(&item(app, &format!("call:{}", project.id), &project.name)?)?;
        }
    }
    Ok(submenu)
}

/// A menu choice; `on_menu_event` acts on its `id`.
fn item<R: Runtime>(app: &AppHandle<R>, id: &str, label: &str) -> Result<MenuItem<R>> {
    Ok(MenuItem::with_id(app, id, label, true, None::<&str>)?)
}

/// A line of text that can't be chosen.
fn note<R: Runtime>(app: &AppHandle<R>, text: &str) -> Result<MenuItem<R>> {
    Ok(MenuItem::new(app, text, false, None::<&str>)?)
}

fn on_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();
    let done = match id {
        "open" => windows::show_main(app),
        "end-call" => app.emit_to(windows::MAIN, END_CALL, ()).map_err(Into::into),
        "settings" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = windows::open_settings(app.clone()).await {
                    let _ = app_log::append(&app, &format!("tray: settings: {e}"));
                }
            });
            Ok(())
        }
        _ => match id.strip_prefix("call:").and_then(|p| p.parse::<i64>().ok()) {
            Some(project) => windows::show_main(app).and_then(|()| {
                app.emit_to(windows::MAIN, START_CALL, project)
                    .map_err(Into::into)
            }),
            None => Ok(()),
        },
    };
    if let Err(e) = done {
        let _ = app_log::append(app, &format!("tray: {id}: {e}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_pages_status() {
        let status: TrayStatus = serde_json::from_str(
            r#"{"state":"working","call":"samba","starting":false,"recent":[{"id":3,"name":"samba"}],"blocked":null}"#,
        )
        .unwrap();
        assert_eq!(status.state, TrayState::Working);
        assert_eq!(status.call.as_deref(), Some("samba"));
        assert_eq!(status.recent[0].id, 3);
    }

    #[test]
    fn only_listed_things_rebuild_the_menu() {
        let idle = TrayStatus::default();
        let speaking = TrayStatus {
            state: TrayState::Speaking,
            ..TrayStatus::default()
        };
        let on_call = TrayStatus {
            call: Some("samba".into()),
            ..TrayStatus::default()
        };
        assert!(idle.same_menu(&speaking));
        assert!(!idle.same_menu(&on_call));
        let starting = TrayStatus {
            starting: true,
            ..on_call.clone()
        };
        assert!(!on_call.same_menu(&starting));
    }

    #[test]
    fn a_call_can_be_ended_only_once_it_has_started() {
        let on_call = TrayStatus {
            call: Some("samba".into()),
            ..TrayStatus::default()
        };
        let starting = TrayStatus {
            starting: true,
            ..on_call.clone()
        };
        assert!(can_end(&on_call));
        assert!(!can_end(&starting));
        assert!(!can_end(&TrayStatus::default()));
    }
}
