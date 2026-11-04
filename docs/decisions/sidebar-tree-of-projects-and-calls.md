# Sidebar: a tree of projects and their calls

Status: accepted, 2026-11-03

## Context

The sidebar lists projects. Each project collects its calls over time, and a past call should be one click from its saved conversation. Two shadcn options fit: AI Elements File Tree (base) and the sidebar's own collapsible submenu.

## Decision

- The sidebar is a tree: projects at the top level, each one collapsible, its calls nested under it, newest first.
- Clicking a project opens it in the main panel. Clicking a call shows its saved conversation there, with the same transcript component a live call uses.
- Built with the sidebar's collapsible submenu: `SidebarMenu` > `SidebarMenuItem` with a `Collapsible`, the calls in `SidebarMenuSub`, per shadcn's sidebar docs.

## Why not File Tree

- File Tree is built for "the files the agent changed" (its docs): folder and file rows made of Collapsible and Button, outside the sidebar's styling. It would need restyling to match sidebar rows, active states and spacing.
- The sidebar submenu uses the same Collapsible underneath, and already has sidebar tokens, active and hover states, row actions (`SidebarMenuAction` for a new call or a menu) and the collapsed-sidebar behavior.
- File Tree stays the right component later for the files an agent touched, in the agents panel.

## Consequences

- Two levels only. If calls need grouping (by day), it goes in the submenu as labels, not as a third level.
