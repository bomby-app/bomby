/** What the main panel shows: a project, one of its calls, or nothing yet. */
export type Selection =
  | { kind: "project"; projectId: number }
  | { kind: "call"; projectId: number; callId: number }
  | null
