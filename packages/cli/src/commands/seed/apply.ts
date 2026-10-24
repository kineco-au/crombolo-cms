import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import * as ops from '../../operations/commands.ts'
import { findingsOf, printTransferFindings } from '../../support/describe.ts'
import { backupTaken, dryRun, transferInput } from '../../support/flags.ts'
import { buildSeed, refuseFindings, seedResolveFlags, withSeedPackage } from '../../support/seed.ts'
import { siteConfig } from '../../support/site.ts'

export default class SeedApply extends BaseCommand {
  static override summary = 'apply seed/ to this site, through the same import as a bundle'
  static override description = [
    'Built from the files, checked, backed up and applied in one transaction; `content revert <run>` puts it back. Applying an unchanged seed changes nothing.',
    'Against what the last apply left: a change only the seed made is taken, one made only in the back office is kept, and one made in both needs --resolve. --publish publishes what the seed does not mark `published = false`.',
  ].join('\n\n')
  static override flags = {
    ...seedResolveFlags,
    publish: Flags.boolean({ summary: 'publish what it applies' }),
    'dry-run': dryRun,
    'backup-taken': backupTaken,
  }
  static override audit = { category: 'content', action: 'Import', entityType: 'Bundle' } as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'runId', type: 'string', nullable: true },
      {
        name: 'counts',
        type: 'object',
        fields: [
          { name: 'create', type: 'integer' },
          { name: 'update', type: 'integer' },
          { name: 'unchanged', type: 'integer' },
          { name: 'skip', type: 'integer' },
        ],
      },
      { name: 'published', type: 'integer' },
      { name: 'findings', type: 'array', items: { type: 'object' } },
    ],
    errors: ['refused'],
  } as const

  async run() {
    const { flags } = await this.parse(SeedApply)
    const build = await buildSeed()
    refuseFindings(build)
    const config = await siteConfig()
    return withSeedPackage(build, async (dir) => {
      const input = {
        ...transferInput(dir, {
          resolve: flags.resolve,
          'resolve-all': flags['resolve-all'],
          'allow-missing-blobs': false,
          publish: flags.publish,
          'no-schema': true,
          'no-files': true,
          'replace-files': false,
        }),
        passphrase: undefined,
      }
      if (flags['dry-run']) {
        this.changedNothing = true
        const result = await ops.contentCheck(config, input)
        printTransferFindings(this, result.check)
        const c = result.check.counts
        this.say(
          `\n  would    ${c.create} create, ${c.update} update, ${c.unchanged} unchanged, ${c.skip} skip`,
        )
        if (!result.clean)
          this.say(`  ${result.check.outstanding.length} finding(s) would stop it: --resolve them.`)
        return {
          runId: null,
          counts: c,
          published: 0,
          findings: findingsOf(result.check.findings),
        }
      }
      const result = await ops.contentImport(config, {
        ...input,
        publish: flags.publish,
        label: 'seed',
        backupTaken: flags['backup-taken'],
      })
      for (const problem of result.problems) this.warning(`  ${problem}`)
      if (result.backup.path) this.progress(`  backup   ${result.backup.path}`)
      if (!result.runId) {
        printTransferFindings(this, result.check)
        this.fail(
          'refused',
          `seed refused: ${result.check.outstanding.length || result.problems.length} finding(s) outstanding. Nothing was written.`,
          'Resolve them with --resolve, or see them with --dry-run.',
          findingsOf(result.check.outstanding),
        )
      }
      const c = result.check.counts
      for (const finding of result.check.findings.filter((f) => f.kind === 'auto'))
        this.say(`  [auto    ] ${finding.message}`)
      this.say(`  applied  ${c.create} created, ${c.update} updated, ${c.unchanged} unchanged`)
      if (result.published > 0) this.say(`  published ${result.published} node(s)`)
      for (const failure of result.publishFailures)
        this.warning(`  not published  ${failure.key}: ${failure.reason}`)
      this.say(`\nDone. \`crombolo content revert ${result.runId}\` puts it back.`)
      return {
        runId: result.runId,
        counts: c,
        published: result.published,
        findings: findingsOf(result.check.findings),
      }
    })
  }
}
