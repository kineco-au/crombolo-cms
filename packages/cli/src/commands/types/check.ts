import { loadValueMigrations, validateSchemaSet } from '@crombolo/schema'
import { componentAliasesIn, formTypesFor, schemaFilesIn } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { findingsOf, type ProblemOut, problemsOf } from '../../support/describe.ts'
import { hostedSchema, type SchemaDifference, schemaDiff } from '../../support/hosted-schema.ts'
import { type Io, siteConfig } from '../../support/site.ts'
import { loadTypes, needSchemaDir, staticProblems, upgradeCheck } from '../../support/types.ts'

export default class TypesCheck extends BaseCommand {
  static override summary =
    "check the site's definitions, and what applying them would do to this database"
  static override description = [
    '--static checks the files alone, with no database: the check for a pull request. Exits 20 when it finds problems, 21 when a finding needs a person.',
    '--against lists each definition only in the files, only on that hosted site, or different between them, and a version that differs. Exits 20 when they differ; changes neither.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> types check',
    '<%= config.bin %> types check --static',
    '<%= config.bin %> types check --against production',
  ]
  static override aliases = ['schema:check']
  static override deprecateAliases = true
  static override flags = {
    static: Flags.boolean({ summary: 'validate the files only, no database' }),
    against: Flags.string({
      summary: "list where a hosted site's definitions differ from the files, changing neither",
      helpValue: '<profile>',
      exclusive: ['static'],
    }),
    env: Flags.string({
      summary: "the --against site's environment",
      helpValue: '<id>',
      dependsOn: ['against'],
    }),
  }
  static override access = 'site' as const
  static override section = 'settings' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [
      { name: 'version', type: 'string' },
      {
        name: 'counts',
        type: 'object',
        fields: [
          { name: 'contentTypes', type: 'integer' },
          { name: 'mediaTypes', type: 'integer' },
          { name: 'dataTypes', type: 'integer' },
          { name: 'languages', type: 'integer' },
        ],
      },
      { name: 'problems', type: 'array', items: { type: 'object' } },
      { name: 'classification', type: 'string', nullable: true },
      { name: 'findings', type: 'array', items: { type: 'object' } },
      {
        name: 'against',
        type: 'object',
        nullable: true,
        description: 'with --against: the site, its version, and each definition that differs',
      },
    ],
    errors: ['not_found', 'usage', 'refused', 'unavailable', 'auth'],
    outcomes: ['problems_found', 'blocked'],
  } as const

  async run() {
    const { flags } = await this.parse(TypesCheck)
    const config = await siteConfig()
    needSchemaDir(config)
    const loaded = loadTypes(config)
    const counts = {
      contentTypes: loaded.set.contentTypes.length,
      mediaTypes: (loaded.set.mediaTypes ?? []).length,
      dataTypes: loaded.set.dataTypes.length,
      languages: loaded.set.languages.length,
    }
    const result = {
      version: loaded.set.version,
      counts,
      problems: [] as Array<ProblemOut | { text: string; message: string }>,
      classification: null as string | null,
      findings: [] as ReturnType<typeof findingsOf>,
      against: null as Against | null,
    }
    result.problems = problemsOf(
      [
        ...loaded.problems,
        ...validateSchemaSet(loaded.set, {
          componentAliases: componentAliasesIn(config.componentsDir),
          types: formTypesFor(config),
        }),
      ],
      config.schemaDir,
    )
    if (result.problems.length > 0) {
      this.say(`${result.problems.length} problem(s):`)
      for (const problem of result.problems) this.say(`  ${problem.text}`)
      this.outcome = 'problems_found'
      return result
    }
    this.say(
      `schema ${loaded.set.version}: ${counts.contentTypes} content type(s), ${counts.mediaTypes} media type(s), ${counts.dataTypes} data type(s), ${counts.languages} language(s) — valid`,
    )
    if (flags.against) {
      result.against = await against(this, config, flags.against, flags.env)
      if (result.against.differences.length > 0 || result.against.version !== loaded.set.version)
        this.outcome = 'problems_found'
      return result
    }
    if (flags.static) {
      result.problems = staticProblems(loaded, await loadValueMigrations(config.schemaDir)).map(
        (text) => ({ text, message: text }),
      )
      for (const issue of result.problems) this.say(`  ${issue.text}`)
      if (result.problems.length > 0) this.outcome = 'problems_found'
      return result
    }
    // The same check an upgrade runs, over the site's own diff.
    const report = await upgradeCheck(this, config, {})
    result.classification = report.classification
    result.findings = findingsOf(report.findings)
    if (report.blocking) this.outcome = 'blocked'
    return result
  }
}

interface Against {
  site: string
  version: string
  differences: SchemaDifference[]
}

const WORDS: Record<SchemaDifference['change'], string> = {
  'only-here': 'only here ',
  'only-there': 'only there',
  differs: 'different ',
}

/** Where a hosted site's definitions and the files differ (story 374). */
async function against(
  io: Io,
  config: Awaited<ReturnType<typeof siteConfig>>,
  site: string,
  env: string | undefined,
): Promise<Against> {
  const hosted = await hostedSchema(site, env, '--against', 'schema-files')
  const read = await hosted.files()
  const differences = schemaDiff(
    schemaFilesIn(config.schemaDir),
    new Map(Object.entries(read.files)),
  )
  const version = loadTypes(config).set.version
  if (differences.length === 0 && version === read.version)
    io.say(`${site} has the same definitions as the files.`)
  else {
    io.say(`${site} and the files differ:`)
    for (const { path, change } of differences) io.say(`  ${WORDS[change]}  ${path}`)
    if (version !== read.version) io.say(`  version     ${version} here, ${read.version} there`)
  }
  return { site, version: read.version, differences }
}
