import { normaliseUuid, ObjectTypes } from '@crombolo/core'
import { NodeRepository } from '@crombolo/data'
import { seedKey, segmentOf } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { findBlueprint, withBlueprints } from '../../support/blueprints.ts'
import {
  findPage,
  pageActor,
  pageFlags,
  refusedPage,
  setsOf,
  viewKeyOf,
  withValuesSet,
} from '../../support/pages.ts'

/** A page made from the command line (story 253), as the back office makes one. */
export default class ContentNew extends BaseCommand {
  static override summary = 'make a page, with its values, under the page its path names'
  static override description = [
    "The path's last part is the new page's name and the rest is where it goes: `/Home/Visit us` makes \"Visit us\" under Home, and `/About` makes one at the top level. The page's type has to be allowed there.",
    'Values are given in the shorthand content files use: Markdown for rich text, a path for a picked page or media item, JSON for a toggle, a number or a list. The page is a draft until it is published: --publish publishes it too, through any approval its workflow asks for.',
    "--blueprint starts it from a blueprint, a page's values saved as a starting point for new pages of its type: its values and its other languages come with it, and --set changes what it gives. The blueprint's type is the page's, so --type can be left out.",
    'It is made with the key a content file at that path would have, so the same command makes the same page in every environment.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content new "/Home/Visit us" --type contentPage --set title="Visit us" --set body="Open every day from **7am**."',
    '<%= config.bin %> content new /About --type contentPage --set-file body=about.md --publish',
    '<%= config.bin %> content new "/Home/Spring sale" --blueprint "Landing page" --set title="Spring sale"',
  ]
  static override args = {
    path: Args.string({ required: true, description: "the new page's path, ending in its name" }),
  }
  static override flags = {
    type: Flags.string({
      summary: "the page's content type; a blueprint's, when --blueprint is given",
      helpValue: '<type>',
    }),
    blueprint: Flags.string({
      summary: 'the blueprint it starts from, by name or key',
      helpValue: '<name>',
    }),
    ...pageFlags,
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'path', type: 'string' },
      { name: 'changed', type: 'boolean' },
      { name: 'published', type: 'boolean' },
    ],
    errors: ['not_found', 'usage', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ContentNew)
    const parts = args.path
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean)
    const name = parts.pop()
    if (!name)
      throw new CliError('usage', 'Give the new page a path ending in its name: /Home/Visit us.')
    if (flags.type === undefined && flags.blueprint === undefined)
      throw new CliError('usage', 'Say what kind of page it is: --type, or --blueprint.')
    return withBlueprints(async ({ site, port }) => {
      const named =
        flags.type === undefined ? undefined : await site.lookup.typeOf('document', flags.type)
      if (flags.type !== undefined && (!named || named.isElement))
        throw new CliError('not_found', `The site has no page type called "${flags.type}".`, {
          hint: '`crombolo types list --kind content` lists them.',
        })
      const blueprint =
        flags.blueprint === undefined
          ? undefined
          : await findBlueprint(port, flags.blueprint, named?.key).catch(async (error) => {
              // Named within the type, a blueprint of another type is not found: say whose it is.
              if (!named || !(error instanceof CliError) || error.kind !== 'not_found') throw error
              return findBlueprint(port, flags.blueprint as string)
            })
      const type =
        named ??
        (blueprint ? await site.lookup.typeByKey('document', blueprint.contentTypeKey) : undefined)
      if (!type || type.isElement)
        throw new CliError('not_found', 'The blueprint is for a page type this site no longer has.')
      if (blueprint && normaliseUuid(blueprint.contentTypeKey) !== normaliseUuid(type.key)) {
        const its = await site.lookup.typeByKey('document', blueprint.contentTypeKey)
        throw new CliError(
          'refused',
          `“${blueprint.name}” is a blueprint for ${its?.name ?? 'another type'}, not ${type.name}.`,
          { hint: '`crombolo content blueprint list --type` lists those of a type.' },
        )
      }
      const start = blueprint ? await port.byKey(blueprint.key) : undefined
      const parent = parts.length > 0 ? await findPage(site, `/${parts.join('/')}`) : null
      const allowed = parent
        ? parent.type.allowedContentTypes.some(
            (a) => normaliseUuid(a.contentTypeKey) === normaliseUuid(type.key),
          )
        : type.allowedAsRoot
      if (!allowed)
        throw new CliError(
          'refused',
          parent
            ? `Nothing was made: "${type.name}" is not allowed under "${parent.type.name}".`
            : `Nothing was made: "${type.name}" is not allowed at the top level.`,
          {
            hint: `\`crombolo types update ${parent ? parent.type.alias : type.alias} ${parent ? `--allow-child ${type.alias}` : '--at-root'}\` allows it.`,
          },
        )
      const nodes = new NodeRepository(site.db)
      const parentId = parent ? (await nodes.byKey(parent.doc.key))?.id : -1
      const taken =
        parentId === undefined
          ? []
          : await nodes.childrenNamed(parentId, [ObjectTypes.Document], name)
      if (taken.length > 0)
        throw new CliError(
          'refused',
          `Nothing was made: there is already a page "${name}" there.`,
          {
            hint: '`crombolo content update` changes it.',
          },
        )
      const segments = [...parts, name].map(segmentOf)
      const derived = seedKey(`content/${segments.join('/')}`)
      const key = (await nodes.byKey(derived)) ? crypto.randomUUID() : derived
      const editors = await site.lookup.editorsOf('document', type)
      const values = await withValuesSet(
        site,
        { key, type, editors },
        start?.values ?? [],
        setsOf(flags.set, flags['set-file']),
        [],
        flags.culture ?? null,
      )
      const culture = type.variesByCulture ? (flags.culture ?? site.languages[0] ?? null) : null
      const path = `/${[...parts, name].join('/')}`
      this.say(
        `  ${flags['dry-run'] ? 'would make' : 'made'}  ${path}  (${type.name})${blueprint ? `  from the blueprint "${blueprint.name}"` : ''}`,
      )
      for (const v of values) this.say(`    ${v.alias}${v.culture ? ` (${v.culture})` : ''}`)
      if (flags['dry-run']) {
        this.say('\nNothing was changed (--dry-run).')
        return { key, name, path, changed: false, published: false }
      }
      const input = {
        key,
        contentTypeKey: type.key,
        componentKey: await viewKeyOf(site, type, flags.view),
        parentKey: parent?.doc.key ?? null,
        values,
        variants: variantsOf(start?.variants ?? [], culture, name),
      }
      const actor = pageActor(flags['skip-approval'])
      // Made and published in one step: a page that cannot be published is not left behind.
      const created = flags.publish
        ? await site.operations.createAndPublish(actor, input, null)
        : await site.operations.create(actor, input)
      if (!created.ok) throw refusedPage(created)
      this.say(
        flags.publish ? '  published' : '\nA draft: `crombolo content publish` takes it live.',
      )
      return { key, name, path, changed: true, published: flags.publish === true }
    })
  }
}

/** A new page's names: the path's in its language, and a blueprint's in its others. */
function variantsOf(
  from: ReadonlyArray<{ culture: string | null; segment: string | null; name: string }>,
  culture: string | null,
  name: string,
) {
  if (culture === null) return [{ culture, segment: null, name }]
  const others = from
    .filter((v) => v.culture !== null && v.segment === null)
    .filter((v) => v.culture?.toLowerCase() !== culture.toLowerCase())
    .map((v) => ({ culture: v.culture, segment: null, name: v.name }))
  return [{ culture, segment: null, name }, ...others]
}
