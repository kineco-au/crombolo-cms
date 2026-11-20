import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { exportSchemaSet, writeSchemaFiles } from '@crombolo/schema'
import { bootstrapDatabase, schemaFilesIn } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { here } from '../../support/describe.ts'
import { hostedSchema, schemaDiff, versionIn } from '../../support/hosted-schema.ts'
import { confirm } from '../../support/prompt.ts'
import { siteConfig } from '../../support/site.ts'
import { loadTypes } from '../../support/types.ts'

const CHANGE_WORDS = {
  'only-there': 'add    ',
  differs: 'change ',
  'only-here': 'remove ',
} as const

export default class TypesExport extends BaseCommand {
  static override summary =
    "write the database's definitions as schema/ files, or a hosted site's with --from"
  static override description = [
    "--from brings a hosted site's definitions into schema/ as they are there: it lists what it adds, changes and removes, and asks unless --yes. Files outside the definitions, such as migrations/, are left alone.",
    'The files are not applied to this database: `crombolo types sync` does that.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> types export',
    '<%= config.bin %> types export --from production',
    '<%= config.bin %> types export --from production --env staging --yes',
  ]
  static override aliases = ['schema:export']
  static override deprecateAliases = true
  static override flags = {
    from: Flags.string({
      summary: 'the hosted site to bring them from, by its profile',
      helpValue: '<profile>',
    }),
    env: Flags.string({
      summary: "the --from site's environment",
      helpValue: '<id>',
      dependsOn: ['from'],
    }),
    yes: Flags.boolean({
      summary: 'with --from: change the files without asking',
      dependsOn: ['from'],
    }),
    'dry-run': Flags.boolean({
      summary: 'with --from: say what would change, and change nothing',
      dependsOn: ['from'],
    }),
  }
  static override access = 'site' as const
  static override section = 'settings' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'bounded',
    outputFields: [
      { name: 'wrote', type: 'array', items: { type: 'string' } },
      { name: 'removed', type: 'array', items: { type: 'string' } },
      {
        name: 'version',
        type: 'string',
        nullable: true,
        description: 'with --from: the version the files now name',
      },
    ],
    errors: ['usage', 'refused', 'confirmation_required', 'unavailable', 'auth'],
    confirmationBypassArg: '--yes',
  } as const

  async run() {
    const { flags } = await this.parse(TypesExport)
    const config = await siteConfig()
    if (flags.from) return this.fromHosted(config, flags.from, flags)
    const { db } = await bootstrapDatabase(config)
    try {
      const version = existsSync(config.schemaDir) ? loadTypes(config).set.version : '1.0.0'
      const wrote = writeSchemaFiles(config.schemaDir, await exportSchemaSet(db, version)).map(here)
      for (const file of wrote) this.say(`  wrote  ${file}`)
      return { wrote, removed: [], version: null }
    } finally {
      await db.close()
    }
  }

  /** The hosted site's definitions mirrored into `schema/` (story 374). */
  private async fromHosted(
    config: Awaited<ReturnType<typeof siteConfig>>,
    from: string,
    flags: { env?: string; yes?: boolean; 'dry-run'?: boolean },
  ) {
    const hosted = await hostedSchema(from, flags.env, '--from', 'schema-files')
    const read = await hosted.files()
    const there = new Map(Object.entries(read.files))
    const mine = schemaFilesIn(config.schemaDir)
    const differences = schemaDiff(mine, there)
    const versionHere = versionIn(mine)
    const versionChanges = mine.get('schema.toml') !== there.get('schema.toml')
    if (differences.length === 0 && !versionChanges) {
      this.say(`schema/ is already as ${from} has it (${read.version}).`)
      this.changedNothing = true
      return { wrote: [], removed: [], version: read.version }
    }
    for (const { path, change } of differences) this.say(`  ${CHANGE_WORDS[change]} ${path}`)
    if (versionHere !== read.version) this.say(`  version  ${versionHere} → ${read.version}`)
    if (flags['dry-run']) {
      this.say('\nNothing was changed (--dry-run).')
      this.changedNothing = true
      return { wrote: [], removed: [], version: versionHere }
    }
    if (!flags.yes) await confirm(`Change schema/ to match ${from}? [y/N]`, { bypass: '--yes' })

    const wrote: string[] = []
    const removed: string[] = []
    const writes = differences.filter((d) => d.change !== 'only-here').map((d) => d.path)
    if (versionChanges && !writes.includes('schema.toml')) writes.push('schema.toml')
    for (const path of writes) {
      const file = join(config.schemaDir, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, there.get(path) as string)
      wrote.push(here(file))
    }
    for (const { path } of differences.filter((d) => d.change === 'only-here')) {
      const file = join(config.schemaDir, path)
      rmSync(file, { force: true })
      removed.push(here(file))
    }
    this.say(`\nschema/ now has ${from}'s definitions: \`crombolo types sync\` applies them here.`)
    return { wrote, removed, version: read.version }
  }
}
