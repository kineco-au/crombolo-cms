import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseWebhookFile,
  type WebhookDefinition,
  webhookKeyFor,
  webhookProblems,
  writeWebhookFile,
} from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { here } from '../../support/describe.ts'
import { siteConfig } from '../../support/site.ts'
import { loadTypes, needSchemaDir } from '../../support/types.ts'

export default class WebhooksNew extends BaseCommand {
  static override summary = 'write a webhook kept with the site, checked as the server reads it'
  static override examples = [
    '<%= config.bin %> webhooks new searchIndex --url https://search.example/hook --event Umbraco.ContentPublish --content-type article',
  ]
  static override args = {
    alias: Args.string({ required: true, description: "the webhook's alias" }),
  }
  static override flags = {
    url: Flags.string({ required: true, summary: 'where it is sent', helpValue: '<url>' }),
    event: Flags.string({
      required: true,
      summary: 'an event that sends it, such as Umbraco.ContentPublish',
      helpValue: '<event>',
      multiple: true,
    }),
    'content-type': Flags.string({
      summary: 'only for pages of this type',
      helpValue: '<alias>',
      multiple: true,
    }),
    name: Flags.string({ summary: "the webhook's name", helpValue: '<name>' }),
    header: Flags.string({
      summary: 'a header sent with it, as Name=env:VARIABLE',
      helpValue: '<name=env:VAR>',
      multiple: true,
    }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [{ name: 'created', type: 'array', items: { type: 'string' } }],
    errors: ['not_found', 'conflict', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WebhooksNew)
    const config = await siteConfig()
    needSchemaDir(config)
    const dir = join(config.schemaDir, 'webhooks')
    const taken = existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => name.endsWith('.toml'))
          .some((name) => {
            const { webhook } = parseWebhookFile(name, readFileSync(join(dir, name), 'utf8'))
            return name === `${args.alias}.toml` || webhook?.alias === args.alias
          })
      : false
    if (taken) this.fail('conflict', `There is already a webhook with the alias "${args.alias}".`)

    const contentTypes = flags['content-type'] ?? []
    const known = new Set(loadTypes(config).set.contentTypes.map((t) => t.alias))
    const unknown = contentTypes.filter((alias) => !known.has(alias))
    const headers: Record<string, string> = {}
    const malformed: string[] = []
    for (const header of flags.header ?? []) {
      const at = header.indexOf('=')
      if (at <= 0) malformed.push(`"${header}" is not Name=env:VARIABLE.`)
      else headers[header.slice(0, at).trim()] = header.slice(at + 1).trim()
    }
    const webhook: WebhookDefinition = {
      key: webhookKeyFor(args.alias),
      alias: args.alias,
      name: flags.name ?? null,
      description: null,
      url: flags.url,
      enabled: true,
      events: flags.event,
      contentTypeKeys: contentTypes,
      headers,
    }
    const problems = [
      ...unknown.map((alias) => `There is no content type "${alias}".`),
      ...malformed,
      ...webhookProblems(webhook, 'files'),
    ]
    const source = writeWebhookFile(webhook, contentTypes)
    const file = join(dir, `${args.alias}.toml`)
    problems.push(...parseWebhookFile(here(file), source).problems)
    if (problems.length > 0)
      this.fail('refused', 'The webhook was not written.', undefined, problems)
    await mkdir(dir, { recursive: true })
    await writeFile(file, source)
    this.say(`  created  ${here(file)}`)
    return { created: [here(file)] }
  }
}
