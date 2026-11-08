//! Signing in to a hosted MCP server the way the MCP authorization spec describes
//! (docs/decisions/hosted-mcp-extensions-with-oauth.md, docs/mcp-notes.md): the server's
//! protected resource metadata (RFC 9728) names its authorization server, whose metadata
//! (RFC 8414) gives the endpoints. Bomby registers itself as a public client (RFC 7591) with
//! a loopback redirect on a port it has just bound (RFC 8252), sends the user to sign in with
//! PKCE (RFC 7636) and the `resource` parameter (RFC 8707), and swaps the code for tokens.
//! Refreshing swaps the refresh token for new ones.
//!
//! Nothing here knows Tauri: the browser is a function the caller passes, so tests drive the
//! whole flow against a fake server. `connections.rs` keeps the grants and runs the flow for
//! Settings.

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

/// How long the user gets to finish signing in.
pub const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// Each request to the vendor.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
/// A token this close to expiring is refreshed before it's handed out.
pub const REFRESH_EARLY_MS: i64 = 60_000;
/// The scopes Bomby asks for when the server doesn't name its own: who the account is, and
/// a refresh token.
const WANTED_SCOPES: [&str; 4] = ["openid", "profile", "email", "offline_access"];
/// The most of a callback request Bomby reads.
const MAX_CALLBACK: usize = 16 * 1024;
const CALLBACK_PATH: &str = "/callback";
/// Bomby's logo for the vendors' lists of signed-in clients: Paper page `app assets`, frame
/// `client-logo · 512 · OAuth logo_uri` (docs/brand.md). It loads once the repo is public.
const LOGO_URI: &str =
    "https://raw.githubusercontent.com/bomby-app/bomby/main/.github/assets/logo.png";

/// What went wrong, as a message for the user (the vendor's own when it gave one).
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum OAuthError {
    #[error("{0}")]
    Failed(String),
    /// The refresh token no longer works: the user signs in again.
    #[error("{0}")]
    SignInAgain(String),
}

type Result<T> = std::result::Result<T, OAuthError>;

fn failed(message: impl Into<String>) -> OAuthError {
    OAuthError::Failed(message.into())
}

/// A signed-in connection, kept in the keychain with the other keys (`credentials.rs`).
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Grant {
    pub client_id: String,
    pub token_endpoint: String,
    /// The MCP server the tokens are for (RFC 8707), sent again with each refresh.
    pub resource: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Milliseconds since the epoch; None when the vendor didn't say.
    pub expires_at: Option<i64>,
    /// The account's email (or name), from the ID token, for "Connected as …".
    pub account: Option<String>,
}

/// Never prints a token.
impl std::fmt::Debug for Grant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Grant")
            .field("client_id", &self.client_id)
            .field("resource", &self.resource)
            .field("expires_at", &self.expires_at)
            .field("account", &self.account)
            .finish_non_exhaustive()
    }
}

impl Grant {
    /// Whether the access token is expired or about to be, at `now_ms`.
    pub fn expiring(&self, now_ms: i64) -> bool {
        self.expires_at
            .is_some_and(|at| at - now_ms < REFRESH_EARLY_MS)
    }

    /// Seconds the access token has left at `now_ms`, for the worker.
    pub fn expires_in(&self, now_ms: i64) -> Option<i64> {
        self.expires_at.map(|at| ((at - now_ms) / 1000).max(0))
    }
}

pub fn client() -> Result<reqwest::Client> {
    // reqwest is built without a crypto provider; the updater installs ring's the same way.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(concat!("Bomby/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| failed(format!("Couldn't start the sign-in: {e}")))
}

#[derive(Deserialize)]
struct ResourceMetadata {
    resource: Option<String>,
    #[serde(default)]
    authorization_servers: Vec<String>,
    #[serde(default)]
    scopes_supported: Vec<String>,
}

#[derive(Deserialize)]
struct ServerMetadata {
    authorization_endpoint: String,
    token_endpoint: String,
    registration_endpoint: Option<String>,
    #[serde(default)]
    code_challenge_methods_supported: Vec<String>,
    #[serde(default)]
    scopes_supported: Vec<String>,
}

#[derive(Deserialize)]
struct Registration {
    client_id: String,
}

#[derive(Deserialize)]
struct TokenAnswer {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    id_token: Option<String>,
}

#[derive(Deserialize)]
struct ErrorAnswer {
    error: Option<String>,
    error_description: Option<String>,
}

