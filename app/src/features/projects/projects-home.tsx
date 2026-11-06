import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { ChevronRight, Folder, Plus } from "lucide-react"
import { useReducedMotion } from "motion/react"
import { useRef, useState } from "react"

import { DayGlow, type Daypart, useDaypart } from "@/components/day-glow"
import { Mascot } from "@/components/mascot"
import { Button } from "@/components/ui/button"

import type { Project } from "./api"
import { shortPath, timeAgo } from "./names"
import { lastCall, RECENT_COUNT, recentProjects } from "./recent"

gsap.registerPlugin(useGSAP)

// The mascot drops in and settles like something with weight: a damped spring (GSAP's
// elastic is a sine damped by 2^-10t), about two and a half waves (owner, 2026-11-05).
const DROP = { from: -36, duration: 1.6, ease: "elastic.out(1, 0.45)" }

const GREETING: Record<Daypart, string> = {
  morning: "Good morning.",
  afternoon: "Good afternoon.",
  evening: "Good evening.",
}

/** "2 hours ago" for the newest call, or that there's none yet. */
function lastSeen(project: Project): string {
  const at = lastCall(project)
  return at === null ? "No calls yet" : timeAgo(at)
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
  const still = useReducedMotion() === true
  const mascot = useRef<HTMLDivElement>(null)

  // Every time the home opens.
  useGSAP(() => {
    if (still) return
    gsap.fromTo(
      mascot.current,
      { y: DROP.from },
      { y: 0, duration: DROP.duration, ease: DROP.ease }
    )
    gsap.fromTo(
      mascot.current,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: 0.35, ease: "power1.out" }
    )
  })
  const recent = recentProjects(projects)
  const shown = all ? recent : recent.slice(0, RECENT_COUNT)

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <DayGlow daypart={daypart} stage="rest" />
      <div className="relative flex min-h-0 flex-1 flex-col items-center [justify-content:safe_center] gap-9 overflow-auto px-6 pt-8 pb-11">
        <div className="flex flex-col items-center">
          <div ref={mascot}>
            <Mascot depth state="idle" size={92} />
          </div>
          <h1 className="pt-5 font-heading text-display font-bold">
            {GREETING[daypart]}
          </h1>
          <p className="pt-2 text-lead text-muted-foreground">
            {projects.length === 0
              ? "Nothing here yet. Let's start your first project."
              : "Pick up where we left off, or just tell me which one."}
          </p>
        </div>

        {projects.length === 0 ? (
          <div className="flex flex-col items-center gap-3.5">
            <Button
              className="h-auto gap-2 rounded-xl py-3 pr-5 pl-4 text-[15px] leading-5 font-semibold shadow-primary [&_svg]:size-[18px] [&_svg]:stroke-[2.4]"
              onClick={onNewProject}
            >
              <Plus />
              Create your first project
            </Button>
            <p className="text-sm text-muted-foreground">
              Pick any folder on your Mac. Your agent works right there.
            </p>
          </div>
        ) : (
          <div className="flex w-[480px] max-w-full flex-col gap-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="font-mono text-label font-medium text-muted-foreground uppercase">
                Recent
              </span>
              {recent.length > RECENT_COUNT && (
                <button
                  type="button"
                  className="text-[13px] leading-4 font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
                  onClick={() => setAll(!all)}
                >
                  {all ? "Show fewer" : "See all"}
                </button>
              )}
            </div>
            <ul className="flex flex-col rounded-2xl bg-card p-1.5 shadow-float">
              {shown.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3.5 rounded-lg py-2.5 pr-3 pl-2.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                    onClick={() => onOpen(project.id)}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted [&_svg]:size-[18px]">
                      <Folder />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-base leading-5 font-semibold">
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
