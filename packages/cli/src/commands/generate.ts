import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { isAllowedContentType, resolveDeliveryApiSettings } from '@crombolo/api-delivery'
import { generateDeliveryTypes, generateTypes, validateSchemaSet } from '@crombolo/schema'
import { formTypesFor } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { here } from '../support/describe.ts'
import { siteConfig } from '../support/site.ts'
import { loadTypes, refuseProblems } from '../support/types.ts'

export default class Generate extends BaseCommand {
  static override summary = 'TypeScript for the content types in schema/'
  static override description = [
    'Writes schema/content-types.d.ts, the values a view receives.',
    "With --delivery, writes the Delivery API's JSON instead, for an app using @crombolo/delivery-client, to the file --out names.",
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> generate',
    '<%= config.bin %> generate --delivery --out ../app/src/cms-types.ts',
  ]
  static override flags = {
    delivery: Flags.boolean({
      summary: "types for the Delivery API's JSON, for an app; needs --out",
    }),
    out: Flags.string({ summary: 'the file to write', helpValue: '<file>' }),
    schema: Flags.string({
      summary: 'the schema directory to read, if not this site’s',
      helpValue: '<dir>',
    }),
  }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [{ name: 'wrote', type: 'string' }],
    errors: ['usage', 'refused'],
  } as const

  async run() {
    const { flags } = await this.parse(Generate)
    if (flags.delivery && !flags.out)
      this.fail('usage', '--delivery needs --out: the file in your app to write the types to.')
    const site = await siteConfig()
    const config = flags.schema ? { ...site, schemaDir: resolve(flags.schema) } : site
    const loaded = loadTypes(config)
    refuseProblems([
      ...loaded.problems,
      ...validateSchemaSet(loaded.set, { types: formTypesFor(config) }),
    ])
    const target = flags.out ? resolve(flags.out) : join(config.schemaDir, 'content-types.d.ts')
    const settings = resolveDeliveryApiSettings(config.deliveryApi)
    const text = flags.delivery
      ? generateDeliveryTypes(loaded.set, {
          serves: (alias) => isAllowedContentType(settings, alias),
        })
      : generateTypes(loaded.set)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, text)
    this.say(`  wrote  ${here(target)}`)
    return { wrote: here(target) }
  }
}
