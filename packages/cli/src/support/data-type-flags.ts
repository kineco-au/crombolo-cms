/** The named settings `types new data-type` and `types update` share, as flags and as preset options. */
import type { PresetOptions } from '@crombolo/schema'
import { Flags } from '@oclif/core'

const many = (summary: string, helpValue: string) =>
  Flags.string({ summary, helpValue, multiple: true })

const number = (summary: string) =>
  Flags.custom<number>({
    summary,
    helpValue: '<number>',
    parse: async (input) => {
      const value = Number(input)
      if (input.trim() === '' || !Number.isFinite(value))
        throw new Error(`Expected a number, not "${input}".`)
      return value
    },
  })()

const whole = (summary: string) => Flags.integer({ summary })

/** The flags, with `--no-` forms when `allowNo`, as `types update` takes them. */
export function dataTypeFlags(allowNo: boolean) {
  const toggle = (summary: string) => Flags.boolean({ summary, allowNo })
  return {
    'max-chars': whole('data types: the most characters allowed'),
    rows: whole('data types: the rows a text area shows'),
    min: number('data types: the least allowed (numbers, a slider, items)'),
    max: number('data types: the most allowed (numbers, a slider, items)'),
    step: number('data types: the step between numbers, or along a slider'),
    range: toggle('data types: a slider picks a range, from and to'),
    'default-on': toggle('data types: a toggle starts on'),
    label: Flags.string({ summary: "data types: a toggle's label", helpValue: '<text>' }),
    'with-time': toggle('data types: a date with a time of day'),
    option: many('data types: a choice in a dropdown or list; give each, in order', '<value>'),
    multiple: toggle('data types: more than one may be chosen'),
    allow: many('data types: a type a picker offers; give each', '<alias>'),
    of: Flags.string({
      summary: 'data types: what a content picker picks',
      options: ['pages', 'media', 'members'],
    }),
    columns: whole('data types: the columns a block grid has'),
    group: Flags.string({ summary: 'data types: the group tags are kept in', helpValue: '<name>' }),
    color: many('data types: a colour a colour picker offers; give each', '<hex>[=<label>]'),
    alpha: toggle('data types: an eye dropper picks transparency too'),
    palette: toggle('data types: an eye dropper shows a palette'),
    extension: many('data types: a file type an upload accepts; give each', '<ext>'),
    crop: many('data types: a crop an image cropper offers; give each', '<alias>:<width>x<height>'),
    preview: toggle('data types: a Markdown editor shows a preview'),
    language: Flags.string({
      summary: 'data types: the language a code editor highlights',
      helpValue: '<language>',
    }),
    'value-type': Flags.string({
      summary: 'data types: what a label holds',
      options: ['string', 'long-string', 'decimal', 'integer', 'big-integer', 'date', 'time'],
    }),
  }
}

/** Every flag `dataTypeFlags` gives. */
export const DATA_TYPE_FLAG_NAMES = Object.keys(dataTypeFlags(false)) as Array<
  keyof ReturnType<typeof dataTypeFlags>
>

/** The preset options the flags give; a toggle left off is not given. */
export function presetOptions(flags: Record<string, unknown>, offIsGiven = false): PresetOptions {
  const toggle = (value: unknown) =>
    value === undefined || (value === false && !offIsGiven) ? undefined : (value as boolean)
  return {
    maxChars: flags['max-chars'] as number | undefined,
    rows: flags.rows as number | undefined,
    min: flags.min as number | undefined,
    max: flags.max as number | undefined,
    step: flags.step as number | undefined,
    range: toggle(flags.range),
    defaultOn: toggle(flags['default-on']),
    label: flags.label as string | undefined,
    withTime: toggle(flags['with-time']),
    option: flags.option as string[] | undefined,
    multiple: toggle(flags.multiple),
    allow: flags.allow as string[] | undefined,
    of: flags.of as string | undefined,
    columns: flags.columns as number | undefined,
    group: flags.group as string | undefined,
    color: flags.color as string[] | undefined,
    alpha: toggle(flags.alpha),
    palette: toggle(flags.palette),
    extension: flags.extension as string[] | undefined,
    crop: flags.crop as string[] | undefined,
    preview: toggle(flags.preview),
    language: flags.language as string | undefined,
    valueType: flags['value-type'] as string | undefined,
  }
}