/// Where a server is, worked out once before the browser opens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Discovered {
    pub resource: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: String,
    pub scope: Option<String>,
}

/// `resource_metadata="…"` from a 401's `WWW-Authenticate: Bearer …` header.
pub fn resource_metadata_url(www_authenticate: &str) -> Option<String> {
    let at = www_authenticate.find("resource_metadata=")? + "resource_metadata=".len();
    let rest = &www_authenticate[at..];
    let value = match rest.strip_prefix('"') {
        Some(quoted) => &quoted[..quoted.find('"')?],
        None => rest.split([',', ' ']).next()?,
    };
    (!value.is_empty()).then(|| value.to_owned())
}

/// RFC 8615 well-known URLs for `url`: with its path inserted after the well-known part
/// first, then at the root.
pub fn well_known(url: &Url, suffix: &str) -> Vec<String> {
    let origin = url.origin().ascii_serialization();
    let path = url.path().trim_end_matches('/');
    let mut urls = Vec::new();
    if !path.is_empty() {
        urls.push(format!("{origin}/.well-known/{suffix}{path}"));
    }
    urls.push(format!("{origin}/.well-known/{suffix}"));
    urls
}

async fn get_json<T: for<'de> Deserialize<'de>>(
    http: &reqwest::Client,
    urls: &[String],
) -> Option<T> {
    for url in urls {
        let Ok(response) = http.get(url).send().await else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        if let Ok(found) = response.json::<T>().await {
            return Some(found);
        }
    }
    None
}

/// Finds the server's authorization server and its endpoints.
pub async fn discover(http: &reqwest::Client, mcp_url: &str) -> Result<Discovered> {
    let unreachable =
        || failed("Couldn't reach the sign-in server. Check your connection and try again.");
    let url = Url::parse(mcp_url).map_err(|_| unreachable())?;
    // A request without a token gets a 401 that points at the metadata.
    let mut metadata_urls = Vec::new();
    if let Ok(answer) = http
        .post(mcp_url)
        .header("Accept", "application/json, text/event-stream")
        .json(&serde_json::json!({}))
        .send()
        .await
        && let Some(found) = answer
            .headers()
            .get(reqwest::header::WWW_AUTHENTICATE)
            .and_then(|h| h.to_str().ok())
            .and_then(resource_metadata_url)
    {
        metadata_urls.push(found);
    }
    metadata_urls.extend(well_known(&url, "oauth-protected-resource"));
    let resource: ResourceMetadata = get_json(http, &metadata_urls)
        .await
        .ok_or_else(unreachable)?;
    let issuer = resource
        .authorization_servers
        .first()
        .ok_or_else(|| failed("This server doesn't say where to sign in."))?;
    let issuer_url = Url::parse(issuer).map_err(|_| unreachable())?;
    let mut server_urls = well_known(&issuer_url, "oauth-authorization-server");
    server_urls.extend(well_known(&issuer_url, "openid-configuration"));
    let server: ServerMetadata = get_json(http, &server_urls).await.ok_or_else(unreachable)?;
    if !server.code_challenge_methods_supported.is_empty()
        && !server
            .code_challenge_methods_supported
            .iter()
            .any(|m| m == "S256")
    {
        return Err(failed(
            "This server's sign-in isn't one Bomby can use (no PKCE).",
        ));
    }
    let registration_endpoint = server
        .registration_endpoint
        .ok_or_else(|| failed("This server doesn't let apps like Bomby sign in on their own."))?;
    Ok(Discovered {
        resource: resource.resource.unwrap_or_else(|| mcp_url.to_owned()),
        authorization_endpoint: server.authorization_endpoint,
        token_endpoint: server.token_endpoint,
        registration_endpoint,
        scope: scope(&resource.scopes_supported, &server.scopes_supported),
    })
}

/// The resource's own scopes when it names them; otherwise the wanted ones the
/// authorization server offers. `offline_access` whenever the server offers it.
pub fn scope(resource: &[String], server: &[String]) -> Option<String> {
    let mut scopes: Vec<&str> = if resource.is_empty() {
        WANTED_SCOPES
            .iter()
            .copied()
            .filter(|w| server.iter().any(|s| s == w))
            .collect()
    } else {
        resource.iter().map(String::as_str).collect()
    };
    if server.iter().any(|s| s == "offline_access") && !scopes.contains(&"offline_access") {
        scopes.push("offline_access");
    }
    (!scopes.is_empty()).then(|| scopes.join(" "))
}

