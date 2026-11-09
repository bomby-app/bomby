//! The hosted MCP extensions' sign-ins (docs/decisions/hosted-mcp-extensions-with-oauth.md):
//! Connect and Disconnect in Settings, Extensions (`connect_extension`,
//! `cancel_extension_connect`, `disconnect_extension`), the fresh access tokens the worker
//! asks for over the token socket (`fresh_token`, `tokens.rs`), and opening the sign-in
//! links their tools hand back (`open_extension_link`). The grants live in the keychain
//! (`credentials::Vault`); the flow itself is `oauth.rs`.
//!
//! Each extension has its own lock. A refresh holds it across its request to the vendor, and
//! saving a new sign-in or forgetting one takes it too, so they happen one after another; a
//! refresh saves only if the grant it started from is still the saved one. One vendor's slow
//! refresh never holds up the other's tokens.

use std::collections::{BTreeSet, HashMap};
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;
use url::Url;

use super::oauth::{self, Expect, Grant, OAuthError};
use super::{CHANGED, ConnectSpec, ExtensionSetting, SignIns};
use crate::credentials::Vault;
use crate::db::{Db, now_ms};
use crate::error::{Error, Result};
use crate::sync;

const CANCELLED: &str = "The sign-in was cancelled.";

/// A sign-in under way: what cancels it, and which one it is, so a later sign-in's
/// bookkeeping isn't cleared by an earlier one finishing.
struct Pending {
    run: u64,
    cancel: oneshot::Sender<()>,
}

/// The sign-ins under way, each extension's lock, and the one HTTP client. Tauri state.
#[derive(Default)]
pub struct Connections {
    pending: Mutex<HashMap<String, Pending>>,
    runs: Mutex<u64>,
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    http: OnceLock<reqwest::Client>,
}

/// Where the grants are kept: the keychain in the app, a map in tests.
pub trait Grants {
    fn get(&self, id: &str) -> Result<Option<Grant>>;
    /// Saves or removes the grant if the saved one is still what `expect` says; false when
    /// it changed meanwhile.
    fn replace(&self, id: &str, expect: Expect<'_>, grant: Option<Grant>) -> Result<bool>;
}

struct Keychain<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    vault: &'a Vault,
}

impl<R: Runtime> Grants for Keychain<'_, R> {
    fn get(&self, id: &str) -> Result<Option<Grant>> {
        self.vault.grant(self.app, id)
    }

    fn replace(&self, id: &str, expect: Expect<'_>, grant: Option<Grant>) -> Result<bool> {
        self.vault.replace_grant(self.app, id, expect, grant)
    }
}

/// Why there's no token, as a line for the voice model.
#[derive(Debug, PartialEq, Eq)]
pub enum NoToken {
    NotConnected,
    /// The vendor no longer takes the grant; it's been forgotten.
    Expired,
    /// Anything else (the vendor or the keychain didn't answer); try again.
    Failed(String),
}

impl Connections {
    fn lock(&self, id: &str) -> Arc<tokio::sync::Mutex<()>> {
        sync::lock(&self.locks)
            .entry(id.to_owned())
            .or_default()
            .clone()
    }

    fn http(&self) -> std::result::Result<&reqwest::Client, OAuthError> {
        if let Some(http) = self.http.get() {
            return Ok(http);
        }
        let http = oauth::client()?;
        Ok(self.http.get_or_init(|| http))
    }

    /// The ids of the sign-ins under way.
    fn connecting(&self) -> BTreeSet<String> {
        sync::lock(&self.pending).keys().cloned().collect()
    }

    /// Starts tracking a sign-in for `id`, cancelling one already under way for it.
    fn begin(&self, id: &str) -> (u64, oneshot::Receiver<()>) {
        let run = {
            let mut runs = sync::lock(&self.runs);
            *runs += 1;
            *runs
        };
        let (cancel, cancelled) = oneshot::channel();
        if let Some(earlier) =
            sync::lock(&self.pending).insert(id.to_owned(), Pending { run, cancel })
        {
            let _ = earlier.cancel.send(());
        }
        (run, cancelled)
    }

    /// Stops tracking sign-in `run` for `id`, unless a later one took its place.
    fn end(&self, id: &str, run: u64) {
        let mut pending = sync::lock(&self.pending);
        if pending.get(id).is_some_and(|p| p.run == run) {
            pending.remove(id);
        }
    }

    fn cancel(&self, id: &str) {
        if let Some(pending) = sync::lock(&self.pending).remove(id) {
            let _ = pending.cancel.send(());
        }
    }

