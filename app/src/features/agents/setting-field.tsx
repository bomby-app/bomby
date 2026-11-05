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
 * One setting the user can pick for an agent, as the agent lists it: a select, or a
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
  // A select can't hold an empty value, which ACP allows, so such a setting gets the searchable list.
  const Picker =
    setting.options.length > SEARCH_FROM ||
    setting.options.some((o) => o.value === "")
      ? SearchPicker
      : ListPicker
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
        {/* The agent's current value, even one it doesn't list as an option. */}
        <SelectValue>{currentName(setting)}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        {grouped(setting.options).map(([group, options], index) => (
          // By place: a group named "" may sit next to the ungrouped options.
          <SelectGroup key={index}>
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
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{currentName(setting)}</span>
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
            {grouped(setting.options).map(([group, options], index) => (
              <CommandGroup key={index} heading={group ?? undefined}>
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

/** The current value's name, or the value itself when the agent doesn't list it. */
function currentName(setting: Setting): string {
  return (
    setting.options.find((o) => o.value === setting.current)?.name ??
    setting.current
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
