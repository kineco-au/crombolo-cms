import {
  pageShown,
  type ReferencePage,
  referencesTo,
  type ShownPage,
  usedByWords,
} from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { hostedOrHere } from '../../profiles/choose.ts'
import { libraryPath, needSection, refersToLibrary } from '../../support/library.ts'
import { showLibraryItem } from '../../support/library-content.ts'
import { referenceLines, showingWords } from '../../support/media-library.ts'
import { findPage, sayValues, withPages } from '../../support/pages.ts'
import { connectSite, needEnvironment, profileFlags } from '../../support/remote.ts'

const STATES: Record<string, string> = {
  Draft: 'a draft',
  Published: 'published',
  PublishedPendingChanges: 'published, with changes not published yet',
  NotCreated: 'not made in this language',
}

type Shown = ShownPage & { references?: ReferencePage }

/** One page, its values in the shorthand content files use and its blocks (story 253). */
export default class ContentShow extends BaseCommand {
  static override summary = 'one page or Library item: its type, state, values and blocks'
  static override description = [
    'Values are shown in the shorthand `content new` and `content update` take, and each block with its type, alias and key, which `content block` names it by.',
    '--references lists what uses the page: other pages, the Library and media that link to it or pick it.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content show "/Home/Visit us"',
    '<%= config.bin %> content show "/Home/Visit us" --references --profile production',
    '<%= config.bin %> content show library:/Menus/Footer',
  ]
  static override args = {
    page: Args.string({
      required: true,
      description: 'the page: a path or a uuid; library:/… for a Library item',
    }),
  }
  static override flags = {
    references: Flags.boolean({ summary: 'list what uses the page' }),
    skip: Flags.integer({ summary: 'with --references: how many to skip', min: 0, default: 0 }),
    take: Flags.integer({
      summary: 'with --references: how many to show',
      min: 1,
      max: 100,
      default: 25,
    }),
    ...profileFlags,
  }
  static override access = 'site' as const
  static override section = ['content', 'library'] as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    stdoutSchema: {},
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ContentShow)
    const hosted = hostedOrHere(flags)
    const paging = { skip: flags.skip, take: flags.take }
    let page: Shown
    if (hosted) {
      if (libraryPath(args.page) !== undefined)
        throw new CliError(
          'refused',
          'The Library is shown on this site’s own database only: leave out --profile.',
        )
      const { discovery, client, environment } = await connectSite(hosted)
      if (!discovery.capabilities?.includes('content-show'))
        throw new CliError('refused', 'This site needs a newer crombolo to show its pages.', {
          hint: `${discovery.name} has to be upgraded first.`,
        })
      const env = needEnvironment(environment, discovery)
      const asked = flags.references
        ? `?references=true&skip=${paging.skip}&take=${paging.take}`
        : ''
      page = await client.json<Shown>(
        `environments/${env}/content-items/${encodeURIComponent(args.page)}${asked}`,
      )
    } else {
      if (await refersToLibrary(args.page)) {
        if (flags.references)
          throw new CliError('usage', '--references lists what uses a page, not a Library item.')
        return showLibraryItem(this, args.page)
      }
      needSection(false)
      page = await withPages(async (site) => {
        const found = await findPage(site, args.page)
        const shown = await pageShown(site.db, found.doc.key)
        if (!shown) throw new CliError('not_found', `"${args.page}" is not a page.`)
        return flags.references
          ? { ...shown, references: await referencesTo(site.db, found.doc.key, paging) }
          : shown
      })
    }
    this.say(`${page.path}  (${page.typeName}, ${page.type})`)
    this.say(`  key      ${page.key}`)
    for (const variant of page.variants)
      this.say(
        `  ${variant.culture ? `${variant.culture.padEnd(8)} ` : ''}"${variant.name}", ${STATES[variant.state] ?? variant.state}`,
      )
    sayValues(this, page.values)
    if (page.references) {
      this.say(`\n  ${usedByWords(page.references)}`)
      for (const line of referenceLines(page.references)) this.say(line)
      const showing = showingWords(paging.skip, page.references.items.length, page.references.total)
      if (showing) this.say(`\n  ${showing}`)
    }
    return {
      key: page.key,
      path: page.path,
      type: page.type,
      variants: page.variants,
      values: page.values,
      ...(page.references ? { references: page.references } : {}),
    }
  }
}
