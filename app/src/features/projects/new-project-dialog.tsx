import { useActionState, useState } from "react"

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
import { InstructionsField, submittedInstructions } from "./instructions-field"
import { folderName, uniqueName } from "./names"
import { useProjects } from "./projects-provider"

/** New project: a name, the folders the agents can work in, and optional instructions. */
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

/** A failed create, and which attempt it was: the field remounts with what was typed. */
type Failed = { error: string; instructions: string; attempt: number }

function NewProjectForm({
  onCreated,
}: {
  onCreated: (project: Project) => void
}) {
  const { projects, create } = useProjects()
  const [name, setName] = useState("")
  const [folders, setFolders] = useState<string[]>([])
  // The name and folders are state, since picking a folder names the project; the
  // instructions are an uncontrolled field the action reads from the form. A failed
  // create keeps what was typed, since React resets the form after the action either way.
  const [failed, createProject, creating] = useActionState(
    async (
      previous: Failed | null,
      formData: FormData
    ): Promise<Failed | null> => {
      const instructions = submittedInstructions(formData)
      try {
        onCreated(await create({ name, folders, instructions }))
        return null
      } catch (e) {
        return {
          error: String(e),
          instructions,
          attempt: (previous?.attempt ?? 0) + 1,
        }
      }
    },
    null
  )

  function changeFolders(next: string[]) {
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

  return (
    <form action={createProject} className="flex flex-col gap-6">
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
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Folders</FieldLegend>
          <FolderList folders={folders} onChange={changeFolders} minimum={0} />
        </FieldSet>
        <InstructionsField
          key={failed?.attempt}
          id="new-project-instructions"
          defaultValue={failed?.instructions}
        />
        {failed && <FieldError>{failed.error}</FieldError>}
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
