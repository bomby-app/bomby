# Agents per project

Status: accepted, 2026-11-06

## Context

Every call could hand work to every agent that's set up. Some projects want only one or two of them, and some calls are only for talking. The design is Paper's "Project settings · Agents" (page `project settings · agents`).

## Decision

- **Each project picks its agents** in Project settings: a switch (agents on or off), then All or the ones the user picks (`ProjectAgents` in `app/src-tauri/src/projects.rs`: `projects.agents_on`, the `project_agents` table). Saved as it changes, apart from the name, folders and instructions (`set_project_agents`).
- **All** is every agent that's set up, including ones added later. A pick reaches a call only once that agent is set up too: it's one more gate after the setup probe's (`for_project` in `calls.rs`), so the voice agent's own list (`agents` in the job's metadata) never changes shape. Off keeps the picks for when it's on again.
- **Off, the call still talks.** The metadata's `agents_off` tells the voice to say agents are off for the project, and where to turn them on, instead of how to install one.

## Consequences

- A change applies from the next call; one under way keeps the agents it opened with.
- Tiles for agents that aren't set up show grey with a bubblegum dot, and say where to set them up; they can still be picked.
