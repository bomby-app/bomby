# Zep notes

Checked 2026-11-06 against `zep-cloud` 4.0.1 (installed source, `agent/.venv/lib/python3.13/site-packages/zep_cloud/`). Why Bomby uses it: [decision](decisions/memory-across-calls-with-zep.md).

- **4.x addresses users and threads by Zep's UUIDs.** `user.create(user_id=...)` takes our own id and returns a `User` with `uuid_` (`uuid` on the wire); `user.lookup(user_id=...)` finds it again and raises `NotFoundError` when there's none. `thread.create(user_uuid=...)` takes only the user's UUID, so a thread can't be named and looked up by our id: Bomby opens a new thread per call.
- **Search is split by kind**: `graph.search(...)` from 3.x is gone; `graph.search_edges(graph_uuid, query=, page_size=, reranker=, filters=)` returns a pager whose first page is `.items`. A user's UUID works as its graph UUID. Rerankers: `rrf`, `mmr`, `node_distance`, `episode_mentions`, `cross_encoder`.
- **Facts still true**: `EdgeSearchFilters(date_filters=DateFilters(any_of=[DateFilterGroup(all_of=[DateFilter(field="invalid_at", operator="is_null")])]))`. An `Edge` has `fact`, `valid_at` and `invalid_at`.
- **The user's summary** is `user.get_node(user_uuid).summary`. A new user's is a stub built from its id, which Bomby skips.
- **Writing**: `thread.add_messages(thread_uuid, messages=[AddMessage(content=, role=, name=, reference_time=)], ignore_roles=["assistant"])`; ignored roles are stored but not mined for facts. `strict_ontology` stays off, so nothing is dropped for not matching a type.
- **LiveKit side** (`livekit-agents` 1.8.10, `voice/events.py`): writes hang off `user_input_transcribed` (`transcript`, `is_final`) and `conversation_item_added`; `on_user_turn_completed` never fires with Gemini's server-side turn detection.