    /// Saves sign-in `run`'s grant, after any refresh of the old one under way, unless the
    /// user cancelled it or started another meanwhile: checked under the extension's lock,
    /// so a Cancel that lands while the save waits still wins.
    pub async fn save(&self, grants: &impl Grants, id: &str, run: u64, grant: Grant) -> Result<()> {
        let lock = self.lock(id);
        let _held = lock.lock().await;
        let current = sync::lock(&self.pending)
            .get(id)
            .is_some_and(|p| p.run == run);
        if !current {
            return Err(Error::Invalid(CANCELLED.into()));
        }
        grants.replace(id, Expect::Any, Some(grant)).map(|_| ())
    }

    /// Forgets a sign-in, after any refresh under way, which then can't bring it back.
    pub async fn forget(&self, grants: &impl Grants, id: &str) -> Result<()> {
        let lock = self.lock(id);
        let _held = lock.lock().await;
        grants.replace(id, Expect::Any, None).map(|_| ())
    }

    /// An access token: the saved one, unless it's `stale` (the one the worker has, turned
    /// away or about to expire) or expiring, in which case `refresh` swaps the grant first.
    pub async fn token<F, Fut>(
        &self,
        grants: &impl Grants,
        id: &str,
        stale: Option<&str>,
        now: i64,
        refresh: F,
    ) -> std::result::Result<(String, Option<i64>), NoToken>
    where
        F: FnOnce(Grant) -> Fut,
        Fut: Future<Output = std::result::Result<Grant, OAuthError>>,
    {
        let failed = |e: Error| NoToken::Failed(e.to_string());
        let lock = self.lock(id);
        // One refresh at a time for this extension: a second caller waits, then finds the
        // newer token.
        let _held = lock.lock().await;
        let grant = grants
            .get(id)
            .map_err(failed)?
            .ok_or(NoToken::NotConnected)?;
        if Some(grant.access_token.as_str()) != stale && !grant.expiring(now) {
            return Ok((grant.access_token.clone(), grant.expires_in(now)));
        }
        match refresh(grant.clone()).await {
            Ok(fresh) => {
                let answer = (fresh.access_token.clone(), fresh.expires_in(now));
                if grants
                    .replace(id, Expect::Is(&grant), Some(fresh))
                    .map_err(failed)?
                {
                    Ok(answer)
                } else {
                    // Forgotten or replaced meanwhile: this refresh's tokens are void.
                    Err(NoToken::NotConnected)
                }
            }
            Err(OAuthError::SignInAgain(_)) => {
                let _ = grants.replace(id, Expect::Is(&grant), None);
                Err(NoToken::Expired)
            }
            Err(OAuthError::Failed(message)) => Err(NoToken::Failed(message)),
        }
    }
}

fn spec(id: &str) -> Result<&'static ConnectSpec> {
    super::connect_spec(id)
        .ok_or_else(|| Error::Invalid(format!("Bomby has no extension called {id} to connect.")))
}

/// Which extensions are signed in, as whom, and which are signing in now: what Settings
/// shows. No token comes with it.
pub(crate) fn sign_ins<R: Runtime>(app: &AppHandle<R>) -> Result<SignIns> {
    Ok(SignIns {
        accounts: app.state::<Vault>().signed_in(app)?,
        connecting: app.state::<Connections>().connecting(),
    })
}

fn changed<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<ExtensionSetting>> {
    let _ = app.emit(CHANGED, ());
    // The keychain before the database: a password prompt mustn't hold up every other read.
    let sign_ins = sign_ins(app)?;
    super::settings(&app.state::<Db>().conn(), &sign_ins)
}

/// The extensions that are signed in, by id.
pub(crate) fn connected<R: Runtime>(app: &AppHandle<R>, vault: &Vault) -> Result<BTreeSet<String>> {
    Ok(vault.signed_in(app)?.into_keys().collect())
}

/// Signs in to the extension's vendor in the browser and keeps the grant. Waits until the
/// user finishes, cancels (`cancel_extension_connect`) or takes too long; meanwhile Settings
/// shows it as connecting, in every window. A sign-in already under way for it is cancelled.
#[tauri::command]
pub async fn connect_extension<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<Vec<ExtensionSetting>> {
    let spec = spec(&id)?;
    let connections = app.state::<Connections>();
    let (run, cancelled) = connections.begin(&id);
    let _ = app.emit(CHANGED, ());
    let outcome = async {
        let http = connections
            .http()
            .map_err(|e| Error::Invalid(e.to_string()))?;
        let opener = app.clone();
        let open = move |url: &str| {
            opener
                .opener()
                .open_url(url, None::<&str>)
                .map_err(|e| OAuthError::Failed(format!("Couldn't open your browser: {e}")))
        };
        let grant = tokio::select! {
            signed_in = oauth::sign_in(http, &spec.mcp_url, open, now_ms) => {
                signed_in.map_err(|e| Error::Invalid(e.to_string()))?
            }
            _ = cancelled => return Err(Error::Invalid(CANCELLED.into())),
        };
        let vault = app.state::<Vault>();
        connections
            .save(
                &Keychain {
                    app: &app,
                    vault: &vault,
                },
                &id,
                run,
                grant,
            )
            .await
    }
    .await;
    connections.end(&id, run);
    let now = changed(&app);
    outcome.and(now)
}

