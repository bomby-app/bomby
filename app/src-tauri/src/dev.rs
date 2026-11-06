//! Switches for trying the app's states in development without changing this Mac, set by
//! `just app dev`'s flags (app.just). Debug builds only: a release ignores them.
//!
//! - `BOMBY_DEV_SPLASH=1` (`--splash`): the first-run splash shows at every launch.
//! - `BOMBY_DEV_AGENTS` (`--agents=none`, `--agents=codex,goose`): only the agents listed
//!   are found, the rest look not installed. `none` hides them all.
//!
//! `--signed-out` needs nothing here: it points `CLAUDE_CONFIG_DIR` at an empty folder,
//! which every Claude Code the app starts inherits, so it really is signed out.

const SPLASH: &str = "BOMBY_DEV_SPLASH";
const AGENTS: &str = "BOMBY_DEV_AGENTS";

fn var(name: &str) -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

/// Whether the splash shows at every launch.
pub fn always_splash() -> bool {
    var(SPLASH).is_some()
}

/// Whether agent `id` may be found, or looks not installed.
pub fn agent_shown(id: &str) -> bool {
    var(AGENTS).is_none_or(|list| listed(&list, id))
}

fn listed(list: &str, id: &str) -> bool {
    list.split(',').map(str::trim).any(|listed| listed == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_agents_listed_are_shown() {
        assert!(listed("codex, goose", "goose"));
        assert!(!listed("codex,goose", "claude"));
        assert!(!listed("none", "claude"));
    }
}
