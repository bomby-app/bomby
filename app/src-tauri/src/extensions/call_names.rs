//! Call names: Bomby names the call once it knows what it's about
//! (docs/decisions/call-names-and-sessions.md). The name is the call's own (`calls.rs`), and
//! the user renames calls whether this is on or not; the extension only gives Bomby its
//! tool, which reaches `calls::rename_call` over RPC (`features/call-names/`), and the name
//! the call has when it starts.

use rusqlite::Connection;

use crate::calls;
use crate::error::Result;

/// Its id in the catalogue (`agent/extensions/call_names.py`).
pub const ID: &str = "call_names";

/// What the call starts knowing: its name and who gave it, both null until it has one
/// (`CallNameData` in `agent/extensions/call_names.py`).
pub(crate) fn for_call(conn: &Connection, call_id: i64) -> Result<serde_json::Value> {
    Ok(serde_json::to_value(calls::name_of(conn, call_id)?).unwrap_or_default())
}
