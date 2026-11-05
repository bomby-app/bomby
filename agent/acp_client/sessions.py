"""Ending a session in an agent: deleting it, which takes it out of the agent's history, or
closing it, which only frees it. Each is sent only when the agent advertises it
(`sessionCapabilities`), and a failure is logged, never raised: the work is over either way.
"""

import asyncio
import logging

from acp import RequestError
from acp.client.connection import ClientSideConnection
from acp.schema import AgentCapabilities

logger = logging.getLogger("bomby.acp_client.sessions")

TIMEOUT_S = 5


def can_delete(capabilities: AgentCapabilities | None) -> bool:
    sessions = capabilities.session_capabilities if capabilities else None
    return sessions is not None and sessions.delete is not None


async def discard_session(
    conn: ClientSideConnection, session_id: str, capabilities: AgentCapabilities | None
) -> None:
    """Ends a session nobody will come back to: deletes it where the agent can, closes it
    otherwise, where it stays in the agent's history."""
    if can_delete(capabilities):
        await delete_session(conn, session_id)
    else:
        await close_session(conn, session_id, capabilities)


async def close_session(
    conn: ClientSideConnection, session_id: str, capabilities: AgentCapabilities | None
) -> None:
    sessions = capabilities.session_capabilities if capabilities else None
    if sessions is None or sessions.close is None:
        return
    try:
        # Shielded, here and in `delete_session`, so a call ending meanwhile doesn't stop it.
        _ = await asyncio.wait_for(
            asyncio.shield(conn.close_session(session_id=session_id)), TIMEOUT_S
        )
    except (RequestError, ConnectionError, TimeoutError) as e:
        logger.warning("closing session %s failed: %s", session_id, e)


async def delete_session(conn: ClientSideConnection, session_id: str) -> None:
    try:
        # SDK 0.12.1 has the schema but no method for it (docs/acp-notes.md).
        request = conn._conn.send_request(  # pyright: ignore[reportPrivateUsage]
            "session/delete", {"sessionId": session_id}
        )
        _ = await asyncio.wait_for(asyncio.shield(request), TIMEOUT_S)
    except (RequestError, ConnectionError, TimeoutError) as e:
        logger.warning("deleting session %s failed: %s", session_id, e)
