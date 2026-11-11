//! Windows besides `main` (which tauri.conf.json creates). Each has its own HTML entry
//! (a Vite page) and its own capability file.

use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::app_log;
use crate::error::Result;

pub const MAIN: &str = "main";
pub const SETTINGS: &str = "settings";

const SETTINGS_SIZE: (f64, f64) = (720.0, 500.0);

/// The main window's share of its screen's usable area when it opens, and its largest and
/// least size there, in logical pixels (the least is tauri.conf.json's minimum).
const MAIN_SHARE: f64 = 0.8;
const MAIN_MAX: (f64, f64) = (1600.0, 1040.0);
const MAIN_MIN: (f64, f64) = (820.0, 560.0);

/// Sizes the main window to its screen and centers it there, then shows it: tauri.conf.json
/// creates it hidden, so it never shows at its first size and place. A window that can't be
/// placed still shows, where macOS puts it.
pub fn place_main<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let Some(main) = app.get_webview_window(MAIN) else {
        return Ok(());
    };
    if let Err(e) = fit_to_screen(&main) {
        let _ = app_log::append(app, &format!("main window: not placed: {e}"));
    }
    main.show()?;
    main.set_focus()?;
    Ok(())
}

fn fit_to_screen<R: Runtime>(main: &WebviewWindow<R>) -> Result<()> {
    let monitor = match main.current_monitor()? {
        Some(monitor) => monitor,
        None => match main.primary_monitor()? {
            Some(monitor) => monitor,
            None => return Ok(()),
        },
    };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let (width, height) = main_size(
        f64::from(area.size.width) / scale,
        f64::from(area.size.height) / scale,
    );
    main.set_size(LogicalSize::new(width, height))?;
    main.set_position(PhysicalPosition::new(
        area.position.x + ((f64::from(area.size.width) - width * scale) / 2.0) as i32,
        area.position.y + ((f64::from(area.size.height) - height * scale) / 2.0) as i32,
    ))?;
    Ok(())
}

/// The main window's size on a screen whose usable area is `width` by `height`, logical.
fn main_size(width: f64, height: f64) -> (f64, f64) {
    let fit = |area: f64, max: f64, min: f64| (area * MAIN_SHARE).min(max).max(min).min(area);
    (
        fit(width, MAIN_MAX.0, MAIN_MIN.0).round(),
        fit(height, MAIN_MAX.1, MAIN_MIN.1).round(),
    )
}

/// The main window rendered (the splash or the workspace) and its read of the agents
/// answered: a line in `app.log`, and half of what the launch smoke check waits for
/// ([`crate::smoke`]).
#[tauri::command]
pub fn main_window_ready<R: Runtime>(app: AppHandle<R>, ready: crate::smoke::PageReady) {
    crate::smoke::page_ready(&app, ready);
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_main_window_takes_most_of_its_screen_within_its_limits() {
        assert_eq!(main_size(1440.0, 875.0), (1152.0, 700.0), "a laptop");
        assert_eq!(
            main_size(2560.0, 1415.0),
            (1600.0, 1040.0),
            "a large display, capped"
        );
        assert_eq!(
            main_size(900.0, 600.0),
            (820.0, 560.0),
            "a small screen, the least"
        );
        assert_eq!(
            main_size(800.0, 500.0),
            (800.0, 500.0),
            "never bigger than the screen"
        );
    }
}
