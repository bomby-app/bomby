import { Trash2 } from "lucide-react"
import { useActionState, useRef, useState } from "react"

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
import { InstructionsField, submittedInstructions } from "./instructions-field"
import { useProjects } from "./projects-provider"

/**
 * A project's settings, opened from the header: its name, its folders, its instructions,
 * and delete. The name and folders are saved as they change; the instructions with Save.
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
      <DialogContent className="sm:max-w-lg">
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
            await remove(project.id)
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
              : "Save"}
        </Button>
      </DialogFooter>
    </>
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
