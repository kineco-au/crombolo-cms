import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describeProvenance } from '@crombolo/server'
import { RESOLUTIONS_FILE, writeResolutions } from '@crombolo/transfer'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import * as ops from '../../operations/commands.ts'
import {
  describeBundle,
  describePlaced,
  findingsOf,
  here,
  printSections,
  printSitePackage,
  printTransferFindings,
} from '../../support/describe.ts'
import { backupTaken, dryRun, transferFlags, transferInput } from '../../support/flags.ts'
import { passphraseToOpen } from '../../support/prompt.ts'
import { applyToRemote } from '../../support/remote-apply.ts'
import { buildSeed, refuseFindings, withSeedPackage } from '../../support/seed.ts'
import { siteConfig } from '../../support/site.ts'

export default class SiteApply extends BaseCommand {
  static override summary =
    'apply a site package here or to a remote: checked, backed up, one transaction'
  static override description = [
    "The site package is a package directory or a .tgz. It replaces what it carries: this site's code, config and dependencies among them, which the check lists first. This site's own directory, the default, means its content files: content/pages, content/library and content/media, built first. An extension is installed with `crombolo extension install`, not applied.",
    'Applying again is three-way: a change only the package made is taken, one made only here is kept, and one made in both needs --resolve. An unchanged package changes nothing. `site revert <run>` puts it back.',
    '--dry-run says what it would do and changes nothing; with --save it writes the answers given into the package. --remote applies it on a remote site instead, which checks and applies it there.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> site apply --publish',
    '<%= config.bin %> site apply ./acme-bundle --dry-run',
    '<%= config.bin %> site apply --remote production --publish',
  ]
  static override args = {
    bundle: Args.string({
      description: "a site package's directory or .tgz, or `.` for this site's content files",
    }),
  }
  static override flags = {
    ...transferFlags,
    label: Flags.string({ summary: 'a label for the run', helpValue: '<text>' }),
    'backup-taken': backupTaken,
    'dry-run': dryRun,
    save: Flags.boolean({ summary: 'with --dry-run: write the answers into the package' }),
    remote: Flags.string({ summary: 'apply it on this remote instead', helpValue: '<name>' }),
    env: Flags.string({ summary: "with --remote: the remote's environment", helpValue: '<id>' }),
    structure: Flags.boolean({
      summary:
        'with --remote, from a site directory: send its schema, views, styles and code too, not its content alone',
    }),
  }
  static override audit = { category: 'content', action: 'Import', entityType: 'Bundle' } as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'runId', type: 'string', nullable: true },
      { name: 'bundle', type: 'object', nullable: true },
      { name: 'counts', type: 'object' },
      { name: 'findings', type: 'array', items: { type: 'object' } },
      { name: 'outstanding', type: 'integer' },
      { name: 'backup', type: 'string', nullable: true },
      { name: 'published', type: 'integer' },
      { name: 'saved', type: 'string', nullable: true },
      { name: 'remote', type: 'string', nullable: true },
    ],
    errors: ['refused', 'auth', 'usage', 'not_found', 'unavailable'],
    outcomes: ['blocked'],
  } as const

  async run() {
    const { args, flags } = await this.parse(SiteApply)
    if (flags.remote) {
      const sent = await applyToRemote(this, args.bundle ?? '.', flags)
      if (sent.dryRun) this.changedNothing = true
      if (sent.blocked) this.outcome = 'blocked'
      return sent.result
    }
    const config = await siteConfig()
    const source = args.bundle ?? '.'
    // This site's own directory is its content files, built first.
    if (resolve(source) === resolve(config.siteDir)) {
      const build = await buildSeed()
      refuseFindings(build)
      return withSeedPackage(build, (dir) =>
        this.#apply(config, dir, {
          ...flags,
          local: true,
          'no-schema': true,
          'no-files': true,
          'replace-files': false,
          label: flags.label ?? 'content files',
        }),
      )
    }
    return this.#apply(config, source, flags)
  }

  async #apply(
    config: Awaited<ReturnType<typeof siteConfig>>,
    bundle: string,
    flags: Parameters<typeof transferInput>[1] & {
      label?: string
      'backup-taken'?: boolean
      'dry-run'?: boolean
      save?: boolean
      /** The site's own content files, built here (story 060). */
      local?: boolean
    },
  ) {
    const input = {
      ...transferInput(bundle, flags),
      passphrase: await passphraseToOpen(bundle, config, {
        withoutPeople: flags['exclude-people'],
      }),
    }
    const vouch = flags.local ? ({ vouchedBy: 'site' } as const) : undefined
    if (flags['dry-run']) {
      this.changedNothing = true
      const result = await ops.contentCheck(config, input, vouch)
      for (const problem of result.problems) this.warning(`  ${problem}`)
      printSitePackage(this, result.sitePackage)
      describeBundle(this, result.bundle)
      this.say(`  signed   ${describeProvenance(result.provenance)}`)
      if (result.under) this.say(`  under    ${result.under}`)
      printSections(this, result.sections)
      if (result.code.length > 0)
        this.say(
          `  code     ${result.code.length} file(s) would change; live after \`crombolo restart\``,
        )
      printTransferFindings(this, result.check)
      for (const refusal of result.publishRefusals)
        this.say(`  would not publish  ${refusal.key}: ${refusal.reason}`)
      let saved: string | null = null
      if (flags.save) {
        const target = join(result.payloadDir, RESOLUTIONS_FILE)
        await writeFile(
          target,
          writeResolutions({
            bundleId: result.bundle.id,
            under: flags.under ?? null,
            all: result.decisions.all,
            byNode: result.decisions.byNode,
          }),
        )
        saved = here(target)
        this.say(`  wrote    ${saved}`)
      }
      const c = result.check.counts
      this.say(
        `\n  would    ${c.create} create, ${c.update} update, ${c.unchanged} unchanged, ${c.skip} skip`,
      )
      if (result.clean) this.say('  Nothing outstanding: it would apply cleanly.')
      else {
        this.say(
          `  ${result.check.outstanding.length} finding(s) would stop it. Resolve them, or pass --resolve.`,
        )
        this.outcome = 'blocked'
      }
      return {
        runId: null,
        bundle: result.bundle,
        counts: c,
        findings: findingsOf(result.check.findings),
        outstanding: result.check.outstanding.length,
        backup: null,
        published: 0,
        saved,
        remote: null,
      }
    }

    const result = await ops.contentImport(
      config,
      {
        ...input,
        publish: flags.publish,
        label: flags.label,
        backupTaken: flags['backup-taken'],
      },
      vouch,
    )
    for (const problem of result.problems) this.warning(`  ${problem}`)
    if (result.backup.path) this.progress(`  backup   ${result.backup.path}`)
    describeBundle(this, result.bundle)
    if (result.provenance) this.say(`  signed   ${describeProvenance(result.provenance)}`)
    if (!result.runId) {
      printTransferFindings(this, result.check)
      // Staged, then applied in one transaction: a refusal leaves nothing behind.
      this.fail(
        'refused',
        `apply refused: ${result.check.outstanding.length || result.problems.length} finding(s) outstanding. Nothing was written.`,
        'Resolve them with --resolve, or see them with --dry-run.',
        findingsOf(result.check.outstanding),
      )
    }
    const c = result.check.counts
    this.say(`  run      ${result.runId}`)
    this.say(
      `  applied  ${c.create} created, ${c.update} updated, ${c.unchanged} unchanged, ${c.skip} skipped`,
    )
    const placed = describePlaced(result.blobs)
    if (placed) this.say(`  blobs    ${placed}`)
    if (result.sections) {
      this.say(
        `  files    ${result.sections.written.length} written` +
          (result.sections.replaced.length > 0
            ? `, ${result.sections.replaced.length} replaced`
            : ''),
      )
      if (result.sections.schema) this.say(`  schema   ${result.sections.schema.action}`)
      if (result.sections.dictionary)
        this.say(`  dict     ${result.sections.dictionary.imported} imported`)
      if (result.replacedFilesKept)
        this.say(`  kept     ${here(result.replacedFilesKept)}  (the files it replaced)`)
    }
    if (result.code)
      this.say(
        `  code     ${result.code.written.length} file(s) installed${result.code.installed ? ', dependencies installed' : ''}; live after \`crombolo restart\``,
      )
    if (result.published > 0) this.say(`  published ${result.published} node(s)`)
    for (const failure of result.publishFailures)
      this.warning(`  not published  ${failure.key}: ${failure.reason}`)
    for (const finding of result.check.findings.filter((f) => f.kind === 'auto'))
      this.say(`  [auto    ] ${finding.message}`)
    this.say(`\nDone. \`crombolo site revert ${result.runId}\` puts it back.`)
    return {
      runId: result.runId,
      bundle: result.bundle,
      counts: c,
      findings: findingsOf(result.check.findings),
      outstanding: 0,
      backup: result.backup.path ?? null,
      published: result.published,
      saved: null,
      remote: null,
    }
  }
}
