//! An app for tests: Tauri's mock runtime, no window, with the state the core's commands
//! use on a fresh in-memory database and keys kept in memory, so a test runs what a command
//! runs and never touches this Mac's keychain or data.

use tauri::Manager;
use tauri::test::{MockRuntime, mock_app};

use crate::agents::Agents;
use crate::credentials::{LiveKitKeys, Vault};
use crate::db::Db;
use crate::local_server::LocalServer;
use crate::{agent_picks, calls};

/// The app, with `agents` as the last look found them.
pub fn app_with(agents: Agents) -> tauri::App<MockRuntime> {
    let app = mock_app();
    app.manage(Db::in_memory().unwrap());
    app.manage(Vault::in_memory());
    app.manage(agents);
    app.manage(agent_picks::Listings::default());
    app.manage(calls::CallAgents::default());
    // Never started: nothing in the tests asks for this Mac's server.
    let nowhere = std::env::temp_dir().join("bomby-tests-no-server");
    app.manage(LocalServer::new(
        nowhere.join("livekit-server"),
        nowhere.clone(),
        nowhere,
    ));
    app
}

pub fn app() -> tauri::App<MockRuntime> {
    app_with(Agents::default())
}

/// LiveKit Cloud keys, saved in the app's vault.
pub fn their_livekit(app: &tauri::App<MockRuntime>) {
    app.state::<Vault>().save_livekit_for_tests(LiveKitKeys {
        url: "wss://test.livekit.cloud".into(),
        api_key: "APIkey".into(),
        api_secret: "a-secret-long-enough-for-a-token-0123456789".into(),
    });
}
