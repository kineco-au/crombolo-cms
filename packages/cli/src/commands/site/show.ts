import { DESCRIBED_KINDS, listTypes } from '@crombolo/schema'
import { BaseCommand } from '../../base.ts'
import { databaseGroups, siteDefinitions } from '../../support/site-definitions.ts'
import { fileWebhooks, storedWebhooks } from '../../support/webhooks.ts'

const KIND_WORDS = {
  content: 'content',
  element: 'element',
  media: 'media',
  member: 'member',
  data: 'data',
} as const

/** What the site is, in one place (story 252): `status` says whether it is working. */
export default class SiteShow extends BaseCommand {
  static override summary =
    'what this site is: its languages, addresses, types, forms, workflows, groups and webhooks'
  static override description =
    'Each line names the command that shows more. `crombolo status` says whether the site is working.'
  static override examples = ['<%= config.bin %> site show', '<%= config.bin %> site show -o json']
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [
      { name: 'name', type: 'string' },
      { name: 'languages', type: 'array', items: { type: 'object' } },
      { name: 'urls', type: 'object' },
      { name: 'types', type: 'object' },
      { name: 'forms', type: 'array', items: { type: 'object' } },
      { name: 'workflows', type: 'array', items: { type: 'object' } },
      { name: 'userGroups', type: 'array', items: { type: 'object' } },
      { name: 'webhooks', type: 'array', items: { type: 'object' } },
    ],
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    await this.parse(this.ctor)
    const { config, loaded } = await siteDefinitions()
    const { set } = loaded

    const languages = set.languages.map((l) => ({
      iso: l.iso,
      name: l.name,
      default: l.default,
      mandatory: l.mandatory,
      fallback: l.fallback ?? null,
    }))
    const hideTopLevel = set.urls?.hideTopLevel !== false
    const own = listTypes(set, { own: true })
    const types = Object.fromEntries(
      DESCRIBED_KINDS.map((kind) => [kind, own.filter((row) => row.kind === kind).length]),
    ) as Record<(typeof DESCRIBED_KINDS)[number], number>
    const forms = (set.forms ?? []).map((f) => ({ alias: f.alias, name: f.name }))
    const workflows = (set.workflows ?? []).map((w) => ({ alias: w.alias, name: w.name }))
    const declared = set.userGroups ?? []
    const stored = (await databaseGroups(config)) ?? []
    const userGroups = [
      ...declared.map((g) => ({ alias: g.alias, name: g.name, source: 'site' })),
      ...stored
        .filter((d) => !declared.some((g) => g.alias.toLowerCase() === d.group.alias.toLowerCase()))
        .map((d) => ({ alias: d.group.alias, name: d.group.name, source: 'back office' })),
    ]
    const webhooks = [
      ...fileWebhooks(config).map(({ alias, webhook }) => ({
        alias,
        name: webhook.name,
        url: webhook.url,
        enabled: webhook.enabled,
        withTheSite: true,
      })),
      ...(await storedWebhooks(config)).map((w) => ({
        alias: w.alias,
        name: w.name,
        url: w.url,
        enabled: w.enabled,
        withTheSite: false,
      })),
    ]

    const line = (label: string, text: string, more: string) =>
      this.say(`  ${label.padEnd(12)} ${text}${more ? `   \`${more}\`` : ''}`)
    const named = (items: ReadonlyArray<{ alias: string; name: string }>) =>
      items.map((i) => (i.name && i.name !== i.alias ? `${i.alias} "${i.name}"` : i.alias))

    this.say(config.siteName)
    line(
      'languages',
      languages.length === 0
        ? 'English (en-US) only'
        : languages
            .map((l) => `${l.name} (${l.iso})${l.default ? ', the default' : ''}`)
            .join('; '),
      'crombolo languages list',
    )
    line(
      'addresses',
      hideTopLevel
        ? 'the top-level page is left out: the home page is /'
        : 'the top-level page is in every address',
      'crombolo site urls',
    )
    line(
      'types',
      DESCRIBED_KINDS.map((kind) => `${types[kind]} ${KIND_WORDS[kind]}`).join(', '),
      'crombolo types list',
    )
    line('forms', named(forms).join(', ') || 'none', forms.length ? 'crombolo forms list' : '')
    line(
      'workflows',
      named(workflows).join(', ') || 'none',
      workflows.length ? 'crombolo workflows list' : '',
    )
    const ownGroups = userGroups.filter((g) => g.source === 'site')
    const others = userGroups.length - ownGroups.length
    line(
      'user groups',
      [
        named(ownGroups).join(', ') || "none of the site's own",
        ...(others ? [`and ${others} others, built in or made in the back office`] : []),
      ].join(' '),
      'crombolo users groups list',
    )
    line(
      'webhooks',
      webhooks.map((w) => `${w.alias}${w.enabled ? '' : ' (off)'}`).join(', ') || 'none',
      webhooks.length ? 'crombolo webhooks list' : '',
    )
    this.say('\n`crombolo status` says whether it is working: its database, bundles and problems.')

    return {
      name: config.siteName,
      languages,
      urls: { hideTopLevel },
      types,
      forms,
      workflows,
      userGroups,
      webhooks,
    }
  }
}
