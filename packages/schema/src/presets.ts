/**
 * Data types by preset (story 161): `types new data-type <alias> --editor
 * <preset>` names an editor and its main options as flags, and gets the data
 * type file the back office would have written, with types named by alias. Every
 * editor the back office offers has one (story 357), and starts from the values
 * its data type editor fills in.
 */
import { RICH_TEXT_CONFIG } from '@crombolo/data'
import { closestNames, EDITOR_SCHEMAS, EDITOR_UIS, editorDefaults } from './editors.ts'
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
  of?: string
  group?: string
  color?: string[]
  alpha?: boolean
  palette?: boolean
  range?: boolean
  extension?: string[]
  crop?: string[]
  preview?: boolean
  language?: string
  valueType?: string
}

type Option = keyof PresetOptions

type Built = { config: Record<string, unknown>; blocks?: SchemaBlock[] }

export interface Preset {
  editor: string
  editorUi: string
  takes: readonly Option[]
  /** Options that take whole numbers only. */
  whole?: readonly Option[]
  /** The config and blocks its options give, or why they cannot be given. */
  build: (o: PresetOptions) => Built | string
}

const defined = (record: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))

const limit = (o: PresetOptions) =>
  o.min === undefined && o.max === undefined ? undefined : defined({ min: o.min, max: o.max })

const blocks = (o: PresetOptions) => o.block?.map((element) => ({ element }))

const ui = (name: string) => `Umb.PropertyEditorUi.${name}`

const plain = (build: (o: PresetOptions) => Record<string, unknown> = () => ({})) => ({
  build: (o: PresetOptions) => ({ config: build(o) }),
})

const START_NODE_TYPES: Readonly<Record<string, string>> = {
  pages: 'content',
  media: 'media',
  members: 'member',
}

const CODE_LANGUAGES = [
  'csharp',
  'css',
  'html',
  'javascript',
  'json',
  'markdown',
  'razor',
  'typescript',
]

