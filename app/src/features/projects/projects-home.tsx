import { ChevronRight, Folder, Plus } from "lucide-react"
import { useState } from "react"

import { DayGlow, type Daypart, useDaypart } from "@/components/day-glow"
import { Mascot } from "@/components/mascot"
import { Button } from "@/components/ui/button"

import type { Project } from "./api"
import { shortPath, timeAgo } from "./names"

const GREETING: Record<Daypart, string> = {
  morning: "Good morning.",
  afternoon: "Good afternoon.",
  evening: "Good evening.",
}

/** How many recent projects show before See all. */
const RECENT = 3

/** When a project's newest call started, or null before its first (calls are newest first). */
function lastCall(project: Project): number | null {
  return project.calls[0]?.startedAt ?? null
}

/** "2 hours ago" for the newest call, or that there's none yet. */
function lastSeen(project: Project): string {
  const at = lastCall(project)
  return at === null ? "No calls yet" : timeAgo(at)
}

/** The newest call first; projects without one after, newest first. */
function byNewestCall(a: Project, b: Project): number {
  const [x, y] = [lastCall(a), lastCall(b)]
  if (x !== null && y !== null) return y - x
  if (x !== null) return -1
  if (y !== null) return 1
  return b.createdAt - a.createdAt
}

/**
 * The main panel with nothing selected (Paper "projects view"): the day's greeting in its
 * glow, then the recent projects, or the way to make the first one.
 */
export function ProjectsHome({
  projects,
  onOpen,
  onNewProject,
}: {
  projects: Project[]
  onOpen: (projectId: number) => void
  onNewProject: () => void
}) {
  const daypart = useDaypart()
  const [all, setAll] = useState(false)
  const recent = [...projects].sort(byNewestCall)
  const shown = all ? recent : recent.slice(0, RECENT)

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <DayGlow daypart={daypart} stage="rest" />
      <div className="relative flex min-h-0 flex-1 flex-col items-center [justify-content:safe_center] gap-9 overflow-auto px-6 pt-8 pb-11">
        <div className="flex flex-col items-center">
          <Mascot depth state="idle" size={92} />
          <h1 className="pt-5 font-heading text-[40px] leading-[44px] font-bold tracking-[-0.035em]">
            {GREETING[daypart]}
          </h1>
          <p className="pt-2 text-[15px] leading-[22px] text-muted-foreground">
            {projects.length === 0
              ? "Nothing here yet. Let's start your first project."
              : "Pick up where we left off, or just tell me which one."}
          </p>
        </div>

        {projects.length === 0 ? (
          <div className="flex flex-col items-center gap-3.5">
            <Button
              className="h-auto gap-2 rounded-[12px] py-3 pr-5 pl-4 text-[15px] leading-5 font-semibold shadow-[0_10px_24px_-12px_rgb(18_18_18/0.5)] [&_svg]:size-[18px] [&_svg]:stroke-[2.4]"
              onClick={onNewProject}
            >
              <Plus />
              Create your first project
            </Button>
            <p className="text-[13px] leading-[18px] text-muted-foreground">
              Pick any folder on your Mac. Your agent works right there.
            </p>
          </div>
        ) : (
          <div className="flex w-[480px] max-w-full flex-col gap-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                Recent
              </span>
              {recent.length > RECENT && (
                <button
                  type="button"
                  className="text-[13px] leading-4 font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
                  onClick={() => setAll(!all)}
                >
                  {all ? "Show fewer" : "See all"}
                </button>
              )}
            </div>
            <ul className="flex flex-col rounded-2xl bg-card p-1.5 shadow-[0_0_0_1px_var(--border),0_20px_40px_-24px_rgb(18_18_18/0.18)]">
              {shown.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3.5 rounded-[11px] py-2.5 pr-3 pl-2.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                    onClick={() => onOpen(project.id)}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted [&_svg]:size-[18px]">
                      <Folder />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <span className="truncate text-[15px] leading-[19px] font-semibold">
                        {project.name}
                      </span>
                      <span className="truncate font-mono text-xs leading-[15px] text-muted-foreground">
                        {project.folders[0]
                          ? shortPath(project.folders[0])
                          : ""}
                      </span>
                    </span>
                    <span className="flex w-32 shrink-0 items-center justify-end gap-2.5">
                      <span className="text-[13px] leading-4 text-muted-foreground">
                        {lastSeen(project)}
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground/70" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
