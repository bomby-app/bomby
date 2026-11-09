//! Search for the command palette: projects by name, and calls by what was said in them,
//! from the full-text index over their lines (`messages_search`, migration 8 in db.rs).
//! Both come back for one query, so a word in a project's name and in a call both show.

use rusqlite::{Connection, params};
use serde::Serialize;
use tauri::State;

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
    /// Those with a line that has every word, the latest first.
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
    /// Who said the first line that matched.
    #[cfg_attr(test, ts(type = "\"user\" | \"agent\""))]
    role: String,
    /// That line around what matched, each match between U+0002 and U+0003.
    snippet: String,
    /// How many of the call's lines matched.
    matches: i64,
}

/// The query's words: what's between spaces, without the empty.
fn words(query: &str) -> Vec<&str> {
    query.split_whitespace().collect()
}

/// `text` for a LIKE pattern, its wildcards matched as themselves (`ESCAPE '\'`).
fn like_escaped(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn projects(conn: &Connection, words: &[&str], query: &str) -> Result<Vec<ProjectHit>> {
    let mut sql = "SELECT id, name FROM projects WHERE 1".to_owned();
    let mut args: Vec<String> = Vec::new();
    for word in words {
        args.push(format!("%{}%", like_escaped(word)));
        sql.push_str(&format!(" AND name LIKE ?{} ESCAPE '\\'", args.len()));
    }
    args.push(format!("{}%", like_escaped(query.trim())));
    sql.push_str(&format!(
        " ORDER BY name LIKE ?{} ESCAPE '\\' DESC, name COLLATE NOCASE LIMIT {MAX_PROJECTS}",
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
        // FTS5 refuses snippet() beside window functions, so the matching lines come first.
        "WITH hits AS MATERIALIZED (
             SELECT rowid AS id, snippet(messages_search, 0, ?2, ?3, '…', ?4) AS snippet
             FROM messages_search WHERE messages_search MATCH ?1
         )
         SELECT call_id, project_id, project_name, started_at, role, snippet, matches FROM (
             SELECT m.call_id, c.project_id, p.name AS project_name, c.started_at, m.role,
                 hits.snippet,
                 ROW_NUMBER() OVER (PARTITION BY m.call_id ORDER BY m.created_at, m.id) AS nth,
                 COUNT(*) OVER (PARTITION BY m.call_id) AS matches
             FROM hits
             JOIN messages m ON m.id = hits.id
             JOIN calls c ON c.id = m.call_id
             JOIN projects p ON p.id = c.project_id
         )
         WHERE nth = 1
         ORDER BY started_at DESC, call_id DESC
         LIMIT ?5",
    )?
    .query_map(
        params![expression, MARK_START, MARK_END, SNIPPET_TOKENS, MAX_CALLS],
        |row| {
            Ok(CallHit {
                call_id: row.get(0)?,
                project_id: row.get(1)?,
                project_name: row.get(2)?,
                started_at: row.get(3)?,
                role: row.get(4)?,
                snippet: row.get(5)?,
                matches: row.get(6)?,
            })
        },
    )?
    .collect::<rusqlite::Result<_>>()
    .map_err(Into::into)
}

fn search_in(conn: &Connection, query: &str) -> Result<SearchResults> {
    let words = words(query);
    if words.is_empty() {
        return Ok(SearchResults::default());
    }
    Ok(SearchResults {
        projects: projects(conn, &words, query)?,
        calls: calls(conn, &words)?,
    })
}

/// Projects whose name has every word of `query`, and calls with a line that has every
/// word (each of three characters or more), any case.
#[tauri::command(async)]
pub fn search(db: State<'_, Db>, query: String) -> Result<SearchResults> {
    search_in(&db.conn(), &query)
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
        let conn = db.conn();
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
        let conn = db.conn();
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
        assert_eq!((first.role.as_str(), first.matches), ("user", 2));
        assert_eq!(first.snippet, "What about the \u{2}reminders\u{3} on iOS?");
        let rambling = call(&conn, garden, 3);
        let line = format!("{} pumpkins {}", "x".repeat(200), "y".repeat(200));
        say(&conn, rambling, "e", "user", &line);
        let long = &search_in(&conn, "pumpkins").unwrap().calls[0].snippet;
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
    fn follows_lines_as_they_grow_and_go() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
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