/// Stops the extension's sign-in under way; it fails with "cancelled", which the page
/// doesn't show.
#[tauri::command(async)]
pub fn cancel_extension_connect<R: Runtime>(app: AppHandle<R>, id: String) {
    app.state::<Connections>().cancel(&id);
}

/// Forgets the sign-in; calls stop getting the extension until it's connected again. A
/// refresh under way finishes first and can't bring it back.
#[tauri::command]
pub async fn disconnect_extension<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<Vec<ExtensionSetting>> {
    let _ = spec(&id)?;
    let vault = app.state::<Vault>();
    app.state::<Connections>()
        .forget(
            &Keychain {
                app: &app,
                vault: &vault,
            },
            &id,
        )
        .await?;
    changed(&app)
}

/// An access token for the worker (`Connections::token`), with the vendor's refresh. The
/// error is a line for the voice model.
pub async fn fresh_token<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    stale: Option<&str>,
) -> std::result::Result<(String, Option<i64>), String> {
    let name = super::name(id).ok_or_else(|| format!("Bomby has no extension called {id}."))?;
    if super::connect_spec(id).is_none() {
        return Err(format!("{name} doesn't sign in."));
    }
    let connections = app.state::<Connections>();
    let vault = app.state::<Vault>();
    let http = connections.http().map_err(|e| e.to_string())?;
    let now = now_ms();
    let answer = connections
        .token(
            &Keychain { app, vault: &vault },
            id,
            stale,
            now,
            |grant| async move { oauth::refresh(http, &grant, now).await },
        )
        .await;
    answer.map_err(|why| match why {
        NoToken::NotConnected => {
            format!("{name} isn't connected. The user can connect it in Settings, Extensions.")
        }
        NoToken::Expired => {
            let _ = app.emit(CHANGED, ());
            format!(
                "{name}'s sign-in expired. The user can connect it again in Settings, Extensions."
            )
        }
        NoToken::Failed(message) => message,
    })
}

/// Whether `url` is https on one of `hosts` or a subdomain of one (`allowed` in
/// `agent/extensions/hosted_mcp.py`).
pub fn allowed(url: &str, hosts: &[String]) -> bool {
    let Ok(url) = Url::parse(url) else {
        return false;
    };
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    url.scheme() == "https"
        && hosts
            .iter()
            .any(|h| host == *h || host.ends_with(&format!(".{h}")))
}

/// Opens a link an extension's tool handed back (a page to sign in to an app) in the
/// browser, only on that vendor's hosts. Bomby asks for it over RPC (`<id>.open_link`).
#[tauri::command(async)]
pub fn open_extension_link<R: Runtime>(app: AppHandle<R>, id: String, url: String) -> Result<()> {
    let spec = spec(&id)?;
    if !allowed(&url, &spec.link_hosts) {
        return Err(Error::Invalid(format!(
            "That isn't a {} link, so it wasn't opened.",
            super::name(&id).unwrap_or(&id)
        )));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| Error::Invalid(format!("Couldn't open the browser: {e}")))
}

/// For tests: grants in memory.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryGrants(pub Mutex<std::collections::BTreeMap<String, Grant>>);

#[cfg(test)]
impl Grants for MemoryGrants {
    fn get(&self, id: &str) -> Result<Option<Grant>> {
        Ok(sync::lock(&self.0).get(id).cloned())
    }

