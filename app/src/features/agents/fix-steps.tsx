import { Info } from "lucide-react"
import { type ReactNode, useTransition } from "react"

import { CheckAgainButton } from "@/components/check-again-button"
import { CopyCommand } from "@/components/copy-command"
import { InlineLink } from "@/components/inline-link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import { type AgentStatus, openInstallPage } from "./api"
import { forgetListedSettings } from "./use-agent-settings"
import { checkAgentsAgain, setupStep } from "./use-agents"

/**
 * A small (i) beside an agent's status when its own setup needs a fix (a sign-in, or it
 * didn't start), opening the steps. Nothing for any other status. `asking`: it didn't
 * answer in time, likely because macOS is asking for a password for it, which comes first:
 * answer it, or, when its row offers a key field, save the key that stops the asking.
 */
export function FixSteps({
  agent,
  asking = false,
}: {
  agent: AgentStatus
  asking?: boolean
}) {
  const step = setupStep(agent)
  const [checking, startCheck] = useTransition()
  if (step !== "sign_in" && step !== "unreachable") return null
  const { name, check, setup } = agent
  const signIn = setup?.fix
  const first = asking ? 2 : 1
  const savable = (setup?.keys.length ?? 0) > 0

  return (
    <Dialog>
      <DialogTrigger
        aria-label={`How to fix ${name}`}
        className="shrink-0 rounded-full text-claude transition-opacity outline-none hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="size-3.5" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {step === "sign_in" ? `Set up ${name}` : `${name} didn't start`}
          </DialogTitle>
          <DialogDescription>
            Bomby uses {name} from the command line. The desktop app's sign-in
            doesn't carry over.
          </DialogDescription>
        </DialogHeader>
        {setup?.problem && (
          <p className="max-h-24 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground select-text">
            {setup.problem}
          </p>
        )}
        <ol className="flex flex-col gap-3">
          {step === "sign_in" ? (
            <>
              <Step n={1} command={signIn ?? undefined}>
                {signIn
                  ? "Open Terminal, run this and follow its steps:"
                  : `Open ${name} in Terminal and sign in.`}
              </Step>
              <Step n={2}>Come back and check again.</Step>
            </>
          ) : (
            <>
              {asking && (
                <Step n={1}>
                  Your Mac may be asking for your password so {name} can read
                  its keychain.{" "}
                  {savable
                    ? `Answer it, or save ${name}'s key in its row and Bomby hands it over instead, so it doesn't ask.`
                    : "Answer it, then check again."}
                </Step>
              )}
              <Step n={first} command={check}>
                {asking
                  ? "If it still doesn't answer, open Terminal and run this to see what's wrong:"
                  : "Open Terminal and run this to see what's wrong:"}
              </Step>
              {signIn && (
                <Step n={first + 1} command={signIn}>
                  If it isn't signed in:
                </Step>
              )}
              <Step n={first + (signIn ? 2 : 1)}>
                If it's out of date,{" "}
                <InlineLink onClick={() => void openInstallPage(agent)}>
                  update it
                </InlineLink>
                .
              </Step>
            </>
          )}
        </ol>
        <DialogFooter>
          <CheckAgainButton
            checking={checking}
            onClick={() =>
              startCheck(() => {
                forgetListedSettings()
                return checkAgentsAgain()
              })
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Step({
  n,
  command,
  children,
}: {
  n: number
  command?: string
  children: ReactNode
}) {
  return (
    <li className="flex gap-2 text-sm">
      <span className="w-3 shrink-0 text-muted-foreground tabular-nums">
        {n}.
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span>{children}</span>
        {command && <CopyCommand command={command} />}
      </div>
    </li>
  )
}