/// PKCE: a verifier and its S256 challenge.
pub fn pkce() -> Result<(String, String)> {
    let verifier = random_string(32)?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    Ok((verifier, challenge))
}

fn random_string(bytes: usize) -> Result<String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| failed(format!("Couldn't start the sign-in: {e}")))?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

async fn error_message(response: reqwest::Response, what: &str) -> OAuthError {
    let status = response.status();
    let detail = response
        .json::<ErrorAnswer>()
        .await
        .ok()
        .and_then(|e| e.error_description.or(e.error));
    match detail {
        Some(detail) => failed(format!("{what}: {detail}")),
        None => failed(format!("{what} ({status}).")),
    }
}

async fn register(http: &reqwest::Client, at: &Discovered, redirect_uri: &str) -> Result<String> {
    let mut body = serde_json::json!({
        "client_name": "Bomby",
        "client_uri": "https://bomby.app",
        "logo_uri": LOGO_URI,
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "application_type": "native",
    });
    if let Some(scope) = &at.scope {
        body["scope"] = scope.clone().into();
    }
    let response = http
        .post(&at.registration_endpoint)
        .json(&body)
        .send()
        .await
        .map_err(|_| {
            failed("Couldn't reach the sign-in server. Check your connection and try again.")
        })?;
    if !response.status().is_success() {
        return Err(error_message(response, "The server didn't let Bomby sign in").await);
    }
    response
        .json::<Registration>()
        .await
        .map(|r| r.client_id)
        .map_err(|_| failed("The server's answer to Bomby's sign-in wasn't readable."))
}

/// The page the browser opens.
pub fn authorize_url(
    at: &Discovered,
    client_id: &str,
    redirect_uri: &str,
    challenge: &str,
    state: &str,
) -> Result<String> {
    let mut url = Url::parse(&at.authorization_endpoint)
        .map_err(|_| failed("The server's sign-in page isn't a valid address."))?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("response_type", "code")
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", state)
            .append_pair("resource", &at.resource);
        if let Some(scope) = &at.scope {
            query.append_pair("scope", scope);
        }
    }
    Ok(url.into())
}

/// What the browser brought back to the loopback redirect.
#[derive(Debug, PartialEq, Eq)]
pub enum Callback {
    Code(String),
    /// The user said no, or the server refused: its message.
    Refused(String),
    /// Not the redirect (a favicon, a stray request), or not this sign-in's state.
    Other,
}

/// Reads the request line of a request to the loopback redirect.
pub fn read_callback(request: &str, state: &str) -> Callback {
    let Some(target) = request
        .lines()
        .next()
        .and_then(|line| line.strip_prefix("GET "))
        .and_then(|rest| rest.split(' ').next())
    else {
        return Callback::Other;
    };
    let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else {
        return Callback::Other;
    };
    if url.path() != CALLBACK_PATH {
        return Callback::Other;
    }
    let param = |name: &str| {
        url.query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
    };
    if param("state").as_deref() != Some(state) {
        return Callback::Other;
    }
    if let Some(code) = param("code") {
        return Callback::Code(code);
    }
    let error = param("error_description")
        .or_else(|| param("error"))
        .unwrap_or_else(|| "The sign-in didn't finish.".into());
    Callback::Refused(error)
}

