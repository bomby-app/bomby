import { ArrowUpRight } from "lucide-react"
import type { ComponentProps } from "react"

import { Button } from "@/components/ui/button"

import { type AgentStatus, openInstallPage } from "./api"

/**
 * Opens the agent's own install page in the browser. Installing it, and signing in, stay
 * the agent's own: Bomby only finds it after (docs/decisions/detect-acp-native-agents.md).
 */
export function InstallButton({
  agent,
  ...props
}: { agent: AgentStatus } & Omit<
  ComponentProps<typeof Button>,
  "onClick" | "children"
>) {
  return (
    <Button
      aria-label={`Install ${agent.name}`}
      {...props}
      onClick={() => void openInstallPage(agent)}
    >
      Install
      <ArrowUpRight data-icon="inline-end" />
    </Button>
  )
}
