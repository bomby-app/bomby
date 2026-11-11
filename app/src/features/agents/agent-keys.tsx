import { ApiKeyForm } from "@/components/api-key-form"

import { type AgentStatus, clearAgentKey, saveAgentKey } from "./api"
import { keyFields } from "./key-fields"
import { forgetAgentListing } from "./listing-cache"
import { useAgentKeysError, useSavedAgentKeys } from "./use-agent-keys"

/**
 * The keys an agent asks for, as its setup probe lists them (`setup.keys`: the agent's own
 * ACP `env_var` auth methods, else its harness's, for its provider where they follow one),
 * and any key saved for it it no longer asks for, each saved in the keychain and handed to
 * this agent alone when Bomby starts it (docs/decisions/agent-keys-through-the-environment.md).
 * Write-only, like every key. A change rechecks the agent in the core, and its model list
 * here is asked again: another key can mean other models.
 */
export function AgentKeys({ agent }: { agent: AgentStatus }) {
  const { saved, known } = useSavedAgentKeys(agent.id)
  const failed = useAgentKeysError() !== null
  const fields = keyFields(agent.setup?.keys ?? [], saved)
  if (fields.length === 0) return null
  // Not known yet (or the read failed, which the section says once): a field can't say
  // whether its key is saved, so none offers Save over one that may be.
  if (!known)
    return (
      <p className="text-sm text-muted-foreground">
        {failed
          ? `Bomby couldn't check which of ${agent.name}'s keys are saved.`
          : `Checking which of ${agent.name}'s keys are saved...`}
      </p>
    )
  return (
    <div className="flex flex-col gap-3">
      {fields.map((field) => (
        <ApiKeyForm
          key={field.name}
          id={`${agent.id}-${field.name}`}
          label={field.label}
          info={`Save ${agent.name}'s key here and Bomby hands it to ${agent.name} alone, so your Mac stops asking for your password when ${agent.name} starts. Without one, ${agent.name} uses its own.`}
          saved={saved.includes(field.name)}
          save={async (key) => {
            await saveAgentKey(agent.id, field.name, key)
            forgetAgentListing(agent.id)
          }}
          remove={async () => {
            await clearAgentKey(agent.id, field.name)
            forgetAgentListing(agent.id)
          }}
        />
      ))}
    </div>
  )
}
