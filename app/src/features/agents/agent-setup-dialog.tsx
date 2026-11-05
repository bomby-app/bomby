import { LoaderCircle } from "lucide-react"
import { useEffect, useEffectEvent, useState } from "react"

import { CheckAgainButton } from "@/components/check-again-button"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldError, FieldGroup } from "@/components/ui/field"

import {
  type AgentStatus,
  agentSetupOptions,
  type Choice,
  type Setting,
  type Setup,
} from "./api"
import { CommandBox } from "./command-box"
import { SetUpButton } from "./set-up-button"
import { SettingField } from "./setting-field"
import { useAdapterInstall } from "./use-adapter-install"
import { saveSetup } from "./use-agents"

/**
 * The last step of setting an agent up (`setupStep` in `use-agents.ts`): pick its model and
 * effort from what it offers, and save. Calls use an agent only once it's saved here.
 * Opened from Settings, Agents (Pick model, Change) and the first-run splash. Connecting
 * and signing in happen on the agent's row or card; the dialog shows them only for an agent
 * whose needs show once a session opens, like omp without a provider.
 */
export function AgentSetupDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: AgentStatus | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open, so every opening asks the agent afresh. */}
        {open && agent && (
          <SetupFlow agent={agent} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Where the flow is, from what the agent answered last. */
type Step = "asking" | "connect" | "sign-in" | "choose"

function stepOf(offer: Setup | null): Step {
  if (offer === null) return "asking"
  if (offer.adapter) return "connect"
  if (!offer.ready && !offer.choiceGone) return "sign-in"
  return "choose"
}

/** The saved setup to start from, unless one of its choices has gone. */
function savedChoices(agent: AgentStatus): Choice[] {
  if (!agent.setUp || !agent.setup || agent.setup.choiceGone) return []
  return currentChoices(agent.setup.settings)
}

function currentChoices(settings: Setting[]): Choice[] {
  return settings.map((s) => ({ setting: s.id, value: s.current }))
}

function SetupFlow({
  agent,
  onDone,
}: {
  agent: AgentStatus
  onDone: () => void
}) {
  const [offer, setOffer] = useState<Setup | null>(null)
  const [asking, setAsking] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const install = useAdapterInstall()

  function answered(next: Setup) {
    setOffer(next)
    setError(null)
    setAsking(false)
  }

  function failed(e: unknown) {
    setError(String(e))
    setAsking(false)
  }

  /** Asks the agent what it offers with `choices`. */
  function ask(choices: Choice[]) {
    setAsking(true)
    setError(null)
    agentSetupOptions(agent.id, choices).then(answered, failed)
  }

  // Asks once when the flow opens, and again once its adapter is installed.
  const askSaved = useEffectEvent(() =>
    agentSetupOptions(agent.id, savedChoices(agent))
  )
  const adapterMissing = agent.setup?.adapter ?? null
  useEffect(() => {
    askSaved().then(answered, failed)
  }, [adapterMissing])

  /** A new value for the setting at `index`: the later ones go back to what it offers. */
  function change(index: number, value: string) {
    if (!offer) return
    const before = currentChoices(offer.settings.slice(0, index))
    ask([...before, { setting: offer.settings[index].id, value }])
  }

  async function save() {
    if (!offer) return
    setSaving(true)
    setError(null)
    try {
      await saveSetup(agent.id, currentChoices(offer.settings))
      onDone()
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  const step = stepOf(offer)
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {step === "choose" || step === "asking"
            ? `Pick ${agent.name}'s model`
            : `Set up ${agent.name}`}
        </DialogTitle>
        <DialogDescription>{describe(step, agent.name)}</DialogDescription>
      </DialogHeader>

      {step === "asking" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Asking {agent.name} what it offers...
        </p>
      )}

      {step === "connect" && (
        <div>
          <SetUpButton size="default" />
        </div>
      )}

      {step === "sign-in" && offer && (
        <SignIn
          offer={offer}
          name={agent.name}
          checking={asking}
          onCheck={() => ask(savedChoices(agent))}
        />
      )}

      {step === "choose" && offer && (
        <FieldGroup>
          {offer.choiceGone && offer.problem && (
            <p className="text-sm text-muted-foreground">
              {offer.problem}. Pick again.
            </p>
          )}
          {offer.settings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {agent.name} has nothing to pick: it runs on its own setup.
            </p>
          ) : (
            offer.settings.map((setting, index) => (
              <SettingField
                key={setting.id}
                setting={setting}
                disabled={asking || saving}
                onChange={(value) => change(index, value)}
              />
            ))
          )}
        </FieldGroup>
      )}

      {(error ?? install.error) && (
        <FieldError>{error ?? install.error}</FieldError>
      )}

      {step === "choose" && (
        <DialogFooter>
          <Button
            variant="highlighter"
            disabled={asking || saving}
            onClick={() => void save()}
          >
            {(asking || saving) && <LoaderCircle className="animate-spin" />}
            {saving ? "Saving..." : asking ? "Checking..." : "Save"}
          </Button>
        </DialogFooter>
      )}
    </>
  )
}

function describe(step: Step, name: string): string {
  switch (step) {
    case "asking":
    case "choose":
      return `What ${name} runs on in your calls. Its own settings stay as they are.`
    case "connect":
      return `${name} is on your Mac. Set up gets it ready for Bomby.`
    case "sign-in":
      return `${name} needs one thing before Bomby can use it.`
  }
}

/** What the agent needs before it can be set up, and the command that fixes it. */
function SignIn({
  offer,
  name,
  checking,
  onCheck,
}: {
  offer: Setup
  name: string
  checking: boolean
  onCheck: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {offer.problem && <p className="text-sm select-text">{offer.problem}.</p>}
      {offer.fix ? (
        <>
          <p className="text-sm text-muted-foreground">
            Run this in Terminal, then check again.
          </p>
          <CommandBox command={offer.fix} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Set it up in {name}, then check again.
        </p>
      )}
      <div>
        <CheckAgainButton checking={checking} onClick={onCheck} />
      </div>
    </div>
  )
}
