import { Blocks, ListTodo, type LucideProps } from "lucide-react"

/** Each extension's icon by id, for Settings and Project settings; a generic one otherwise. */
export function ExtensionIcon({ id, ...props }: { id: string } & LucideProps) {
  switch (id) {
    case "todos":
      return <ListTodo {...props} />
    default:
      return <Blocks {...props} />
  }
}
