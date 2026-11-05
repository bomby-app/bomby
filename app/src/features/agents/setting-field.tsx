import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import type { Setting, SettingOption } from "./api"
import { SlidingName } from "./sliding-name"

/** Past this many options a plain list is too long to scan, so it gets a search box. */
const SEARCH_FROM = 12

/**
 * One setting the user can pick for an agent, as the agent lists it: a select, or a
 * searchable list when there are many options (OpenCode lists hundreds of models).
 */
export function SettingField({
  setting,
  placeholder,
  disabled,
  onChange,
}: {
  /** With `current` empty, nothing is chosen yet and `placeholder` shows instead. */
  setting: Setting
  placeholder?: string
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
        placeholder={placeholder}
        disabled={disabled}
        onChange={onChange}
      />
    </Field>
  )
}

type PickerProps = {
  id: string
  setting: Setting
  placeholder?: string
  disabled: boolean
  onChange: (value: string) => void
}

function ListPicker({
  id,
  setting,
  placeholder,
  disabled,
  onChange,
}: PickerProps) {
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
        <SelectValue placeholder={placeholder}>
          {setting.current ? currentName(setting) : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper">
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

/**
 * The setting as a searchable select: shadcn's Combobox with its input inside the popup
 * (ui.shadcn.com/docs/components/radix/combobox#popup, on Base UI's Combobox). Searched by
 * name and value: names repeat across providers, values don't.
 */
function SearchPicker({
  id,
  setting,
  placeholder,
  disabled,
  onChange,
}: PickerProps) {
  const groups = grouped(setting.options)
  const hasGroups = groups.some(([group]) => group !== null)
  return (
    <Combobox
      items={
        hasGroups
          ? groups.map(([group, items]) => ({ value: group ?? "", items }))
          : setting.options
      }
      // Null when the agent's current value isn't among its options.
      value={setting.options.find((o) => o.value === setting.current) ?? null}
      onValueChange={(option: SettingOption | null) => {
        if (option && option.value !== setting.current) onChange(option.value)
      }}
      itemToStringLabel={(option: SettingOption) => option.name}
      isItemEqualToValue={(a: SettingOption, b: SettingOption) =>
        a.value === b.value
      }
      filter={(option: SettingOption, query) =>
        `${option.name} ${option.value}`
          .toLowerCase()
          .includes(query.toLowerCase())
      }
      disabled={disabled}
    >
      <ComboboxTrigger
        id={id}
        render={
          <Button
            variant="outline"
            className="w-full justify-between font-normal"
          />
        }
      >
        {setting.current ? (
          <span className="truncate">{currentName(setting)}</span>
        ) : (
          <span className="truncate text-muted-foreground">{placeholder}</span>
        )}
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxInput
          showTrigger={false}
          placeholder={`Search ${setting.name.toLowerCase()}`}
        />
        <ComboboxEmpty>Nothing matches.</ComboboxEmpty>
        <ComboboxList>
          {hasGroups
            ? (group: { value: string; items: SettingOption[] }) => (
                <ComboboxGroup key={group.value} items={group.items}>
                  {group.value && <ComboboxLabel>{group.value}</ComboboxLabel>}
                  <ComboboxCollection>
                    {(option: SettingOption) => (
                      <OptionItem key={option.value} option={option} />
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
              )
            : (option: SettingOption) => (
                <OptionItem key={option.value} option={option} />
              )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

/** One option, its whole name shown by sliding while it's highlighted (`SlidingName`). */
function OptionItem({ option }: { option: SettingOption }) {
  return (
    <ComboboxItem value={option}>
      <SlidingName name={option.name} />
    </ComboboxItem>
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