const LABEL_VALUE_TYPES: Readonly<Record<string, string>> = {
  string: 'STRING',
  'long-string': 'TEXT',
  decimal: 'DECIMAL',
  integer: 'INT',
  'big-integer': 'BIGINT',
  date: 'DATETIME',
  time: 'TIME',
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** `#1b264f=Primary` as a swatch; its label is its value when none is given. */
function swatches(colors: readonly string[]): Array<{ value: string; label: string }> | string {
  const out: Array<{ value: string; label: string }> = []
  for (const color of colors) {
    const [hex = '', ...rest] = color.split('=')
    if (!HEX.test(hex.trim()))
      return `--color wants a hex colour, as #1b264f or #1b264f=Primary, not "${color}"`
    const value = `#${hex.trim().replace(/^#/, '').toLowerCase()}`
    out.push({ value, label: rest.join('=').trim() || value })
  }
  return out
}

/** `thumb:200x100` as a crop. */
function crops(given: readonly string[]) {
  const out: Array<{ label: string; alias: string; width: number; height: number }> = []
  for (const crop of given) {
    const match = /^([A-Za-z][\w-]*):(\d+)x(\d+)$/.exec(crop.trim())
    if (!match) return `--crop wants <alias>:<width>x<height>, as thumb:200x100, not "${crop}"`
    const [, alias = '', width, height] = match
    out.push({ label: nameFor(alias), alias, width: Number(width), height: Number(height) })
  }
  return out
}

const oneOf = (flag: string, value: string, choices: readonly string[]) =>
  `${flag} is one of ${choices.join(', ')}, not "${value}"`

export const DATA_TYPE_PRESETS: Readonly<Record<string, Preset>> = {
  textstring: {
    editor: 'Umbraco.TextBox',
    editorUi: ui('TextBox'),
    takes: ['maxChars'],
    whole: ['maxChars'],
    ...plain((o) => defined({ maxChars: o.maxChars })),
  },
  textarea: {
    editor: 'Umbraco.TextArea',
    editorUi: ui('TextArea'),
    takes: ['rows', 'maxChars'],
    whole: ['rows', 'maxChars'],
    ...plain((o) => defined({ rows: o.rows, maxChars: o.maxChars })),
  },
  'rich-text': {
    editor: 'Umbraco.RichText',
    editorUi: ui('Tiptap'),
    takes: ['block'],
    build: (o) => ({ config: structuredClone(RICH_TEXT_CONFIG), blocks: blocks(o) }),
  },
  markdown: {
    editor: 'Umbraco.MarkdownEditor',
    editorUi: ui('MarkdownEditor'),
    takes: ['preview'],
    ...plain((o) => defined({ preview: o.preview })),
  },
  code: {
    editor: 'Umbraco.Plain.String',
    editorUi: ui('CodeEditor'),
    takes: ['language'],
    build: (o) =>
      o.language !== undefined && !CODE_LANGUAGES.includes(o.language)
        ? oneOf('--language', o.language, CODE_LANGUAGES)
        : { config: defined({ language: o.language }) },
  },
  email: { editor: 'Umbraco.EmailAddress', editorUi: ui('EmailAddress'), takes: [], ...plain() },
  number: {
    editor: 'Umbraco.Integer',
    editorUi: ui('Integer'),
    takes: ['min', 'max', 'step'],
    whole: ['min', 'max', 'step'],
    ...plain((o) => defined({ min: o.min, max: o.max, step: o.step })),
  },
  decimal: {
    editor: 'Umbraco.Decimal',
    editorUi: ui('Decimal'),
    takes: ['min', 'max', 'step'],
    ...plain((o) => defined({ min: o.min, max: o.max, step: o.step })),
  },
  slider: {
    editor: 'Umbraco.Slider',
    editorUi: ui('Slider'),
    takes: ['min', 'max', 'step', 'range'],
    ...plain((o) => defined({ minVal: o.min, maxVal: o.max, step: o.step, enableRange: o.range })),
  },
  toggle: {
    editor: 'Umbraco.TrueFalse',
    editorUi: ui('Toggle'),
    takes: ['defaultOn', 'label'],
    ...plain((o) =>
      defined({
        default: o.defaultOn ? true : undefined,
        showLabels: o.label ? true : undefined,
        labelOn: o.label,
      }),
    ),
  },
  date: {
    editor: 'Umbraco.DateTime',
    editorUi: ui('DatePicker'),
    takes: ['withTime'],
    ...plain((o) => ({ format: o.withTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD' })),
  },
  'date-with-zone': {
    editor: 'Umbraco.DateTimeWithTimeZone',
    editorUi: ui('DateTimeWithTimeZonePicker'),
    takes: [],
    ...plain(),
  },
  'date-only': {
    editor: 'Umbraco.DateOnly',
    editorUi: ui('DateOnlyPicker'),
    takes: [],
    ...plain(),
  },
  'time-only': {
    editor: 'Umbraco.TimeOnly',
    editorUi: ui('TimeOnlyPicker'),
    takes: [],
    ...plain(),
  },
  'date-time': {
    editor: 'Umbraco.DateTimeUnspecified',
    editorUi: ui('DateTimePicker'),
    takes: [],
    ...plain(),
  },
  dropdown: {
    editor: 'Umbraco.DropDown.Flexible',
    editorUi: ui('Dropdown'),
    takes: ['option', 'multiple'],
    ...plain((o) => ({ multiple: o.multiple === true, items: o.option ?? [] })),
  },
  'checkbox-list': {
    editor: 'Umbraco.CheckBoxList',
    editorUi: ui('CheckBoxList'),
    takes: ['option'],
    ...plain((o) => defined({ items: o.option })),
  },
  'radio-list': {
    editor: 'Umbraco.RadioButtonList',
    editorUi: ui('RadioButtonList'),
    takes: ['option'],
    ...plain((o) => defined({ items: o.option })),
  },
  tags: {
    editor: 'Umbraco.Tags',
    editorUi: ui('Tags'),
    takes: ['group'],
    ...plain((o) => defined({ group: o.group })),
  },
  'multiple-text': {
    editor: 'Umbraco.MultipleTextstring',
    editorUi: ui('MultipleTextString'),
    takes: ['min', 'max'],
    whole: ['min', 'max'],
    ...plain((o) => defined({ min: o.min, max: o.max })),
  },
  'color-picker': {
    editor: 'Umbraco.ColorPicker',
    editorUi: ui('ColorPicker'),
    takes: ['color'],
    build: (o) => {
      if (!o.color) return { config: {} }
      const items = swatches(o.color)
      if (typeof items === 'string') return items
      const labelled = o.color.some((color) => color.includes('='))
      return { config: { items, ...(labelled ? { useLabel: true } : {}) } }
    },
  },
  'eye-dropper': {
    editor: 'Umbraco.ColorPicker.EyeDropper',
    editorUi: ui('EyeDropper'),
    takes: ['alpha', 'palette'],
    ...plain((o) => defined({ showAlpha: o.alpha, showPalette: o.palette })),
  },
  'content-picker': {
    editor: 'Umbraco.MultiNodeTreePicker',
    editorUi: ui('ContentPicker'),
    takes: ['allow', 'of'],
    build: (o) => {
      const type = START_NODE_TYPES[o.of ?? 'pages']
      if (!type) return oneOf('--of', String(o.of), Object.keys(START_NODE_TYPES))
      return { config: defined({ startNode: { type }, filter: o.allow }) }
    },
  },
  'document-picker': {
    editor: 'Umbraco.ContentPicker',
    editorUi: ui('DocumentPicker'),
    takes: ['allow'],
    ...plain((o) => defined({ allowedContentTypes: o.allow })),
  },
  'media-picker': {
    editor: 'Umbraco.MediaPicker3',
    editorUi: ui('MediaPicker'),
    takes: ['allow', 'multiple', 'min', 'max'],
    whole: ['min', 'max'],
    ...plain((o) =>
      defined({
        filter: o.allow,
        multiple: o.multiple === true,
        validationLimit: limit(o) ?? (o.multiple ? undefined : { min: 0, max: 1 }),
      }),
    ),
  },
  'member-picker': {
    editor: 'Umbraco.MemberPicker',
    editorUi: ui('MemberPicker'),
    takes: [],
    ...plain(),
  },
  'member-group-picker': {
    editor: 'Umbraco.MemberGroupPicker',
    editorUi: ui('MemberGroupPicker'),
    takes: [],
    ...plain(),
  },
  'user-picker': {
    editor: 'Umbraco.UserPicker',
    editorUi: ui('UserPicker'),
    takes: [],
    ...plain(),
  },
  // Its settings name the source the site's code adds, so they are given with --set.
  'entity-data-picker': {
    editor: 'Umbraco.EntityDataPicker',
    editorUi: ui('EntityDataPicker'),
    takes: [],
    ...plain(),
  },
  'multi-url-picker': {
    editor: 'Umbraco.MultiUrlPicker',
    editorUi: ui('MultiUrlPicker'),
    takes: ['min', 'max'],
    whole: ['min', 'max'],
    ...plain((o) => defined({ minNumber: o.min, maxNumber: o.max })),
  },
  'element-picker': {
    editor: 'Umbraco.ElementPicker',
    editorUi: ui('ElementPicker'),
    takes: ['allow'],
    ...plain((o) => defined({ allowedContentTypes: o.allow })),
  },
  upload: {
    editor: 'Umbraco.UploadField',
    editorUi: ui('UploadField'),
    takes: ['extension'],
    ...plain((o) =>
      defined({ fileExtensions: o.extension?.map((ext) => ext.trim().replace(/^\./, '')) }),
    ),
  },
  'image-cropper': {
    editor: 'Umbraco.ImageCropper',
    editorUi: ui('ImageCropper'),
    takes: ['crop'],
    build: (o) => {
      if (!o.crop) return { config: {} }
      const list = crops(o.crop)
      return typeof list === 'string' ? list : { config: { crops: list } }
    },
  },
  label: {
    editor: 'Umbraco.Label',
    editorUi: ui('Label'),
    takes: ['valueType'],
    build: (o) => {
      const type = LABEL_VALUE_TYPES[o.valueType ?? 'string']
      if (!type) return oneOf('--value-type', String(o.valueType), Object.keys(LABEL_VALUE_TYPES))
      return { config: { umbracoDataValueType: type } }
    },
  },
  'block-list': {
    editor: 'Umbraco.BlockList',
    editorUi: ui('BlockList'),
    takes: ['block', 'min', 'max'],
    whole: ['min', 'max'],
    build: (o) => ({ config: defined({ validationLimit: limit(o) }), blocks: blocks(o) }),
  },
  // One block: a page's one hero or call to action (story 345).
  'single-block': {
    editor: 'Umbraco.SingleBlock',
    editorUi: ui('BlockSingle'),
    takes: ['block'],
    build: (o) => ({ config: {}, blocks: blocks(o) }),
  },
  'block-grid': {
    editor: 'Umbraco.BlockGrid',
    editorUi: ui('BlockGrid'),
    takes: ['block', 'columns'],
    whole: ['columns'],
    build: (o) => ({ config: { gridColumns: o.columns ?? 12 }, blocks: blocks(o) }),
  },
  // What a content or media type shows its children in (`--list-view-type`).
  'list-view': {
    editor: 'Umbraco.ListView',
    editorUi: ui('Collection'),
    takes: [],
    ...plain(),
  },
}

/** `maxChars` → `--max-chars`, for naming a flag in a refusal. */
export const optionFlag = (option: string): string =>
  `--${option.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

/** Every option some preset takes, for the command's flags. */
export const PRESET_OPTIONS: readonly Option[] = [
  ...new Set(Object.values(DATA_TYPE_PRESETS).flatMap((p) => p.takes)),
]

const letters = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The preset a name means: a preset's own name, or its editor's or editor UI's full name. */
export function findPreset(name: string): [string, Preset] | undefined {
  const own = DATA_TYPE_PRESETS[name]
  if (own) return [name, own]
  const entries = Object.entries(DATA_TYPE_PRESETS)
  return (
    entries.find(([key]) => letters(key) === letters(name)) ??
    entries.find(([, preset]) => preset.editorUi === name) ??
    entries.find(([, preset]) => preset.editor === name)
  )
}

/** The preset a data type's editor and UI are, when there is one. */
export function presetOf(editor: string, editorUi?: string): [string, Preset] | undefined {
  const entries = Object.entries(DATA_TYPE_PRESETS)
  return (
    entries.find(([, p]) => p.editor === editor && editorUi && p.editorUi === editorUi) ??
    entries.find(([, p]) => p.editor === editor && (!editorUi || !EDITOR_UIS[editorUi]))
  )
}

/** Why a preset cannot take these options, or the config and blocks they give over its defaults. */
export function presetConfig(name: string, preset: Preset, options: PresetOptions): Built | string {
  const given = (Object.keys(options) as Option[]).filter((o) => options[o] !== undefined)
  const extra = given.filter((option) => !preset.takes.includes(option))
  if (extra.length > 0) return `${name} does not take ${extra.map(optionFlag).join(', ')}`
  const fraction = given.find(
    (option) => preset.whole?.includes(option) && !Number.isInteger(options[option]),
  )
  if (fraction) return `${optionFlag(fraction)} takes a whole number for ${name}`
  const built = preset.build(options)
  if (typeof built === 'string') return built
  return {
    config: { ...editorDefaults(preset.editor, preset.editorUi), ...built.config },
    ...(built.blocks ? { blocks: built.blocks } : {}),
  }
}

export type PresetResult = { ok: true; dataType: SchemaDataType } | { ok: false; reason: string }

/** Every name `--editor` takes: the presets', then each editor's and editor UI's. */
export const EDITOR_NAMES: readonly string[] = [
  ...Object.keys(DATA_TYPE_PRESETS),
  ...Object.keys(EDITOR_SCHEMAS),
  ...Object.keys(EDITOR_UIS),
]

/**
 * The data type a preset, or an editor's full name, and its options describe,
 * with any `settings` over them; or why it cannot be built.
 */
export function presetDataType(
  alias: string,
  editor: string,
  options: PresetOptions = {},
  name?: string,
  settings: Record<string, unknown> = {},
): PresetResult {
  const found = findPreset(editor)
  if (!found)
    return {
      ok: false,
      reason: `unknown editor "${editor}"; did you mean ${closestNames(editor, EDITOR_NAMES).join(', ')}? \`types editors --all\` lists them all`,
    }
  const [presetName, preset] = found
  const built = presetConfig(presetName, preset, options)
  if (typeof built === 'string') return { ok: false, reason: built }
  return {
    ok: true,
    dataType: {
      alias,
      name: name ?? nameFor(alias),
      editor: preset.editor,
      editorUi: preset.editorUi,
      config: { ...built.config, ...settings },
      ...(built.blocks && built.blocks.length > 0 ? { blocks: built.blocks } : {}),
    },
  }
}
