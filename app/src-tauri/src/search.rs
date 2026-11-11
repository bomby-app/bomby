//! Search for the command palette: projects by name, and calls by their name and what was
//! said in them, from the full-text index over their lines (`messages_search`, migration 8
//! in db.rs).
//! Both come back for one query, so a word in a project's name and in a call both show.

use caseless::Caseless;
use rusqlite::functions::FunctionFlags;
use rusqlite::{Connection, params};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};
use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;

use crate::blocking::blocking;
use crate::db::Db;
use crate::error::Result;

/// The most projects and calls one search returns.
const MAX_PROJECTS: i64 = 8;
const MAX_CALLS: i64 = 20;
/// How much of a line a call's snippet keeps around what matched, in the index's tokens:
/// with trigrams, about a character each. FTS5's most.
const SNIPPET_TOKENS: i64 = 64;
/// Around each match in a snippet, for the page to highlight (`features/search/`): control
/// characters, which no transcript line holds.
const MARK_START: &str = "\u{2}";
const MARK_END: &str = "\u{3}";

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "search.ts"))]
pub struct SearchResults {
    /// Those whose name has every word, those starting with the query first.
    projects: Vec<ProjectHit>,
    /// Those whose name or a line has every word, the latest first.
    calls: Vec<CallHit>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "search.ts"))]
pub struct ProjectHit {
    id: i64,
    name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "search.ts"))]
pub struct CallHit {
    call_id: i64,
    project_id: i64,
    project_name: String,
    started_at: i64,
    /// The call's name, if it has one.
    name: Option<String>,
    /// The first line that matched, if one did: the name alone may have.
    line: Option<LineHit>,
    /// How many of the call's lines matched.
    matches: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "search.ts"))]
pub struct LineHit {
    /// Who said it.
    #[cfg_attr(test, ts(type = "\"user\" | \"agent\""))]
    role: String,
    /// The line around what matched, each match between U+0002 and U+0003.
    snippet: String,
}

/// `text` as names are compared: Unicode's canonical case folding (decomposed, folded,
/// decomposed again), which lowercase alone isn't ("ΟΣ" holds "Σ", "Straße" is "STRASSE"),
/// then without accents ("Écran" is "ecran"), as the transcript index matches lines
/// (`remove_diacritics`). SQLite's own `LIKE` folds only ASCII.
pub(crate) fn fold(text: &str) -> String {
    text.chars()
        .nfd()
        .default_case_fold()
        .nfd()
        .filter(|c| !is_combining_mark(*c))
        .collect()
}

/// Gives the connection `fold(text)` for queries; null stays null.
pub(crate) fn add_fold(conn: &Connection) -> rusqlite::Result<()> {
    conn.create_scalar_function(
        "fold",
        1,
        FunctionFlags::SQLITE_UTF8
            | FunctionFlags::SQLITE_DETERMINISTIC
            | FunctionFlags::SQLITE_INNOCUOUS,
        |ctx| Ok(ctx.get::<Option<String>>(0)?.map(|text| fold(&text))),
    )
}

/// The query's words: what's between spaces, without the empty.
fn words(query: &str) -> Vec<&str> {
    query.split_whitespace().collect()
}