fn page(title: &str, line: &str) -> String {
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>{title}</title>\
         <body style=\"font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0\">\
         <div style=\"text-align:center\"><h1 style=\"font-size:20px\">{title}</h1><p>{line}</p></div>"
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

const NOT_FOUND: &str = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

/// Waits on `listener` for the redirect that carries `state`, answering the browser.
async fn wait_for_code(listener: TcpListener, state: &str) -> Result<String> {
    loop {
        let Ok((mut stream, _)) = listener.accept().await else {
            continue;
        };
        let mut buf = vec![0u8; MAX_CALLBACK];
        let mut read = 0;
        // The request line and headers arrive in one or a few reads; stop at their end.
        while read < buf.len() {
            match stream.read(&mut buf[read..]).await {
                Ok(0) | Err(_) => break,
                Ok(n) => read += n,
            }
            if buf[..read].windows(4).any(|w| w == b"\r\n\r\n") {
                break;
            }
        }
        let request = String::from_utf8_lossy(&buf[..read]);
        let (reply, outcome) = match read_callback(&request, state) {
            Callback::Code(code) => (
                page(
                    "You're connected",
                    "You can close this tab and go back to Bomby.",
                ),
                Some(Ok(code)),
            ),
            Callback::Refused(message) => (
                page(
                    "Not connected",
                    "You can close this tab and try again in Bomby.",
                ),
                Some(Err(failed(format!("The sign-in didn't finish: {message}")))),
            ),
            Callback::Other => (NOT_FOUND.to_owned(), None),
        };
        let _ = stream.write_all(reply.as_bytes()).await;
        let _ = stream.shutdown().await;
        if let Some(outcome) = outcome {
            return outcome;
        }
    }
}

/// The email (or name) in an ID token's claims, read without checking its signature: it only
/// labels the connection in Settings.
pub fn account(id_token: &str) -> Option<String> {
    let claims = id_token.split('.').nth(1)?;
    let json: serde_json::Value =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(claims).ok()?).ok()?;
    ["email", "preferred_username", "name"]
        .iter()
        .find_map(|k| json.get(*k)?.as_str().filter(|s| !s.is_empty()))
        .map(str::to_owned)
}

fn grant_from(
    answer: TokenAnswer,
    client_id: String,
    at: &Discovered,
    now_ms: i64,
    previous: Option<&Grant>,
) -> Grant {
    Grant {
        client_id,
        token_endpoint: at.token_endpoint.clone(),
        resource: at.resource.clone(),
        access_token: answer.access_token,
        // A server that doesn't rotate keeps the one it gave before.
        refresh_token: answer
            .refresh_token
            .or_else(|| previous.and_then(|p| p.refresh_token.clone())),
        expires_at: answer.expires_in.map(|s| now_ms + s * 1000),
        account: answer
            .id_token
            .as_deref()
            .and_then(account)
            .or_else(|| previous.and_then(|p| p.account.clone())),
    }
}

/// Signs in to the MCP server at `mcp_url`: `open` gets the page to show the user, and the
/// sign-in waits up to `SIGN_IN_TIMEOUT` for the browser to come back.
pub async fn sign_in(
    http: &reqwest::Client,
    mcp_url: &str,
    open: impl FnOnce(&str) -> Result<()>,
    now_ms: impl Fn() -> i64,
) -> Result<Grant> {
    let at = discover(http, mcp_url).await?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| failed(format!("Couldn't start the sign-in: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| failed(format!("Couldn't start the sign-in: {e}")))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let client_id = register(http, &at, &redirect_uri).await?;
    let (verifier, challenge) = pkce()?;
    let state = random_string(16)?;
    open(&authorize_url(
        &at,
        &client_id,
        &redirect_uri,
        &challenge,
        &state,
    )?)?;
    let code = tokio::time::timeout(SIGN_IN_TIMEOUT, wait_for_code(listener, &state))
        .await
        .map_err(|_| failed("The sign-in took too long. Try again."))??;
    let response = http
        .post(&at.token_endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect_uri),
            ("client_id", &client_id),
            ("code_verifier", &verifier),
            ("resource", &at.resource),
        ])
        .send()
        .await
        .map_err(|_| {
            failed("Couldn't reach the sign-in server. Check your connection and try again.")
        })?;
    if !response.status().is_success() {
        return Err(error_message(response, "The sign-in didn't finish").await);
    }
    let answer: TokenAnswer = response
        .json()
        .await
        .map_err(|_| failed("The server's sign-in answer wasn't readable."))?;
    Ok(grant_from(answer, client_id, &at, now_ms(), None))
}

