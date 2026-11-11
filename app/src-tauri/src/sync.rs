//! Locks that outlive a panic, and locks a thread can't take twice.
//!
//! A panic while a lock is held only poisons it; the data inside is still whole for
//! everything the core keeps (caches, slots, the connection), so callers carry on with it
//! rather than fail every later command. std's non-poisoning `Mutex` is still nightly-only
//! (`sync_nonpoison`, Rust 1.99).
//!
//! std's `Mutex` isn't re-entrant: a thread that locks one it already holds waits for
//! itself forever (Bomby 0.3.2 hung at launch that way, on the database). [`Exclusive`] is
//! for the locks the whole core shares (the database, the keychain): it knows which ones
//! this thread holds, and locking one again fails at once instead
//! (docs/decisions/locks-that-cant-be-taken-twice.md).

use std::cell::RefCell;
use std::ops::{Deref, DerefMut};
use std::sync::{Mutex, MutexGuard, PoisonError};

use crate::error::{Error, Result};

/// Locks `mutex`, poisoned or not.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

thread_local! {
    /// The [`Exclusive`] locks this thread holds, by address.
    static HELD: RefCell<Vec<usize>> = const { RefCell::new(Vec::new()) };
}

/// A lock that outlives a panic, like [`lock`], and that the thread holding it can't take
/// again: a second [`Exclusive::lock`] on the same thread panics in debug builds and tests,
/// so the mistake fails the test that reaches it, and returns [`Error::Reentered`] in a
/// release, so the command fails and says why instead of hanging the app.
///
/// A guard can't move to another thread (std's `MutexGuard` isn't `Send`), so the thread
/// that locked is the one that unlocks.
pub struct Exclusive<T> {
    /// What it guards, for the error: "the database".
    what: &'static str,
    mutex: Mutex<T>,
}

impl<T> Exclusive<T> {
    pub const fn new(what: &'static str, value: T) -> Self {
        Self {
            what,
            mutex: Mutex::new(value),
        }
    }

    /// Waits for the lock, unless this thread holds it already.
    pub fn lock(&self) -> Result<ExclusiveGuard<'_, T>> {
        let id = std::ptr::from_ref(self).addr();
        if held(id) {
            let error = Error::Reentered(self.what);
            debug_assert!(false, "{error}");
            return Err(error);
        }
        let guard = lock(&self.mutex);
        HELD.with_borrow_mut(|held| held.push(id));
        Ok(ExclusiveGuard { guard, id })
    }

    /// Whether this thread holds the lock now.
    #[cfg(test)]
    pub fn held_here(&self) -> bool {
        held(std::ptr::from_ref(self).addr())
    }
}

fn held(id: usize) -> bool {
    HELD.with_borrow(|held| held.contains(&id))
}

/// An [`Exclusive`] lock held; dropping it unlocks.
pub struct ExclusiveGuard<'a, T> {
    guard: MutexGuard<'a, T>,
    id: usize,
}

impl<T> Drop for ExclusiveGuard<'_, T> {
    fn drop(&mut self) {
        HELD.with_borrow_mut(|held| {
            if let Some(at) = held.iter().rposition(|&id| id == self.id) {
                held.swap_remove(at);
            }
        });
    }
}

impl<T> Deref for ExclusiveGuard<'_, T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.guard
    }
}

impl<T> DerefMut for ExclusiveGuard<'_, T> {
    fn deref_mut(&mut self) -> &mut T {
        &mut self.guard
    }
}

#[cfg(test)]
mod tests {
    use std::panic::{self, AssertUnwindSafe};
    use std::sync::Arc;
    use std::thread;

    use super::*;

    #[test]
    fn a_thread_that_locks_twice_fails_at_once_instead_of_waiting_for_itself() {
        let lock = Exclusive::new("the thing", 0);
        let first = lock.lock().unwrap();
        // Debug builds and tests panic, so the test that reaches it fails.
        let second = panic::catch_unwind(AssertUnwindSafe(|| lock.lock().map(|_| ())));
        let message = second.unwrap_err();
        let message = message.downcast_ref::<String>().unwrap();
        assert!(message.contains("the thing"), "{message}");
        drop(first);
        assert!(!lock.held_here());
        *lock.lock().unwrap() += 1;
        assert_eq!(*lock.lock().unwrap(), 1, "free again once dropped");
    }

    #[test]
    fn two_locks_held_at_once_are_two_different_locks() {
        let (a, b) = (Exclusive::new("a", ()), Exclusive::new("b", ()));
        let held_a = a.lock().unwrap();
        let held_b = b.lock().unwrap();
        assert!(a.held_here() && b.held_here());
        drop(held_a);
        assert!(!a.held_here() && b.held_here());
        drop(held_b);
    }

    #[test]
    fn other_threads_wait_their_turn() {
        let lock = Arc::new(Exclusive::new("the count", 0));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let lock = Arc::clone(&lock);
                thread::spawn(move || {
                    for _ in 0..100 {
                        *lock.lock().unwrap() += 1;
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(*lock.lock().unwrap(), 800);
    }

    #[test]
    fn a_panic_while_held_leaves_it_usable_and_not_held() {
        let lock = Exclusive::new("the slot", 1);
        let _ = panic::catch_unwind(AssertUnwindSafe(|| {
            let _held = lock.lock().unwrap();
            panic!("mid-change");
        }));
        assert!(!lock.held_here());
        assert_eq!(*lock.lock().unwrap(), 1);
    }
}
