import { Phone, Trash2 } from "lucide-react"
import { type KeyboardEvent, useState } from "react"

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

/** A project in the main panel: its name, its folders, the call, and delete. */
export function ProjectView({
  project,
  onDeleted,
}: {
  project: Project
  onDeleted: () => void
}) {
  const { update, remove } = useProjects()
  const [error, setError] = useState<string | null>(null)

  async function save(changes: Partial<Pick<Project, "name" | "folders">>) {
    setError(null)
    try {
      await update(project.id, {
        name: changes.name ?? project.name,
        folders: changes.folders ?? project.folders,
      })
      return true
    } catch (e) {
      setError(String(e))
      return false
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-10 px-6 py-8">
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

      <Field>
        <div>
          <Button disabled>
            <Phone />
            Start a call
          </Button>
        </div>
        <FieldDescription>Calls arrive in the next build.</FieldDescription>
      </Field>

      <DeleteProject
        name={project.name}
        onConfirm={async () => {
          await remove(project.id)
          onDeleted()
        }}
      />
    </div>
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
        <AlertDialogTrigger render={<Button variant="destructive" />}>
          <Trash2 />
          Delete project
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
