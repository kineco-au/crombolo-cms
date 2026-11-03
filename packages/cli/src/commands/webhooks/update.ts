import { writeFile } from 'node:fs/promises'
import {
  parseWebhookFile,
  updateWebhook,
  webhookProblems,
  writeWebhookFile,
} from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { eventAliases } from '../../support/names.ts'
import { loadTypes } from '../../support/types.ts'
import { findWebhook, headersOf } from '../../support/webhooks.ts'

const many = (summary: string, helpValue: string) =>
  Flags.string({ summary, helpValue, multiple: true })

/** A webhook's address, events, content types, headers and whether it is on (story 251). */
export default class WebhooksUpdate extends BaseCommand {
  static override summary = "change a webhook's address, events, content types or headers"
  static override description =
    "A header's value is given as env:NAME, and NAME set on the server: a secret is never kept with the site. The server uses the change from its next delivery. A webhook kept in this environment only is changed in the back office."
  static override examples = [
    '<%= config.bin %> webhooks update searchIndex --event content-unpublished --header Authorization=env:SEARCH_TOKEN',
    '<%= config.bin %> webhooks update searchIndex --no-enabled',
  ]
  static override args = {
    alias: Args.string({ required: true, description: "the webhook's alias" }),
  }
  static override flags = {
    name: Flags.string({ summary: 'its name; "" for none', helpValue: '<name>' }),
    description: Flags.string({ summary: 'its description; "" for none', helpValue: '<text>' }),
    url: Flags.string({ summary: 'where it is sent', helpValue: '<url>' }),
    enabled: Flags.boolean({ summary: 'it is sent; --no-enabled turns it off', allowNo: true }),
    event: many('an event that sends it too', '<event>'),
    'remove-event': many('an event that no longer sends it', '<event>'),
    'content-type': many('send it for pages of this type too', '<type>'),
    'remove-content-type': many('stop sending it for pages of this type', '<type>'),
    header: many('a header sent with it, as Name=env:VARIABLE', '<name=env:VAR>'),
    'remove-header': many('a header no longer sent', '<name>'),
    'dry-run': Flags.boolean({ summary: 'say what would change, and change nothing' }),
  }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'webhook', type: 'string' },
      { name: 'changed', type: 'boolean' },
    ],
    errors: ['not_found', 'usage', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WebhooksUpdate)
    const found = await findWebhook(args.alias)
    const result = updateWebhook(found.webhook, {
      name: flags.name,
      description: flags.description,
      url: flags.url,
      enabled: flags.enabled,
      addEvents: eventAliases(flags.event),
      removeEvents: eventAliases(flags['remove-event']),
      addContentTypes: flags['content-type'],
      removeContentTypes: flags['remove-content-type'],
      setHeaders: headersOf(flags.header),
      removeHeaders: flags['remove-header'],
    })
    if (!result.ok) this.fail('refused', `Nothing was changed: ${result.reason}.`)
    const known = new Set(loadTypes(found.config).set.contentTypes.map((t) => t.alias))
    const source = writeWebhookFile(result.webhook)
    const rules = webhookProblems(result.webhook, 'files')
    const problems = [
      ...(flags['content-type'] ?? [])
        .filter((alias) => !known.has(alias))
        .map((alias) => `There is no content type "${alias}".`),
      ...rules,
      ...parseWebhookFile(found.alias, source).problems.filter(
        (problem) => !rules.some((rule) => problem.endsWith(rule)),
      ),
    ]
    if (problems.length > 0)
      this.fail('refused', `The webhook "${found.alias}" was not changed.`, undefined, problems)
    const name = `"${result.webhook.name ?? found.alias}"`
    if (source === writeWebhookFile(found.webhook)) {
      this.say(`  ${found.alias} is already so: nothing to change.`)
      this.changedNothing = true
      return { webhook: found.alias, changed: false }
    }
    this.say(`  The webhook ${name} (${found.alias}):`)
    for (const [flag, value] of Object.entries(flags))
      if (value !== undefined && flag !== 'dry-run' && flag !== 'json' && flag !== 'output')
        this.say(`    ${flag} ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    if (flags['dry-run']) {
      this.say('\nNothing was changed (--dry-run).')
      return { webhook: found.alias, changed: false }
    }
    await writeFile(found.file, source)
    this.say('\nThe server uses it from its next delivery.')
    return { webhook: found.alias, changed: true }
  }
}
