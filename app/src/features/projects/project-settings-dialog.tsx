import { Trash2 } from "lucide-react"
import { type ComponentType, useActionState, useRef, useState } from "react"

import { InlineEditInput } from "@/components/inline-edit-input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { ProjectExtensionsField } from "@/features/extensions/project-extensions-field"

import type {
  Project,
  ProjectAgents,
  ProjectExtensions,
  ProjectInput,
} from "./api"
import { FolderList } from "./folder-list"
import { InstructionsField, submittedInstructions } from "./instructions-field"
import { ProjectAgentsField } from "./project-agents-field"
import { useProjects } from "./projects-provider"

/**
 * A project's settings, opened from the header: its name, its folders, its agents, its
 * extensions, its instructions, and delete. All but the instructions are saved as they
 * change; the instructions with Save.
 */
export function ProjectSettingsDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Taller than a short window with folders, agents and instructions: it scrolls,
        // like the splash's keys dialog.
        className="max-h-[85vh] [scrollbar-width:none] overflow-y-auto sm:max-w-lg [&::-webkit-scrollbar]:hidden"
      >
        {/* Its content mounts with each opening, so it starts from what's saved. */}
        <ProjectSettings
          project={project}
          onClose={() => onOpenChange(false)}
          onDeleted={onDeleted}
        />
      </DialogContent>
    </Dialog>
  )
}

const INSTRUCTIONS_FORM = "project-instructions-form"

/** The last save, and how many there were: the field remounts after each one. */
type InstructionsResult =
  | { status: "idle" | "saved"; attempts: number }
  /** What was typed, kept in the field to try again. */
  | { status: "failed"; attempts: number; text: string }

function ProjectSettings({
  project,
  onClose,
  onDeleted,
}: {
  project: Project
  onClose: () => void
  onDeleted: () => void
}) {
  const { update, setAgents, setExtensions, remove } = useProjects()
  const [error, setError] = useState<string | null>(null)

  // Each save sends the whole draft and saves run one after another, so a rename followed
  // quickly by a folder change can't write the old name back (the prop only catches up
  // once the core has answered). `stored` is what the core last confirmed: a failed save
  // falls back to it, never to the prop, which may still predate an earlier save.
  const draft = useRef(project)
  const stored = useRef(project)
  const saving = useRef<Promise<unknown>>(Promise.resolve())

  function save(changes: Partial<ProjectInput>) {
    setError(null)
    if (draft.current.id !== project.id) {
      draft.current = project
      stored.current = project
    }
    draft.current = { ...draft.current, ...changes }
    const { name, folders, instructions } = draft.current
    const done = saving.current.then(() =>
      update(project.id, { name, folders, instructions }).then(
        (confirmed) => {
          stored.current = confirmed
          return true
        },
        (e: unknown) => {
          draft.current = stored.current
          setError(String(e))
          return false
        }
      )
    )
    saving.current = done
    return done
  }

  // The instructions field is uncontrolled: the form's action reads it, and the field
  // remounts after each save with what was saved, or what was typed if it failed. Only
  // whether it changed is state.
  const [edited, setEdited] = useState(false)
  const [result, saveInstructions, savingInstructions] = useActionState(
    async (
      previous: InstructionsResult,
      formData: FormData
    ): Promise<InstructionsResult> => {
      const text = submittedInstructions(formData)
      const attempts = previous.attempts + 1
      if (!(await save({ instructions: text })))
        return { status: "failed", attempts, text }
      setEdited(false)
      return { status: "saved", attempts }
    },
    { status: "idle", attempts: 0 }
  )

  return (
    <>
      <DialogHeader>
        <DialogTitle>Project settings</DialogTitle>
        <DialogDescription>
          Changes save as you make them. Instructions save with Save.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        {/* Remount on outside changes so the field shows the saved name. */}
        <NameField key={project.name} name={project.name} onSave={save} />

        <FieldSet>
          <FieldLegend variant="label">Folders</FieldLegend>
          <FieldDescription>
            Agents work in the first one and can reach the rest.
          </FieldDescription>
          <FolderList
            folders={project.folders}
            onChange={(folders) => void save({ folders })}
          />
        </FieldSet>

        <QueuedField
          key={`agents ${project.id}`}
          saved={project.agents}
          save={(agents) => setAgents(project.id, agents)}
          onError={setError}
          Field={AgentsCard}
        />

        <QueuedField
          key={`extensions ${project.id}`}
          saved={project.extensions}
          save={(extensions) => setExtensions(project.id, extensions)}
          onError={setError}
          Field={ExtensionsCard}
        />

        <form id={INSTRUCTIONS_FORM} action={saveInstructions}>
          <InstructionsField
            key={`${project.instructions}:${result.attempts}`}
            id="project-instructions"
            defaultValue={
              result.status === "failed" ? result.text : project.instructions
            }
            // Nothing typed while saving can be lost when the saved text comes back.
            disabled={savingInstructions}
            onInput={() => setEdited(true)}
          />
        </form>

        {error && <FieldError>{error}</FieldError>}
      </FieldGroup>

      <DialogFooter className="sm:justify-between">
        <DeleteProject
          name={project.name}
          onConfirm={async () => {
            setError(null)
            try {
              await remove(project.id)
            } catch (e) {
              setError(String(e))
              return
            }
            onClose()
            onDeleted()
          }}
        />
        <Button
          type="submit"
          form={INSTRUCTIONS_FORM}
          variant="highlighter"
          disabled={savingInstructions || !edited}
        >
          {savingInstructions
            ? "Saving..."
            : result.status === "saved" && !edited
              ? "Saved"
              : "Save instructions"}
        </Button>
      </DialogFooter>
    </>
  )
}

