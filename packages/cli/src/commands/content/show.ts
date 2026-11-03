import { tomlValue } from '@crombolo/server'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { findPage, withPages } from '../../support/pages.ts'

const STATES: Record<string, string> = {
  Draft: 'a draft',
  Published: 'published',
  PublishedPendingChanges: 'published, with changes not published yet',
  NotCreated: 'not made in this language',
}

interface ShownBlock {
  type: string
  alias?: string
  key: string
  values: Record<string, unknown>
}

const isBlocks = (value: unknown): value is ShownBlock[] =>
  Array.isArray(value) &&
  value.every((b) => typeof b === 'object' && b !== null && 'type' in b && 'key' in b)

/** One page, its values in the shorthand content files use and its blocks (story 253). */
export default class ContentShow extends BaseCommand {
  static override summary = 'one page: its type, state, values and blocks'
  static override description =
    'Values are shown in the shorthand `content new` and `content update` take, and each block with its type, alias and key, which `content block` names it by.'
  static override examples = ['<%= config.bin %> content show "/Home/Visit us"']
  static override args = {
    page: Args.string({ required: true, description: 'the page: a path or a uuid' }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    stdoutSchema: {},
    errors: ['not_found'],
  } as const

  async run() {
    const { args } = await this.parse(ContentShow)
    return withPages(async (site) => {
      const page = await findPage(site, args.page)
      const { doc, type } = page
      const values = []
      for (const v of doc.values) {
        if (v.segment !== null) continue
        const editor = page.editors.get(v.alias)?.editor ?? ''
        values.push({
          property: v.alias,
          culture: v.culture,
          value: await site.reader.shorthand(editor, v.value),
        })
      }
      this.say(`${page.path}  (${type.name}, ${type.alias})`)
      this.say(`  key      ${doc.key}`)
      for (const variant of doc.variants)
        this.say(
          `  ${variant.culture ? `${variant.culture.padEnd(8)} ` : ''}"${variant.name}", ${STATES[variant.state] ?? variant.state}`,
        )
      for (const v of values) {
        const label = `${v.property}${v.culture ? ` (${v.culture})` : ''}`
        if (isBlocks(v.value)) {
          this.say(`\n  ${label}`)
          for (const block of v.value) {
            this.say(`    ${block.alias ?? '(no alias)'}  ${block.type}  ${block.key}`)
            for (const [alias, value] of Object.entries(block.values))
              this.say(`      ${alias.padEnd(20)} ${tomlValue(value) ?? ''}`)
          }
        } else this.say(`  ${label.padEnd(22)} ${tomlValue(v.value) ?? ''}`)
      }
      return {
        key: doc.key,
        path: page.path,
        type: type.alias,
        variants: doc.variants.map((v) => ({ culture: v.culture, name: v.name, state: v.state })),
        values,
      }
    })
  }
}
