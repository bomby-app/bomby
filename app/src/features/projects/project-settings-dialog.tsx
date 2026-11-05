import { Trash2 } from "lucide-react"
import { useRef, useState } from "react"

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

import type { Project, ProjectInput } from "./api"
import { FolderList } from "./folder-list"
import { InstructionsField } from "./instructions-field"
import { useProjects } from "./projects-provider"

/**
 * A project's settings, opened from the header: its name, its folders, its instructions,
 * and delete. Each change is saved as it is made.
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
  const { update, remove } = useProjects()
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

  const instructions = useInstructionsDraft(project, save)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing drops what wasn't saved.
        if (!next) instructions.reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>
            The name and folders are saved as you change them; the instructions
            when you save.
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

          <InstructionsField
            id="project-instructions"
            value={instructions.value}
            onChange={instructions.change}
          />

          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>

        <DialogFooter className="sm:justify-between">
          <DeleteProject
            name={project.name}
            onConfirm={async () => {
              await remove(project.id)
              onOpenChange(false)
              onDeleted()
            }}
          />
          <Button
            variant="highlighter"
            disabled={!instructions.changed || instructions.saving}
            onClick={() => void instructions.save()}
          >
            {instructions.saving
              ? "Saving..."
              : instructions.saved
                ? "Saved"
                : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
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

/**
 * The instructions as they're being edited, saved with the dialog's Save button: they're
 * long enough to edit for a while, and the dialog can close at any moment. The draft starts
 * over when another project is shown or the saved instructions change.
 */
function useInstructionsDraft(
  project: Project,
  save: (changes: { instructions: string }) => Promise<boolean>
) {
  const [value, setValue] = useState(project.instructions)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [shown, setShown] = useState(`${project.id}:${project.instructions}`)

  const current = `${project.id}:${project.instructions}`
  if (current !== shown) {
    setShown(current)
    setValue(project.instructions)
  }

  return {
    value,
    saving,
    saved,
    changed: value.trim() !== project.instructions,
    change: (next: string) => {
      setValue(next)
      setSaved(false)
    },
    reset: () => {
      setValue(project.instructions)
      setSaved(false)
    },
    save: async () => {
      setSaving(true)
      // A failed save keeps the draft to try again; the dialog shows the error.
      setSaved(await save({ instructions: value }))
      setSaving(false)
    },
  }
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