/// `text` folded for a LIKE pattern against a folded column, its wildcards matched as
/// themselves (`ESCAPE '\'`).
fn like_escaped(text: &str) -> String {
    fold(text)
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn projects(conn: &Connection, words: &[&str], query: &str) -> Result<Vec<ProjectHit>> {
    let mut sql = "SELECT id, name FROM projects WHERE 1".to_owned();
    let mut args: Vec<String> = Vec::new();
    for word in words {
        args.push(format!("%{}%", like_escaped(word)));
        sql.push_str(&format!(" AND fold(name) LIKE ?{} ESCAPE '\\'", args.len()));
    }
    args.push(format!("{}%", like_escaped(query.trim())));
    sql.push_str(&format!(
        " ORDER BY fold(name) LIKE ?{} ESCAPE '\\' DESC, name COLLATE NOCASE LIMIT {MAX_PROJECTS}",
        args.len()
    ));
    conn.prepare(&sql)?
        .query_map(rusqlite::params_from_iter(&args), |row| {
            Ok(ProjectHit {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()
        .map_err(Into::into)
}

/// The index's query for lines with every word, each as a phrase; `None` when no word has
/// the three characters a trigram needs.
fn match_expression(words: &[&str]) -> Option<String> {
    let phrases: Vec<String> = words
        .iter()
        .filter(|word| word.chars().count() >= 3)
        .map(|word| format!("\"{}\"", word.replace('"', "\"\"")))
        .collect();
    (!phrases.is_empty()).then(|| phrases.join(" "))
}

fn calls(conn: &Connection, words: &[&str]) -> Result<Vec<CallHit>> {
    let Some(expression) = match_expression(words) else {
        return Ok(Vec::new());
    };
    conn.prepare(
        // Each call's first matching line and how many matched, the latest calls first,
        // then a snippet cut only for the lines of those calls: snippet() is the costly
        // part, and a common word can match thousands of lines. FTS5 refuses snippet()
        // beside window functions, so the choosing comes first, materialized.
        "WITH hits AS MATERIALIZED (
             SELECT rowid AS id FROM messages_search WHERE messages_search MATCH ?1
         ),
         firsts AS (
             SELECT m.id, m.call_id, m.role,
                 ROW_NUMBER() OVER (PARTITION BY m.call_id ORDER BY m.created_at, m.id) AS nth,
                 COUNT(*) OVER (PARTITION BY m.call_id) AS matches
             FROM hits JOIN messages m ON m.id = hits.id
         ),
         chosen AS MATERIALIZED (
             SELECT f.id, f.call_id, c.project_id, p.name AS project_name, c.started_at,
                 c.name, f.role, f.matches
             FROM firsts f
             JOIN calls c ON c.id = f.call_id
             JOIN projects p ON p.id = c.project_id
             WHERE f.nth = 1
             ORDER BY c.started_at DESC, c.id DESC
             LIMIT ?5
         )
         SELECT chosen.call_id, chosen.project_id, chosen.project_name, chosen.started_at,
             chosen.name, chosen.role, snippet(messages_search, 0, ?2, ?3, '…', ?4),
             chosen.matches
         FROM chosen
         JOIN messages_search ON messages_search.rowid = chosen.id
         WHERE messages_search MATCH ?1
         ORDER BY chosen.started_at DESC, chosen.call_id DESC",
    )?
    .query_map(
        params![expression, MARK_START, MARK_END, SNIPPET_TOKENS, MAX_CALLS],
        |row| {
            Ok(CallHit {
                call_id: row.get(0)?,
                project_id: row.get(1)?,
                project_name: row.get(2)?,
                started_at: row.get(3)?,
                name: row.get(4)?,
                line: Some(LineHit {
                    role: row.get(5)?,
                    snippet: row.get(6)?,
                }),
                matches: row.get(7)?,
            })
        },
    )?
    .collect::<rusqlite::Result<_>>()
    .map_err(Into::into)
}

/// Calls whose name has every word, the latest first, without a line.
fn named_calls(conn: &Connection, words: &[&str]) -> Result<Vec<CallHit>> {
    let mut sql = "SELECT c.id, c.project_id, p.name, c.started_at, c.name
         FROM calls c JOIN projects p ON p.id = c.project_id
         WHERE c.name IS NOT NULL"
        .to_owned();
    let args: Vec<String> = words
        .iter()
        .map(|word| format!("%{}%", like_escaped(word)))
        .collect();
    for n in 1..=args.len() {
        sql.push_str(&format!(" AND fold(c.name) LIKE ?{n} ESCAPE '\\'"));
    }
    sql.push_str(&format!(
        " ORDER BY c.started_at DESC, c.id DESC LIMIT {MAX_CALLS}"
    ));
    conn.prepare(&sql)?
        .query_map(rusqlite::params_from_iter(&args), |row| {
            Ok(CallHit {
                call_id: row.get(0)?,
                project_id: row.get(1)?,
                project_name: row.get(2)?,
                started_at: row.get(3)?,
                name: row.get(4)?,
                line: None,
                matches: 0,
            })
        })?
        .collect::<rusqlite::Result<_>>()
        .map_err(Into::into)
}

/// Calls whose name or a line matched, once each with its line if one did, the latest
/// first, at most `MAX_CALLS`.
fn all_calls(conn: &Connection, words: &[&str]) -> Result<Vec<CallHit>> {
    let mut hits = calls(conn, words)?;
    let said: std::collections::HashSet<i64> = hits.iter().map(|hit| hit.call_id).collect();
    hits.extend(
        named_calls(conn, words)?
            .into_iter()
            .filter(|hit| !said.contains(&hit.call_id)),
    );
    hits.sort_by_key(|hit| std::cmp::Reverse((hit.started_at, hit.call_id)));
    hits.truncate(usize::try_from(MAX_CALLS).unwrap_or(usize::MAX));
    Ok(hits)
}

fn search_in(conn: &Connection, query: &str) -> Result<SearchResults> {
    let words = words(query);
    if words.is_empty() {
        return Ok(SearchResults::default());
    }
    Ok(SearchResults {
        projects: projects(conn, &words, query)?,
        calls: all_calls(conn, &words)?,
    })
}

/// Projects whose name has every word of `query`, and calls whose name has every word or
/// with a line that has every word (each of three characters or more), any case.
#[tauri::command]
pub async fn search<R: Runtime>(app: AppHandle<R>, query: String) -> Result<SearchResults> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        search_in(&*db.conn()?, &query)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(conn: &Connection, name: &str) -> i64 {
        conn.execute(
            "INSERT INTO projects (name, created_at) VALUES (?1, 0)",
            [name],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn call(conn: &Connection, project_id: i64, started_at: i64) -> i64 {
        conn.execute(
            "INSERT INTO calls (project_id, started_at) VALUES (?1, ?2)",
            params![project_id, started_at],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn say(conn: &Connection, call_id: i64, segment: &str, role: &str, text: &str) {
        conn.execute(
            "INSERT INTO messages (call_id, segment_id, role, text, created_at)
             VALUES (?1, ?2, ?3, ?4, 0)
             ON CONFLICT (call_id, segment_id) DO UPDATE SET text = excluded.text",
            params![call_id, segment, role, text],
        )
        .unwrap();
    }

    fn call_ids(results: &SearchResults) -> Vec<i64> {
        results.calls.iter().map(|c| c.call_id).collect()
    }

    #[test]
    fn finds_projects_by_any_part_of_their_name_starts_first() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        project(&conn, "Garden planner");
        project(&conn, "Plant shop");
        project(&conn, "Samba");
        project(&conn, "100%_done");

        let names = |query: &str| -> Vec<String> {
            search_in(&conn, query)
                .unwrap()
                .projects
                .into_iter()
                .map(|p| p.name)
                .collect()
        };
        assert_eq!(names("plan"), ["Plant shop", "Garden planner"]);
        assert_eq!(names("GARDEN plan"), ["Garden planner"]);
        assert_eq!(names("%_"), ["100%_done"], "wildcards match as themselves");
        assert!(names("   ").is_empty());
    }

    #[test]
    fn finds_calls_by_what_was_said_once_each_the_latest_first() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        let garden = project(&conn, "Garden");
        let older = call(&conn, garden, 1);
        let newer = call(&conn, garden, 2);
        say(&conn, older, "a", "user", "Fix the watering reminders");
        say(
            &conn,
            newer,
            "b",
            "user",
            "What about the reminders on iOS?",
        );
        say(&conn, newer, "c", "agent", "The reminders fire twice.");
        say(&conn, newer, "d", "agent", "Nothing else to report.");

        let results = search_in(&conn, "Reminders").unwrap();
        assert_eq!(call_ids(&results), [newer, older]);
        let first = &results.calls[0];
        assert_eq!(first.project_name, "Garden");
        let said = first.line.as_ref().unwrap();
        assert_eq!((said.role.as_str(), first.matches), ("user", 2));
        assert_eq!(said.snippet, "What about the \u{2}reminders\u{3} on iOS?");
        let rambling = call(&conn, garden, 3);
        let line = format!("{} pumpkins {}", "x".repeat(200), "y".repeat(200));
        say(&conn, rambling, "e", "user", &line);
        let results = search_in(&conn, "pumpkins").unwrap();
        let long = &results.calls[0].line.as_ref().unwrap().snippet;
        assert!(
            long.starts_with('…') && long.ends_with('…') && long.chars().count() < 100,
            "a long line is cut around what matched: {long}"
        );

        assert_eq!(call_ids(&search_in(&conn, "fire remind").unwrap()), [newer]);
        assert_eq!(
            call_ids(&search_in(&conn, "ios rémindérs").unwrap()),
            [newer],
            "any case, accents aside"
        );
        assert!(
            search_in(&conn, "on").unwrap().calls.is_empty(),
            "two characters are too few for the index"
        );
        assert!(
            search_in(&conn, "\"quoted\" fire")
                .unwrap()
                .calls
                .is_empty()
        );
    }

    #[test]
    fn finds_calls_by_their_name_once_each_with_a_line_when_one_matched_too() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        let garden = project(&conn, "Garden");
        let named = call(&conn, garden, 1);
        let both = call(&conn, garden, 2);
        let unnamed = call(&conn, garden, 3);
        for (id, name) in [(named, "Watering UI"), (both, "Reminders on iOS")] {
            conn.execute(
                "UPDATE calls SET name = ?1, named_by = 'user' WHERE id = ?2",
                params![name, id],
            )
            .unwrap();
        }
        say(&conn, both, "a", "user", "The reminders fire twice");
        say(&conn, unnamed, "b", "user", "Reminders again");

        let results = search_in(&conn, "ui water").unwrap();
        assert_eq!(
            call_ids(&results),
            [named],
            "any part, any case, short words too"
        );
        assert_eq!(results.calls[0].name.as_deref(), Some("Watering UI"));
        assert!(results.calls[0].line.is_none());

        let results = search_in(&conn, "reminders").unwrap();
        assert_eq!(call_ids(&results), [unnamed, both]);
        assert!(results.calls.iter().all(|hit| hit.line.is_some()));
        assert_eq!(results.calls[1].name.as_deref(), Some("Reminders on iOS"));
        assert!(search_in(&conn, "100%").unwrap().calls.is_empty());

        conn.execute(
            "UPDATE calls SET name = 'Écran d''accueil' WHERE id = ?1",
            [named],
        )
        .unwrap();
        for query in ["écran", "ECRAN", "accueil é"] {
            assert_eq!(
                call_ids(&search_in(&conn, query).unwrap()),
                [named],
                "any case in any script, accents aside: {query}"
            );
        }
    }

    #[test]
    fn folds_case_in_any_script_and_takes_accents_off() {
        assert_eq!(fold("Écran ÜBER Straße"), "ecran uber strasse");
        assert_eq!(fold("ÇA"), "ca");
        assert_eq!(fold("ΟΣ"), fold("οσ"), "final sigma folds like any other");
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        project(&conn, "Café Ölmühle");
        let found: Vec<String> = search_in(&conn, "cafe OLM")
            .unwrap()
            .projects
            .into_iter()
            .map(|p| p.name)
            .collect();
        assert_eq!(found, ["Café Ölmühle"]);

        for (name, query) in [("ΟΣ", "Σ"), ("Straße", "STRASSE"), ("STRASSE", "straße")] {
            project(&conn, name);
            let found: Vec<String> = search_in(&conn, query)
                .unwrap()
                .projects
                .into_iter()
                .map(|p| p.name)
                .collect();
            assert!(
                found.iter().any(|n| n == name),
                "{query} finds {name}: {found:?}"
            );
        }
    }

    #[test]
    fn a_common_word_gives_the_latest_calls_each_with_its_snippet() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        let garden = project(&conn, "Garden");
        let calls: Vec<i64> = (0..MAX_CALLS + 5)
            .map(|at| {
                let id = call(&conn, garden, at);
                say(&conn, id, "a", "user", "The plan for the week");
                say(&conn, id, "b", "agent", "Then the beds");
                id
            })
            .collect();

        let results = search_in(&conn, "the").unwrap();
        let newest: Vec<i64> = calls
            .iter()
            .rev()
            .take(usize::try_from(MAX_CALLS).unwrap())
            .copied()
            .collect();
        assert_eq!(call_ids(&results), newest);
        for hit in &results.calls {
            assert_eq!(hit.matches, 2);
            assert_eq!(
                hit.line.as_ref().unwrap().snippet,
                "\u{2}The\u{3} plan for \u{2}the\u{3} week",
                "the first matching line"
            );
        }
    }

    #[test]
    fn follows_lines_as_they_grow_and_go() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        let garden = project(&conn, "Garden");
        let id = call(&conn, garden, 1);
        say(&conn, id, "a", "user", "Water the");
        assert!(search_in(&conn, "tomatoes").unwrap().calls.is_empty());
        say(&conn, id, "a", "user", "Water the tomatoes");
        assert_eq!(call_ids(&search_in(&conn, "tomatoes").unwrap()), [id]);
        assert_eq!(
            search_in(&conn, "Water").unwrap().calls[0].matches,
            1,
            "a line that grew is indexed once"
        );

        conn.execute("DELETE FROM projects WHERE id = ?1", [garden])
            .unwrap();
        assert!(
            search_in(&conn, "tomatoes").unwrap().calls.is_empty(),
            "a deleted project's calls go from the index with it"
        );
        // A stale entry would only drop out of the join; the index's own check finds it.
        conn.execute(
            "INSERT INTO messages_search (messages_search) VALUES ('integrity-check')",
            [],
        )
        .expect("the index matches the lines");
    }
}