/**
 * A setting of the project saved as it changes (its agents, its extensions), one save
 * after another in click order. A failed save puts back the last value the core took,
 * unless a newer change is on its way.
 */
function QueuedField<T>({
  saved,
  save,
  onError,
  Field,
}: {
  saved: T
  save: (value: T) => Promise<unknown>
  onError: (error: string | null) => void
  Field: ComponentType<{ value: T; onChange: (next: T) => void }>
}) {
  const [value, setValue] = useState(saved)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  // The last value the core took, and the newest change, so a failure rolls back to the
  // first and never over the second.
  const confirmed = useRef(saved)
  const latest = useRef(0)

  function change(next: T) {
    onError(null)
    setValue(next)
    const id = ++latest.current
    queue.current = queue.current.then(() =>
      save(next).then(
        () => {
          confirmed.current = next
        },
        (e: unknown) => {
          if (id === latest.current) setValue(confirmed.current)
          onError(String(e))
        }
      )
    )
  }

  return <Field value={value} onChange={change} />
}

function AgentsCard({
  value,
  onChange,
}: {
  value: ProjectAgents
  onChange: (agents: ProjectAgents) => void
}) {
  return <ProjectAgentsField agents={value} onChange={onChange} />
}

function ExtensionsCard({
  value,
  onChange,
}: {
  value: ProjectExtensions
  onChange: (extensions: ProjectExtensions) => void
}) {
  return <ProjectExtensionsField extensions={value} onChange={onChange} />
}

/** The project's name; saves on Enter or when the field loses focus, Esc puts it back. */
function NameField({
  name,
  onSave,
}: {
  name: string
  onSave: (changes: { name: string }) => Promise<boolean>
}) {
  return (
    <Field>
      <FieldLabel htmlFor="project-name">Name</FieldLabel>
      <InlineEditInput
        id="project-name"
        value={name}
        spellCheck={false}
        autoComplete="off"
        onSave={(next) => onSave({ name: next })}
      />
    </Field>
  )
}

function DeleteProject({
  name,
  onConfirm,
}: {
  name: string
  onConfirm: () => Promise<void>
}) {
  return (
    <AlertDialog>
      <div>
        <AlertDialogTrigger asChild>
          <Button variant="destructive">
            <Trash2 />
            Delete project
          </Button>
        </AlertDialogTrigger>
      </div>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its calls and transcripts go with it. The folders on your disk stay
            as they are.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void onConfirm()}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
