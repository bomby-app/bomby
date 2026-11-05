import { Check, ChevronsUpDown } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import type { Setting, SettingOption } from "./api"

/** Past this many options a plain list is too long to scan, so it gets a search box. */
const SEARCH_FROM = 12

/**
 * One setting an agent offers in its setup flow, as the agent lists it: a select, or a
 * searchable list when there are many options (OpenCode lists hundreds of models).
 */
export function SettingField({
  setting,
  disabled,
  onChange,
}: {
  setting: Setting
  disabled: boolean
  onChange: (value: string) => void
}) {
  const id = `setting-${setting.id}`
  const Picker =
    setting.options.length > SEARCH_FROM ? SearchPicker : ListPicker
  return (
    <Field>
      <FieldLabel htmlFor={id}>{setting.name}</FieldLabel>
      <Picker
        id={id}
        setting={setting}
        disabled={disabled}
        onChange={onChange}
      />
    </Field>
  )
}

type PickerProps = {
  id: string
  setting: Setting
  disabled: boolean
  onChange: (value: string) => void
}

function ListPicker({ id, setting, disabled, onChange }: PickerProps) {
  return (
    <Select
      value={setting.current}
      disabled={disabled}
      onValueChange={(value) => {
        if (value !== setting.current) onChange(value)
      }}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        {grouped(setting.options).map(([group, options]) => (
          <SelectGroup key={group ?? ""}>
            {group && <SelectLabel>{group}</SelectLabel>}
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

function SearchPicker({ id, setting, disabled, onChange }: PickerProps) {
  const [open, setOpen] = useState(false)
  const current = setting.options.find((o) => o.value === setting.current)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{current?.name ?? setting.current}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={`Search ${setting.name.toLowerCase()}`} />
          <CommandList className="max-h-72">
            <CommandEmpty>Nothing matches.</CommandEmpty>
            {grouped(setting.options).map(([group, options]) => (
              <CommandGroup key={group ?? ""} heading={group ?? undefined}>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    // Searched by both: names repeat across providers, values don't.
                    value={`${option.name} ${option.value}`}
                    onSelect={() => {
                      setOpen(false)
                      if (option.value !== setting.current)
                        onChange(option.value)
                    }}
                  >
                    <Check
                      className={cn(
                        option.value === setting.current
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    <span className="truncate">{option.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** The options by the agent's own groups, in its order; ungrouped ones under null. */
function grouped(options: SettingOption[]): [string | null, SettingOption[]][] {
  const groups = new Map<string | null, SettingOption[]>()
  for (const option of options) {
    const group = groups.get(option.group) ?? []
    group.push(option)
    groups.set(option.group, group)
  }
  return [...groups]
}
