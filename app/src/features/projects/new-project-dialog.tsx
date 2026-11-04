import { type FormEvent, useState } from "react"

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
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import type { Project } from "./api"
import { FolderList } from "./folder-list"
import { folderName, uniqueName } from "./names"
import { useProjects } from "./projects-provider"

/** New project: a name and the folders the agents can work in. */
export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (project: Project) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so every opening starts empty. */}
        {open && (
          <NewProjectForm
            onCreated={(project) => {
              onOpenChange(false)
              onCreated(project)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function NewProjectForm({
  onCreated,
}: {
  onCreated: (project: Project) => void
}) {
  const { projects, create } = useProjects()
  const [name, setName] = useState("")
  const [folders, setFolders] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  function changeFolders(next: string[]) {
    setError(null)
    // Name it after the first folder, unless a name was typed.
    if (!name.trim() && next[0]) {
      setName(
        uniqueName(
          folderName(next[0]),
          (projects ?? []).map((p) => p.name)
        )
      )
    }
    setFolders(next)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setCreating(true)
    setError(null)
    try {
      onCreated(await create({ name, folders }))
    } catch (e) {
      setError(String(e))
      setCreating(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          A name and the folders your agents can work in.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="new-project-name">Name</FieldLabel>
          <Input
            id="new-project-name"
            value={name}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
          />
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Folders</FieldLegend>
          <FolderList folders={folders} onChange={changeFolders} minimum={0} />
        </FieldSet>
        {error && <FieldError>{error}</FieldError>}
      </FieldGroup>

      <DialogFooter>
        <Button
          type="submit"
          disabled={creating || !name.trim() || folders.length === 0}
        >
          {creating ? "Creating..." : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  )
}