    fn replace(&self, id: &str, expect: Expect<'_>, grant: Option<Grant>) -> Result<bool> {
        let mut grants = sync::lock(&self.0);
        if !expect.matches(grants.get(id)) {
            return Ok(false);
        }
        match grant {
            Some(grant) => grants.insert(id.to_owned(), grant),
            None => grants.remove(id),
        };
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::collections::BTreeMap;
    use std::time::Duration;

    fn grant(access: &str) -> Grant {
        Grant {
            client_id: "c".into(),
            token_endpoint: "https://auth.example/token".into(),
            resource: "https://mcp.example/mcp".into(),
            access_token: access.into(),
            refresh_token: Some(format!("rt-{access}")),
            expires_at: Some(1_000_000),
            account: None,
        }
    }

    fn with(id: &str, grant: Grant) -> MemoryGrants {
        MemoryGrants(Mutex::new(BTreeMap::from([(id.to_owned(), grant)])))
    }

    fn saved(grants: &MemoryGrants, id: &str) -> Option<String> {
        sync::lock(&grants.0)
            .get(id)
            .map(|g| g.access_token.clone())
    }

    #[test]
    fn links_open_only_on_the_vendors_hosts_over_https() {
        let hosts = vec!["composio.dev".to_owned()];
        assert!(allowed("https://connect.composio.dev/link/lk_1", &hosts));
        assert!(allowed("https://composio.dev/", &hosts));
        assert!(!allowed("http://connect.composio.dev/link", &hosts));
        assert!(!allowed("https://composio.dev.evil.example/", &hosts));
        assert!(!allowed("https://evilcomposio.dev/", &hosts));
        assert!(!allowed("file:///etc/passwd", &hosts));
        assert!(!allowed("not a url", &hosts));
    }

    #[tokio::test]
    async fn a_fresh_token_is_handed_out_without_a_refresh() {
        let connections = Connections::default();
        let grants = with("zapier", grant("at1"));
        let answer = connections
            .token(&grants, "zapier", None, 0, |_| async {
                panic!("no refresh")
            })
            .await;
        assert_eq!(answer, Ok(("at1".into(), Some(1000))));
        let none = MemoryGrants::default();
        let answer = connections
            .token(&none, "zapier", None, 0, |_| async { panic!("no refresh") })
            .await;
        assert_eq!(answer, Err(NoToken::NotConnected));
    }

    #[tokio::test]
    async fn a_stale_token_is_refreshed_and_saved() {
        let connections = Connections::default();
        let grants = with("zapier", grant("at1"));
        let answer = connections
            .token(&grants, "zapier", Some("at1"), 0, |_| async {
                Ok(grant("at2"))
            })
            .await;
        assert_eq!(answer.unwrap().0, "at2");
        assert_eq!(saved(&grants, "zapier").as_deref(), Some("at2"));
    }

    #[tokio::test]
    async fn a_spent_grant_is_forgotten_and_a_failed_refresh_keeps_it() {
        let connections = Connections::default();
        let grants = with("zapier", grant("at1"));
        let answer = connections
            .token(&grants, "zapier", Some("at1"), 0, |_| async {
                Err(OAuthError::Failed("busy".into()))
            })
            .await;
        assert_eq!(answer, Err(NoToken::Failed("busy".into())));
        assert_eq!(saved(&grants, "zapier").as_deref(), Some("at1"));
        let answer = connections
            .token(&grants, "zapier", Some("at1"), 0, |_| async {
                Err(OAuthError::SignInAgain("spent".into()))
            })
            .await;
        assert_eq!(answer, Err(NoToken::Expired));
        assert_eq!(saved(&grants, "zapier"), None);
    }

    /// A refresh that waits on `release` before the vendor answers with `at2`.
    async fn slow_refresh(
        connections: Arc<Connections>,
        grants: Arc<MemoryGrants>,
        release: oneshot::Receiver<()>,
    ) -> std::result::Result<(String, Option<i64>), NoToken> {
        connections
            .token(&*grants, "zapier", Some("at1"), 0, |_| async {
                let _ = release.await;
                Ok(grant("at2"))
            })
            .await
    }

    #[tokio::test]
    async fn a_disconnect_during_a_refresh_stays_disconnected() {
        let connections = Arc::new(Connections::default());
        let grants = Arc::new(with("zapier", grant("at1")));
        let (release, released) = oneshot::channel();
        let refreshing = tokio::spawn(slow_refresh(connections.clone(), grants.clone(), released));
        tokio::time::sleep(Duration::from_millis(20)).await;

        let forgetting = {
            let (c, g) = (connections.clone(), grants.clone());
            tokio::spawn(async move { c.forget(&*g, "zapier").await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            !forgetting.is_finished(),
            "the disconnect waits for the refresh"
        );
        release.send(()).unwrap();
        let _ = refreshing.await.unwrap();
        forgetting.await.unwrap().unwrap();
        assert_eq!(
            saved(&grants, "zapier"),
            None,
            "the refresh didn't bring it back"
        );
    }

    #[tokio::test]
    async fn a_new_sign_in_during_a_refresh_is_kept() {
        let connections = Arc::new(Connections::default());
        let grants = Arc::new(with("zapier", grant("at1")));
        let (release, released) = oneshot::channel();
        let refreshing = tokio::spawn(slow_refresh(connections.clone(), grants.clone(), released));
        tokio::time::sleep(Duration::from_millis(20)).await;

        let (run, _) = connections.begin("zapier");
        let saving = {
            let (c, g) = (connections.clone(), grants.clone());
            tokio::spawn(async move { c.save(&*g, "zapier", run, grant("new")).await })
        };
        release.send(()).unwrap();
        let _ = refreshing.await.unwrap();
        saving.await.unwrap().unwrap();
        assert_eq!(saved(&grants, "zapier").as_deref(), Some("new"));
    }

    #[tokio::test]
    async fn a_refresh_whose_grant_changed_under_it_saves_nothing() {
        // A writer that skips the lock (nothing does today) still can't be overwritten.
        let connections = Connections::default();
        let grants = with("zapier", grant("at1"));
        let answer = connections
            .token(&grants, "zapier", Some("at1"), 0, |_| async {
                sync::lock(&grants.0).insert("zapier".into(), grant("other"));
                Ok(grant("at2"))
            })
            .await;
        assert_eq!(answer, Err(NoToken::NotConnected));
        assert_eq!(saved(&grants, "zapier").as_deref(), Some("other"));
    }

    #[tokio::test]
    async fn one_vendors_slow_refresh_doesnt_hold_up_the_other() {
        let connections = Arc::new(Connections::default());
        let grants = Arc::new(MemoryGrants(Mutex::new(BTreeMap::from([
            ("zapier".to_owned(), grant("at1")),
            ("composio".to_owned(), grant("c1")),
        ]))));
        let (release, released) = oneshot::channel();
        let refreshing = tokio::spawn(slow_refresh(connections.clone(), grants.clone(), released));
        tokio::time::sleep(Duration::from_millis(20)).await;
        let other = tokio::time::timeout(
            Duration::from_secs(1),
            connections.token(&*grants, "composio", None, 0, |_| async {
                panic!("no refresh")
            }),
        )
        .await
        .expect("composio answered while zapier refreshed");
        assert_eq!(other.unwrap().0, "c1");
        release.send(()).unwrap();
        let _ = refreshing.await;
    }

    #[test]
    fn a_later_sign_in_replaces_and_cancels_an_earlier_one() {
        let connections = Connections::default();
        let (first, mut first_cancelled) = connections.begin("zapier");
        let (second, _) = connections.begin("zapier");
        assert!(
            first_cancelled.try_recv().is_ok(),
            "the earlier one was cancelled"
        );
        connections.end("zapier", first);
        assert_eq!(
            connections.connecting(),
            BTreeSet::from(["zapier".to_owned()])
        );
        connections.end("zapier", second);
        assert!(connections.connecting().is_empty());
    }

    #[tokio::test]
    async fn a_sign_in_cancelled_while_its_save_waits_saves_nothing() {
        let connections = Arc::new(Connections::default());
        let grants = Arc::new(with("zapier", grant("at1")));
        let (release, released) = oneshot::channel();
        let refreshing = tokio::spawn(slow_refresh(connections.clone(), grants.clone(), released));
        tokio::time::sleep(Duration::from_millis(20)).await;

        // The browser came back; the save waits behind the refresh, and the user cancels.
        let (run, _) = connections.begin("zapier");
        let saving = {
            let (c, g) = (connections.clone(), grants.clone());
            tokio::spawn(async move { c.save(&*g, "zapier", run, grant("cancelled")).await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        connections.cancel("zapier");
        release.send(()).unwrap();
        let _ = refreshing.await.unwrap();

        let refused = saving.await.unwrap().unwrap_err().to_string();
        assert_eq!(refused, CANCELLED);
        assert_eq!(
            saved(&grants, "zapier").as_deref(),
            Some("at2"),
            "the refreshed one stays"
        );
    }

    #[tokio::test]
    async fn a_sign_in_replaced_by_a_later_one_saves_nothing() {
        let connections = Connections::default();
        let grants = MemoryGrants::default();
        let (first, _) = connections.begin("zapier");
        let (second, _) = connections.begin("zapier");
        assert!(
            connections
                .save(&grants, "zapier", first, grant("old"))
                .await
                .is_err()
        );
        connections
            .save(&grants, "zapier", second, grant("new"))
            .await
            .unwrap();
        assert_eq!(saved(&grants, "zapier").as_deref(), Some("new"));
    }
}