/// Swaps the grant's refresh token for new tokens. `SignInAgain` when there's none, or the
/// server no longer takes it.
pub async fn refresh(http: &reqwest::Client, grant: &Grant, now_ms: i64) -> Result<Grant> {
    let again = || OAuthError::SignInAgain("The sign-in expired.".into());
    let refresh_token = grant.refresh_token.as_deref().ok_or_else(again)?;
    let response = http
        .post(&grant.token_endpoint)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", &grant.client_id),
            ("resource", &grant.resource),
        ])
        .send()
        .await
        .map_err(|_| failed("Couldn't reach the sign-in server."))?;
    let status = response.status();
    if status == reqwest::StatusCode::BAD_REQUEST || status == reqwest::StatusCode::UNAUTHORIZED {
        // invalid_grant and friends: the refresh token is spent or revoked.
        return Err(again());
    }
    if !status.is_success() {
        return Err(error_message(response, "The sign-in server didn't answer").await);
    }
    let answer: TokenAnswer = response
        .json()
        .await
        .map_err(|_| failed("The sign-in server's answer wasn't readable."))?;
    let at = Discovered {
        resource: grant.resource.clone(),
        authorization_endpoint: String::new(),
        token_endpoint: grant.token_endpoint.clone(),
        registration_endpoint: String::new(),
        scope: None,
    };
    Ok(grant_from(
        answer,
        grant.client_id.clone(),
        &at,
        now_ms,
        Some(grant),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    #[test]
    fn reads_the_resource_metadata_from_a_401() {
        assert_eq!(
            resource_metadata_url(
                r#"Bearer error="unauthorized", resource_metadata="https://a.example/.well-known/oauth-protected-resource""#
            )
            .as_deref(),
            Some("https://a.example/.well-known/oauth-protected-resource")
        );
        assert_eq!(
            resource_metadata_url("Bearer resource_metadata=https://a.example/m, scope=x")
                .as_deref(),
            Some("https://a.example/m")
        );
        assert_eq!(resource_metadata_url("Bearer realm=x"), None);
    }

    #[test]
    fn well_known_urls_try_the_path_first() {
        let url = Url::parse("https://mcp.zapier.com/api/v1/connect").unwrap();
        assert_eq!(
            well_known(&url, "oauth-protected-resource"),
            [
                "https://mcp.zapier.com/.well-known/oauth-protected-resource/api/v1/connect",
                "https://mcp.zapier.com/.well-known/oauth-protected-resource",
            ]
        );
        let root = Url::parse("https://connect.composio.dev").unwrap();
        assert_eq!(
            well_known(&root, "oauth-authorization-server"),
            ["https://connect.composio.dev/.well-known/oauth-authorization-server"]
        );
    }

    fn strings(s: &[&str]) -> Vec<String> {
        s.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn asks_for_the_resources_scopes_or_the_wanted_ones_the_server_offers() {
        // Zapier: the resource names them; its server has no offline_access.
        assert_eq!(
            scope(
                &strings(&["openid", "profile", "email"]),
                &strings(&["openid", "profile", "email"])
            )
            .as_deref(),
            Some("openid profile email")
        );
        // Composio: none on the resource; the server offers a refresh token.
        assert_eq!(
            scope(
                &[],
                &strings(&["openid", "profile", "email", "offline_access", "admin"])
            )
            .as_deref(),
            Some("openid profile email offline_access")
        );
        assert_eq!(scope(&[], &[]), None);
    }

    #[test]
    fn the_pkce_challenge_is_the_verifiers_s256() {
        let (verifier, challenge) = pkce().unwrap();
        assert_eq!(verifier.len(), 43);
        assert_eq!(
            challenge,
            URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
        );
        assert_ne!(pkce().unwrap().0, verifier);
    }

    fn discovered() -> Discovered {
        Discovered {
            resource: "https://mcp.example/mcp".into(),
            authorization_endpoint: "https://auth.example/authorize".into(),
            token_endpoint: "https://auth.example/token".into(),
            registration_endpoint: "https://auth.example/register".into(),
            scope: Some("openid email".into()),
        }
    }

    #[test]
    fn the_authorize_url_carries_pkce_state_resource_and_scope() {
        let url = authorize_url(
            &discovered(),
            "c1",
            "http://127.0.0.1:5000/callback",
            "ch",
            "st",
        )
        .unwrap();
        let url = Url::parse(&url).unwrap();
        let q: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["client_id"], "c1");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5000/callback");
        assert_eq!(q["code_challenge"], "ch");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["state"], "st");
        assert_eq!(q["resource"], "https://mcp.example/mcp");
        assert_eq!(q["scope"], "openid email");
    }

    #[test]
    fn the_callback_needs_the_path_and_the_state() {
        let get = |target: &str| format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        assert_eq!(
            read_callback(&get("/callback?code=abc&state=s1"), "s1"),
            Callback::Code("abc".into())
        );
        assert_eq!(
            read_callback(&get("/callback?code=abc&state=other"), "s1"),
            Callback::Other
        );
        assert_eq!(read_callback(&get("/favicon.ico"), "s1"), Callback::Other);
        assert_eq!(
            read_callback(
                &get("/callback?error=access_denied&error_description=User%20said%20no&state=s1"),
                "s1"
            ),
            Callback::Refused("User said no".into())
        );
        assert_eq!(
            read_callback("POST /callback HTTP/1.1\r\n\r\n", "s1"),
            Callback::Other
        );
    }

    #[test]
    fn the_account_comes_from_the_id_tokens_email() {
        let claims = URL_SAFE_NO_PAD.encode(br#"{"sub":"1","email":"me@example.com","name":"Me"}"#);
        assert_eq!(
            account(&format!("h.{claims}.sig")).as_deref(),
            Some("me@example.com")
        );
        let name_only = URL_SAFE_NO_PAD.encode(br#"{"name":"Me"}"#);
        assert_eq!(
            account(&format!("h.{name_only}.sig")).as_deref(),
            Some("Me")
        );
        assert_eq!(account("not a jwt"), None);
    }

    #[test]
    fn a_grant_is_expiring_a_minute_early_and_never_without_an_expiry() {
        let grant = |expires_at| Grant {
            client_id: "c".into(),
            token_endpoint: "t".into(),
            resource: "r".into(),
            access_token: "a".into(),
            refresh_token: None,
            expires_at,
            account: None,
        };
        assert!(!grant(Some(100_000)).expiring(0));
        assert!(grant(Some(59_000)).expiring(0));
        assert!(!grant(None).expiring(i64::MAX));
        assert_eq!(grant(Some(100_000)).expires_in(0), Some(100));
        assert!(!format!("{:?}", grant(None)).contains("\"a\""));
    }

    /// A fake MCP server and authorization server in one, on a local port: it answers the
    /// metadata, registration and token requests the way Zapier's and Composio's do.
    struct FakeVendor {
        base: String,
        seen: Arc<Mutex<Vec<(String, String)>>>,
    }

    async fn fake_vendor(refresh_ok: bool) -> FakeVendor {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (b, s) = (base.clone(), seen.clone());
        tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let (base, seen) = (b.clone(), s.clone());
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 65536];
                    let mut read = 0;
                    loop {
                        let n = stream.read(&mut buf[read..]).await.unwrap();
                        read += n;
                        let text = String::from_utf8_lossy(&buf[..read]).to_string();
                        if let Some(end) = text.find("\r\n\r\n") {
                            let length = text
                                .lines()
                                .find_map(|l| {
                                    l.to_lowercase()
                                        .strip_prefix("content-length: ")
                                        .map(|v| v.trim().parse::<usize>().unwrap())
                                })
                                .unwrap_or(0);
                            if read >= end + 4 + length || n == 0 {
                                break;
                            }
                        }
                        if n == 0 {
                            break;
                        }
                    }
                    let text = String::from_utf8_lossy(&buf[..read]).to_string();
                    let (head, body) = text.split_once("\r\n\r\n").unwrap();
                    let line = head.lines().next().unwrap().to_owned();
                    let path = line.split(' ').nth(1).unwrap().to_owned();
                    seen.lock().unwrap().push((line.clone(), body.to_owned()));
                    let json = |status: &str, value: serde_json::Value, extra: &str| {
                        let body = value.to_string();
                        format!(
                            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        )
                    };
                    let id_token = format!(
                        "h.{}.s",
                        URL_SAFE_NO_PAD.encode(br#"{"email":"me@example.com"}"#)
                    );
                    let reply = match path.as_str() {
                        "/mcp" => json(
                            "401 Unauthorized",
                            serde_json::json!({}),
                            &format!(
                                "WWW-Authenticate: Bearer resource_metadata=\"{base}/.well-known/oauth-protected-resource\"\r\n"
                            ),
                        ),
                        "/.well-known/oauth-protected-resource" => json(
                            "200 OK",
                            serde_json::json!({ "resource": format!("{base}/mcp"), "authorization_servers": [base] }),
                            "",
                        ),
                        "/.well-known/oauth-authorization-server" => json(
                            "200 OK",
                            serde_json::json!({
                                "issuer": base,
                                "authorization_endpoint": format!("{base}/authorize"),
                                "token_endpoint": format!("{base}/token"),
                                "registration_endpoint": format!("{base}/register"),
                                "code_challenge_methods_supported": ["S256"],
                                "scopes_supported": ["openid", "email", "offline_access"],
                            }),
                            "",
                        ),
                        "/register" => json(
                            "201 Created",
                            serde_json::json!({ "client_id": "client_1" }),
                            "",
                        ),
                        "/token" if body.contains("grant_type=authorization_code") => json(
                            "200 OK",
                            serde_json::json!({ "access_token": "at1", "refresh_token": "rt1", "expires_in": 300, "id_token": id_token }),
                            "",
                        ),
                        "/token" if refresh_ok => json(
                            "200 OK",
                            serde_json::json!({ "access_token": "at2", "refresh_token": "rt2", "expires_in": 300 }),
                            "",
                        ),
                        "/token" => json(
                            "400 Bad Request",
                            serde_json::json!({ "error": "invalid_grant" }),
                            "",
                        ),
                        _ => json("404 Not Found", serde_json::json!({}), ""),
                    };
                    let _ = stream.write_all(reply.as_bytes()).await;
                });
            }
        });
        FakeVendor { base, seen }
    }

    fn body_of(seen: &[(String, String)], path: &str) -> String {
        seen.iter()
            .find(|(line, _)| line.contains(path))
            .map(|(_, body)| body.clone())
            .unwrap()
    }

    #[tokio::test]
    async fn signs_in_end_to_end_through_the_loopback_redirect() {
        let vendor = fake_vendor(true).await;
        let http = client().unwrap();
        let opened = Arc::new(Mutex::new(String::new()));
        let o = opened.clone();
        let grant = sign_in(
            &http,
            &format!("{}/mcp", vendor.base),
            move |url| {
                *o.lock().unwrap() = url.to_owned();
                // The browser: the user signs in and the vendor redirects back.
                let url = Url::parse(url).unwrap();
                let q: HashMap<_, _> = url.query_pairs().into_owned().collect();
                let back = format!("{}?code=c0de&state={}", q["redirect_uri"], q["state"]);
                tokio::spawn(async move {
                    let page = client()
                        .unwrap()
                        .get(back)
                        .send()
                        .await
                        .unwrap()
                        .text()
                        .await
                        .unwrap();
                    assert!(page.contains("You're connected"));
                });
                Ok(())
            },
            || 1_000,
        )
        .await
        .unwrap();

        assert_eq!(grant.client_id, "client_1");
        assert_eq!(grant.access_token, "at1");
        assert_eq!(grant.refresh_token.as_deref(), Some("rt1"));
        assert_eq!(grant.expires_at, Some(301_000));
        assert_eq!(grant.account.as_deref(), Some("me@example.com"));
        assert_eq!(grant.resource, format!("{}/mcp", vendor.base));
        assert!(
            opened
                .lock()
                .unwrap()
                .starts_with(&format!("{}/authorize?", vendor.base))
        );

        let seen = vendor.seen.lock().unwrap().clone();
        let registration: serde_json::Value =
            serde_json::from_str(&body_of(&seen, "/register")).unwrap();
        assert_eq!(registration["token_endpoint_auth_method"], "none");
        assert_eq!(registration["client_name"], "Bomby");
        assert_eq!(registration["logo_uri"], LOGO_URI);
        assert_eq!(registration["scope"], "openid email offline_access");
        let token = body_of(&seen, "/token");
        assert!(
            token.contains("code=c0de")
                && token.contains("code_verifier=")
                && token.contains("resource=")
        );

        let refreshed = refresh(&http, &grant, 2_000).await.unwrap();
        assert_eq!(refreshed.access_token, "at2");
        assert_eq!(refreshed.refresh_token.as_deref(), Some("rt2"));
        assert_eq!(
            refreshed.account.as_deref(),
            Some("me@example.com"),
            "kept from the sign-in"
        );
    }

    #[tokio::test]
    async fn a_refused_refresh_means_signing_in_again() {
        let vendor = fake_vendor(false).await;
        let grant = Grant {
            client_id: "client_1".into(),
            token_endpoint: format!("{}/token", vendor.base),
            resource: "r".into(),
            access_token: "old".into(),
            refresh_token: Some("spent".into()),
            expires_at: Some(0),
            account: None,
        };
        let http = client().unwrap();
        assert!(matches!(
            refresh(&http, &grant, 1).await,
            Err(OAuthError::SignInAgain(_))
        ));
        let no_refresh = Grant {
            refresh_token: None,
            ..grant
        };
        assert!(matches!(
            refresh(&http, &no_refresh, 1).await,
            Err(OAuthError::SignInAgain(_))
        ));
    }
}
