/**
 * The editors the back office offers (story 357), from the table
 * `bun run editors:table` generates from its manifests: each editor's UI, the
 * settings each has, and what the data type editor fills in for a new data type.
 */
import { EDITOR_SCHEMAS, EDITOR_UIS } from './editors.gen.ts'

export { EDITOR_SCHEMAS, EDITOR_UIS }

export interface EditorSchemaEntry {
  name: string
  defaultUi: string | null
  /** Each setting's alias, and the editor UI that edits it. */
  settings: Readonly<Record<string, string>>
  defaultData: Readonly<Record<string, unknown>>
}

export interface EditorUiEntry {
  label: string
  schema: string
  settings: Readonly<Record<string, string>>
  defaultData: Readonly<Record<string, unknown>>
}

/** Every setting the data type editor shows for this editor and UI. */
export function editorSettings(editor: string, ui: string | undefined): Set<string> {
  return new Set([
    ...Object.keys(EDITOR_SCHEMAS[editor]?.settings ?? {}),
    ...Object.keys((ui && EDITOR_UIS[ui]?.settings) || {}),
  ])
}

/** The values the data type editor gives a new data type of this editor and UI: the UI's over the schema's. */
export function editorDefaults(editor: string, ui: string | undefined): Record<string, unknown> {
  const shown = editorSettings(editor, ui)
  const data = { ...EDITOR_SCHEMAS[editor]?.defaultData, ...(ui && EDITOR_UIS[ui]?.defaultData) }
  return structuredClone(Object.fromEntries(Object.entries(data).filter(([key]) => shown.has(key))))
}

const distance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] as number
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const held = row[j] as number
      row[j] = Math.min(
        (row[j] as number) + 1,
        (row[j - 1] as number) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      previous = held
    }
  }
  return row[b.length] as number
}

/** The names among `names` closest to `wanted`, closest first, in their order where as close. */
export function closestNames(wanted: string, names: readonly string[], most = 3): string[] {
  const plain = (name: string) =>
    name
      .toLowerCase()
      .replace(/^(umbraco|umb)\.(propertyeditorui\.)?/, '')
      .replace(/[^a-z0-9]/g, '')
  const target = plain(wanted)
  return [...names]
    .map((name) => {
      const other = plain(name)
      return {
        name,
        score: other.includes(target)
          ? 0
          : Math.min(distance(target, other), distance(target, other.slice(0, target.length))),
      }
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, most)
    .map((item) => item.name)
}
