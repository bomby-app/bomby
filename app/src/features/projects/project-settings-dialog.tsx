import { Trash2 } from "lucide-react"
import { type KeyboardEvent, useRef, useState } from "react"
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
import { Input } from "@/components/ui/input"
import type { Project } from "./api"
import { FolderList } from "./folder-list"
import { useProjects } from "./projects-provider"

/**
 * A project's settings, opened from the header: its name, its folders, and delete. Each
 * change is saved as it is made.
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

  // The project as this dialog last changed it. Each save sends the whole draft, and saves
  // run one after another, so a rename followed quickly by a folder change can't write the
  // old name back (the prop only catches up once the core has answered).
  const draft = useRef({ ...project })
  const saving = useRef<Promise<unknown>>(Promise.resolve())

  function save(changes: Partial<Pick<Project, "name" | "folders">>) {
    setError(null)
    const base = draft.current.id === project.id ? draft.current : project
    draft.current = { ...base, ...changes }
    const { name, folders } = draft.current
    const done = saving.current.then(() =>
      update(project.id, { name, folders }).then(
        () => true,
        (e: unknown) => {
          // Back to what the core has, so the next save doesn't resend the failed change.
          draft.current = { ...project }
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
            Changes are saved as you make them.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          {/* Remount on outside changes so the field shows the saved name. */}
          <NameField key={project.name} name={project.name} onSave={save} />

          <FieldSet>
            <FieldLegend variant="label">Folders</FieldLegend>
            <FieldDescription>
              Claude works in the first one and can reach the rest.
            </FieldDescription>
            <FolderList
              folders={project.folders}
              onChange={(folders) => void save({ folders })}
            />
          </FieldSet>

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
  const [draft, setDraft] = useState(name)

  async function commit() {
    if (draft.trim() === name) return setDraft(name)
    if (!(await onSave({ name: draft }))) setDraft(name)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur()
    if (event.key === "Escape") {
      // Keep Esc from reaching anything else while editing.
      event.preventDefault()
      setDraft(name)
      event.currentTarget.blur()
    }
  }

  return (
    <Field>
      <FieldLabel htmlFor="project-name">Name</FieldLabel>
      <Input
        id="project-name"
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
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
