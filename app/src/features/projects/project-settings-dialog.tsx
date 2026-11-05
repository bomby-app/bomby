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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>
            The name and folders are saved as you change them.
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

          {/* Remounted the same way, for the saved instructions. */}
          <InstructionsSetting
            key={`${project.id}:${project.instructions}`}
            instructions={project.instructions}
            onSave={save}
          />

          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>

        <DialogFooter className="sm:justify-start">
          <DeleteProject
            name={project.name}
            onConfirm={async () => {
              await remove(project.id)
              onOpenChange(false)
              onDeleted()
            }}
          />
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
 * The project's instructions, saved with their own button: they're long enough to edit for
 * a while, and the dialog can close (Esc, a click outside) at any moment.
 */
function InstructionsSetting({
  instructions,
  onSave,
}: {
  instructions: string
  onSave: (changes: { instructions: string }) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(instructions)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    // Saved, it remounts with the new instructions; failed, the draft stays to try again.
    await onSave({ instructions: draft })
    setSaving(false)
  }

  return (
    <div className="flex flex-col gap-3">
      <InstructionsField
        id="project-instructions"
        value={draft}
        onChange={setDraft}
      />
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        disabled={saving || draft.trim() === instructions}
        onClick={() => void save()}
      >
        {saving ? "Saving..." : "Save instructions"}
      </Button>
    </div>
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
