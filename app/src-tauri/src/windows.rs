//! Windows besides `main` (which tauri.conf.json creates). Each has its own HTML entry
//! (a Vite page) and its own capability file.

use tauri::{
    AppHandle, Manager, PhysicalPosition, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

use crate::error::Result;

pub const MAIN: &str = "main";
pub const SETTINGS: &str = "settings";

const SETTINGS_SIZE: (f64, f64) = (720.0, 500.0);

/// Opens the settings window centered over the main window, or brings it forward when it is
/// already open. Async because building a window from a sync command deadlocks on Windows
/// (Tauri docs).
#[tauri::command]
pub async fn open_settings<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    if let Some(window) = app.get_webview_window(SETTINGS) {
        window.set_focus()?;
        return Ok(());
    }

    let (width, height) = SETTINGS_SIZE;
    let builder =
        WebviewWindowBuilder::new(&app, SETTINGS, WebviewUrl::App("settings.html".into()))
            .title("Settings")
            .inner_size(width, height)
            .resizable(false)
            .minimizable(false)
            .maximizable(false)
            // Cmd/Ctrl + = - 0 zoom, like the main window (tauri.conf.json).
            .zoom_hotkeys_enabled(true)
            // Placed before it is shown, so it never flashes on another monitor.
            .visible(false);

    // Same look as the main window (tauri.conf.json): the page draws under a transparent
    // title bar, traffic lights centered in the h-titlebar row.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(20.0, 30.0));

    let settings = builder.build()?;
    match app.get_webview_window(MAIN) {
        Some(main) => settings.set_position(centered_over(&main, &settings)?)?,
        None => settings.center()?,
    }
    settings.show()?;
    settings.set_focus()?;
    Ok(())
}

/// Brings the main window back: from the menu bar, the Dock, or a hidden window (closing it
/// hides it, so the app and any call keep running; lib.rs).
pub fn show_main<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    if let Some(main) = app.get_webview_window(MAIN) {
        main.unminimize()?;
        main.show()?;
        main.set_focus()?;
    }
    Ok(())
}

/// The top-left corner that centers `window` over `parent`, in physical pixels, which are
/// global across monitors.
fn centered_over<R: Runtime>(
    parent: &WebviewWindow<R>,
    window: &WebviewWindow<R>,
) -> Result<PhysicalPosition<i32>> {
    let origin = parent.outer_position()?;
    let outer = parent.outer_size()?;
    let size = window.outer_size()?;
    // The new window may have been laid out on another monitor; size it at the parent's scale.
    let rescale = parent.scale_factor()? / window.scale_factor()?;
    let (width, height) = (
        f64::from(size.width) * rescale,
        f64::from(size.height) * rescale,
    );
    Ok(PhysicalPosition::new(
        origin.x + ((f64::from(outer.width) - width) / 2.0) as i32,
        origin.y + ((f64::from(outer.height) - height) / 2.0) as i32,
    ))
}
