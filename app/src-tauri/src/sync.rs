//! Locks that outlive a panic. A panic while one is held only poisons it; the data inside is
//! still whole for everything the core keeps (caches, slots, the connection), so callers
//! carry on with it rather than fail every later command. std's non-poisoning `Mutex` is
//! still nightly-only (`sync_nonpoison`, Rust 1.99).

use std::sync::{Mutex, MutexGuard, PoisonError};

/// Locks `mutex`, poisoned or not.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
