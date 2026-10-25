/**
 * Data types by preset (story 161): `types new data-type <alias> --editor
 * <preset>` names a common editor and its main options as flags, and gets the
 * data type file the back office would have written, with types named by alias.
 */
import { RICH_TEXT_CONFIG } from '@crombolo/data'
import type { SchemaBlock, SchemaDataType } from './model.ts'
import { nameFor } from './scaffold.ts'

/** The options a preset may take, each from a flag of the same name. */
export interface PresetOptions {
  maxChars?: number
  rows?: number
  min?: number
  max?: number
  step?: number
  defaultOn?: boolean
  label?: string
  withTime?: boolean
  option?: string[]
  multiple?: boolean
  allow?: string[]
  block?: string[]
  columns?: number
}

type Option = keyof PresetOptions

interface Preset {
  editor: string
  editorUi: string
  takes: readonly Option[]
  build: (o: PresetOptions) => { config: Record<string, unknown>; blocks?: SchemaBlock[] }
}

const defined = (record: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))

const limit = (o: PresetOptions) =>
  o.min === undefined && o.max === undefined ? undefined : defined({ min: o.min, max: o.max })

const blocks = (o: PresetOptions) => o.block?.map((element) => ({ element }))

export const DATA_TYPE_PRESETS: Readonly<Record<string, Preset>> = {
  textstring: {
    editor: 'Umbraco.TextBox',
    editorUi: 'Umb.PropertyEditorUi.TextBox',
    takes: ['maxChars'],
    build: (o) => ({ config: defined({ maxChars: o.maxChars }) }),
  },
  textarea: {
    editor: 'Umbraco.TextArea',
    editorUi: 'Umb.PropertyEditorUi.TextArea',
    takes: ['rows', 'maxChars'],
    build: (o) => ({ config: defined({ rows: o.rows, maxChars: o.maxChars }) }),
  },
  'rich-text': {
    editor: 'Umbraco.RichText',
    editorUi: 'Umb.PropertyEditorUi.Tiptap',
    takes: ['block'],
    build: (o) => ({ config: structuredClone(RICH_TEXT_CONFIG), blocks: blocks(o) }),
  },
  number: {
    editor: 'Umbraco.Integer',
    editorUi: 'Umb.PropertyEditorUi.Integer',
    takes: ['min', 'max', 'step'],
    build: (o) => ({ config: defined({ min: o.min, max: o.max, step: o.step }) }),
  },
  toggle: {
    editor: 'Umbraco.TrueFalse',
    editorUi: 'Umb.PropertyEditorUi.Toggle',
    takes: ['defaultOn', 'label'],
    build: (o) => ({
      config: defined({
        default: o.defaultOn ? true : undefined,
        showLabels: o.label ? true : undefined,
        labelOn: o.label,
      }),
    }),
  },
  date: {
    editor: 'Umbraco.DateTime',
    editorUi: 'Umb.PropertyEditorUi.DatePicker',
    takes: ['withTime'],
    build: (o) => ({ config: { format: o.withTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD' } }),
  },
  dropdown: {
    editor: 'Umbraco.DropDown.Flexible',
    editorUi: 'Umb.PropertyEditorUi.Dropdown',
    takes: ['option', 'multiple'],
    build: (o) => ({ config: { multiple: o.multiple === true, items: o.option ?? [] } }),
  },
  'content-picker': {
    editor: 'Umbraco.MultiNodeTreePicker',
    editorUi: 'Umb.PropertyEditorUi.ContentPicker',
    takes: ['allow'],
    build: (o) => ({
      config: defined({ startNode: { type: 'content' }, filter: o.allow }),
    }),
  },
  'media-picker': {
    editor: 'Umbraco.MediaPicker3',
    editorUi: 'Umb.PropertyEditorUi.MediaPicker',
    takes: ['allow', 'multiple', 'min', 'max'],
    build: (o) => ({
      config: defined({
        filter: o.allow,
        multiple: o.multiple === true,
        validationLimit: limit(o) ?? (o.multiple ? undefined : { min: 0, max: 1 }),
      }),
    }),
  },
  'element-picker': {
    editor: 'Umbraco.ElementPicker',
    editorUi: 'Umb.PropertyEditorUi.ElementPicker',
    takes: ['allow'],
    build: (o) => ({ config: defined({ allowedContentTypes: o.allow }) }),
  },
  'block-list': {
    editor: 'Umbraco.BlockList',
    editorUi: 'Umb.PropertyEditorUi.BlockList',
    takes: ['block', 'min', 'max'],
    build: (o) => ({ config: defined({ validationLimit: limit(o) }), blocks: blocks(o) }),
  },
  'block-grid': {
    editor: 'Umbraco.BlockGrid',
    editorUi: 'Umb.PropertyEditorUi.BlockGrid',
    takes: ['block', 'columns'],
    build: (o) => ({ config: { gridColumns: o.columns ?? 12 }, blocks: blocks(o) }),
  },
}

/** `maxChars` → `--max-chars`, for naming a flag in a refusal. */
export const optionFlag = (option: string): string =>
  `--${option.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

/** Every option some preset takes, for the command's flags. */
export const PRESET_OPTIONS: readonly Option[] = [
  ...new Set(Object.values(DATA_TYPE_PRESETS).flatMap((p) => p.takes)),
]

export type PresetResult = { ok: true; dataType: SchemaDataType } | { ok: false; reason: string }

/** The data type a preset and its options describe, or why it cannot be built. */
export function presetDataType(
  alias: string,
  preset: string,
  options: PresetOptions = {},
  name?: string,
): PresetResult {
  const chosen = DATA_TYPE_PRESETS[preset]
  if (!chosen)
    return {
      ok: false,
      reason: `unknown editor "${preset}"; one of ${Object.keys(DATA_TYPE_PRESETS).join(', ')}`,
    }
  const extra = (Object.keys(options) as Option[]).filter(
    (option) => options[option] !== undefined && !chosen.takes.includes(option),
  )
  if (extra.length > 0)
    return {
      ok: false,
      reason: `${preset} does not take ${extra.map(optionFlag).join(', ')}`,
    }
  const { config, blocks } = chosen.build(options)
  return {
    ok: true,
    dataType: {
      alias,
      name: name ?? nameFor(alias),
      editor: chosen.editor,
      editorUi: chosen.editorUi,
      config,
      ...(blocks && blocks.length > 0 ? { blocks } : {}),
    },
  }
}
