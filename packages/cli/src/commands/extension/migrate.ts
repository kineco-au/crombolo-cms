import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  isDirectory,
  readPackageJson,
  validateBundlePackage,
} from '@crombolo/backoffice-host/registry'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { applyMigration, planMigration } from '../../support/extension-migrate.ts'

/** A schema 4 extension rewritten to schema 5's layout (story 320). */
export default class ExtensionMigrate extends BaseCommand {
  static override summary = "rewrite an extension's package to the layout this release takes"
  static override description =
    'Moves its server code under src/server/ and its back-office code, plugin/ and whatever its manifest names, under src/backoffice/, and rewrites its manifest, exports and files to match. Back-office code runs as whoever is signed in, so it asks for backoffice.code, whose reason --reason gives. A file both halves use is named, and nothing moves. Its signature no longer matches, so provenance.json is removed: sign it again before publishing.'
  static override examples = [
    '<%= config.bin %> extension migrate ./acme-seo --dry-run',
    '<%= config.bin %> extension migrate ./acme-seo --reason "Shows the SEO report in Settings"',
  ]
  static override args = {
    dir: Args.string({ required: true, description: "the extension's package directory" }),
  }
  static override flags = {
    reason: Flags.string({
      summary: 'why its back-office code is needed, shown when it is installed',
      helpValue: '<text>',
    }),
    'dry-run': Flags.boolean({ summary: 'say what would move, and write nothing' }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'moves', type: 'array', items: { type: 'object' } },
      { name: 'asksForBackOfficeCode', type: 'boolean' },
      { name: 'dropsSignature', type: 'boolean' },
    ],
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ExtensionMigrate)
    if (!existsSync(args.dir) || !isDirectory(args.dir))
      this.fail('not_found', `${args.dir} is not a package directory.`)
    const plan = planMigration(args.dir, { reason: flags.reason })
    if (plan.problems.length > 0)
      this.fail(
        'refused',
        `${args.dir} was not migrated, and nothing moved.`,
        undefined,
        plan.problems,
      )
    for (const move of plan.moves) this.say(`  move     ${move.from} → ${move.to}`)
    for (const rewrite of plan.imports)
      this.say(`  import   ${rewrite.file}: ${rewrite.from} → ${rewrite.to}`)
    if (plan.asksForBackOfficeCode)
      this.say(`  asks     backoffice.code: "${flags.reason?.trim()}"`)
    if (plan.delegates)
      this.say(
        `  asks     user.delegate in place of actAs: it acts for the person using it${plan.delegates.dropped.length > 0 ? `, which reaches ${plan.delegates.dropped.join(', ')} already` : ''}; an administrator grants it again`,
      )
    for (const alias of plan.couldBeScreens ?? [])
      this.say(
        `  could be ${alias}: its back-office code could be a screen its server half describes, which needs no backoffice.code (docs/extensions.md, "Screens")`,
      )
    if (plan.dropsSignature)
      this.say(
        '  signed   no longer: provenance.json is removed, so sign it again before publishing',
      )
    if (flags['dry-run']) {
      this.changedNothing = true
      this.say('  Nothing was written: this was a dry run.')
    } else {
      applyMigration(args.dir, plan)
      const json = readPackageJson(join(args.dir, 'package.json'))
      const problems = json ? validateBundlePackage(json, args.dir) : ['it has no package.json']
      if (problems.length > 0)
        this.fail(
          'refused',
          'It was migrated, and is still not an extension this site takes.',
          undefined,
          problems,
        )
      this.say(`  ${json?.name}@${json?.version} is migrated: publish it again.`)
    }
    return {
      moves: plan.moves,
      asksForBackOfficeCode: plan.asksForBackOfficeCode,
      dropsSignature: plan.dropsSignature,
    }
  }
}
