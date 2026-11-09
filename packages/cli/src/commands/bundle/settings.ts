import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { cliActor, withLocalBundles } from '../../support/bundles.ts'

interface Setting {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'choice'
  value: unknown
  locked: boolean
}

/** A value typed at the command line, as its setting holds it. */
function typedValue(setting: Setting, text: string): unknown {
  if (text === '') return null
  if (setting.type === 'number') return Number(text)
  if (setting.type === 'boolean') return text === 'true' || text === 'yes'
  return text
}

/** An installed extension's settings (story 310): read them, or set those the config does not lock. */
export default class BundleSettings extends BaseCommand {
  static override summary = "read an installed extension's settings, or set them"
  static override description =
    "With no key=value, lists its settings and where each comes from. A setting the site's config sets under `extensions` is locked; the rest are kept in this site's database. `key=` takes one back to its default. An extension reads its settings when it starts, so a change takes effect at `crombolo restart`."
  static override examples = [
    '<%= config.bin %> bundle settings @crombolo/simple-redirects',
    '<%= config.bin %> bundle settings @crombolo/simple-redirects section=content',
  ]
  static override strict = false
  static override args = {
    name: Args.string({ required: true, description: 'the package name, or its bundle id' }),
  }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [{ name: 'settings', type: 'array', items: { type: 'object' } }],
    errors: ['refused', 'not_found', 'usage'],
  } as const

  async run() {
    const { args, argv } = await this.parse(BundleSettings)
    const pairs = (argv as string[]).slice(1)
    return withLocalBundles(async (admin) => {
      const installed = await admin.installed()
      const item = installed.items.find(
        (candidate) => candidate.packageName === args.name || candidate.id === args.name,
      ) as { id: string; settings?: Setting[] } | undefined
      if (!item) this.fail('not_found', `No installed extension is called "${args.name}".`)
      const settings = item.settings ?? []
      if (pairs.length === 0) {
        this.changedNothing = true
        if (settings.length === 0) this.say('  It has no settings.')
        for (const setting of settings)
          this.say(
            `  ${setting.key.padEnd(16)} ${JSON.stringify(setting.value)}${setting.locked ? '  (set in the config)' : ''}  ${setting.label}`,
          )
        return { settings }
      }
      const values: Record<string, unknown> = {}
      for (const pair of pairs) {
        const eq = pair.indexOf('=')
        if (eq < 1) this.fail('usage', `"${pair}" is not key=value.`)
        const key = pair.slice(0, eq)
        const setting = settings.find((candidate) => candidate.key === key)
        if (!setting) this.fail('usage', `It has no setting "${key}".`)
        values[key] = typedValue(setting, pair.slice(eq + 1))
      }
      const outcome = await admin.setSettings(cliActor(), item.id, values)
      if (!outcome.ok) throw new CliError('refused', outcome.message)
      this.say(`  ${outcome.message}`)
      return {
        settings: (await admin.installed()).items.find((i) => i.id === item.id)?.settings ?? [],
      }
    })
  }
}
