import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { describeProvenance, signPath } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { confirm } from '../../support/prompt.ts'
import { applyToRemote, packed } from '../../support/remote-apply.ts'
import { restartRemote } from '../../support/restart.ts'
import { siteConfig } from '../../support/site.ts'
import { raiseVersionIfChanged } from '../../support/types.ts'

/** What git says is not committed under `dir`, or undefined when it is not a git checkout. */
function uncommitted(dir: string): string[] | undefined {
  if (!Bun.which('git'))
    throw new CliError('refused', 'git is not installed, so what is committed cannot be checked.', {
      hint: 'A deploy sends what the repository holds: run it where git is installed.',
    })
  const run = Bun.spawnSync(['git', 'status', '--porcelain', '--', '.'], {
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (run.exitCode !== 0) return undefined
  return run.stdout
    .toString()
    .split('\n')
    .filter((line) => line.trim() !== '')
}

/** A site directory, as committed, built and applied to a remote, which then restarts (story 241). */
export default class BundleDeploy extends BaseCommand {
  static override summary =
    'deploy a site directory to a remote: build, check, apply its structure, content and code, restart'
  static override description = [
    'Refuses a directory with changes git has not committed, so a remote only ever runs what the repository holds. Builds the site with its schema, views, styles and code, checks it on the remote, applies it, then restarts the remote and waits for the new server to be healthy.',
    'Anything outstanding in the check stops it before anything is written. Off a terminal, --yes is needed to go on. A restart that fails leaves the remote serving as it was, and prints the `bundle revert` that undoes the apply.',
    'It does not install or wire bundles: `crombolo bundle install <name> --wire`, a commit, then `crombolo bundle deploy`.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> bundle deploy --remote production',
    '<%= config.bin %> bundle deploy --remote production --yes --publish',
  ]
  static override args = {
    dir: Args.string({ description: 'the site directory; this one when left out' }),
  }
  static override flags = {
    remote: Flags.string({
      summary: 'the remote to deploy to',
      helpValue: '<name>',
      required: true,
    }),
    env: Flags.string({ summary: "the remote's environment", helpValue: '<id>' }),
    publish: Flags.boolean({ summary: 'publish what it applies' }),
    label: Flags.string({ summary: 'a label for the run', helpValue: '<text>' }),
    yes: Flags.boolean({ summary: "don't ask before applying" }),
    'no-restart': Flags.boolean({ summary: 'apply it and stop: `crombolo restart` makes it live' }),
    'public-log': Flags.boolean({
      summary:
        "sign from a private repository anyway: Sigstore's public log records its name, workflow, ref and commit",
    }),
    sign: Flags.boolean({
      summary:
        'sign it before sending, in GitHub Actions, for a remote that takes only signed bundles',
    }),
  }
  static override audit = { category: 'content', action: 'Deploy', entityType: 'Bundle' } as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    confirmationBypassArg: '--yes',
    outputFields: [
      { name: 'runId', type: 'string', nullable: true },
      { name: 'remote', type: 'string' },
      { name: 'restarted', type: 'boolean' },
      { name: 'counts', type: 'object' },
    ],
    errors: ['usage', 'auth', 'refused', 'not_found', 'unavailable', 'confirmation_required'],
    outcomes: ['blocked'],
  } as const

  async run() {
    const { args, flags } = await this.parse(BundleDeploy)
    const dir = resolve(args.dir ?? '.')
    const shown = relative(process.cwd(), dir) || '.'
    if (!existsSync(join(dir, 'schema')))
      throw new CliError('not_found', `${shown} has no schema/ directory, so it is not a site.`)
    const changes = uncommitted(dir)
    if (changes === undefined)
      throw new CliError('refused', `${shown} is not in a git repository.`, {
        hint: 'A deploy sends what is committed: commit the site, then deploy it.',
      })
    if (changes.length > 0)
      throw new CliError('refused', `${shown} has ${changes.length} change(s) not committed.`, {
        hint: 'Commit them, or set them aside, so the remote runs what the repository holds.',
        details: changes.slice(0, 20),
      })
    // The site itself, committed: a new version when its definitions changed under
    // this one (story 256), which is then a change to commit before deploying
    if (dir === resolve(process.cwd())) {
      const config = await siteConfig()
      const raised =
        resolve(config.schemaDir) === join(dir, 'schema')
          ? await raiseVersionIfChanged(this, config)
          : undefined
      if (raised)
        throw new CliError('refused', `The definitions are now at ${raised}, not yet committed.`, {
          hint: 'Commit that, then deploy again.',
        })
    }

    const base = {
      remote: flags.remote,
      env: flags.env,
      structure: true,
      publish: flags.publish,
      label: flags.label ?? 'deploy',
      resolve: [],
      'allow-missing-blobs': false,
      'no-schema': false,
      'no-files': false,
      'replace-files': true,
    }
    let bytes = await packed(dir, true)
    if (flags.sign) {
      const work = await mkdtemp(join(tmpdir(), 'crombolo-deploy-'))
      try {
        const file = join(work, 'bundle.tgz')
        await writeFile(file, bytes)
        const signed = await signPath(file, { publicLog: flags['public-log'] })
        this.say(`  ${describeProvenance({ state: 'signed', source: signed.source })}`)
        bytes = new Uint8Array(await readFile(file))
      } finally {
        await rm(work, { recursive: true, force: true })
      }
    }
    this.say(`Checking ${shown} on ${flags.remote}…`)
    const checked = await applyToRemote(this, dir, { ...base, 'dry-run': true }, bytes)
    if (checked.blocked) {
      this.outcome = 'blocked'
      this.changedNothing = true
      return { runId: null, remote: flags.remote, restarted: false, counts: checked.result.counts }
    }
    if (!flags.yes)
      await confirm(
        `\nApply it to ${flags.remote}${flags['no-restart'] ? '' : ' and restart'}? [y/N] `,
        {
          bypass: '--yes',
        },
      )

    this.say(`\nApplying…`)
    const applied = await applyToRemote(this, dir, base, bytes)
    const runId = applied.result.runId
    if (flags['no-restart'] || !runId)
      return { runId, remote: flags.remote, restarted: false, counts: applied.result.counts }

    this.say(`\nRestarting ${flags.remote}…`)
    const restart = await restartRemote(this, { remote: flags.remote, env: flags.env })
    if (!restart.ok)
      throw new CliError(
        'unavailable',
        `${flags.remote} did not restart: ${restart.reason ?? 'its new server did not start'}. It is still serving as before the restart, with run ${runId} applied but its code not running.`,
        { hint: `\`crombolo bundle revert ${runId} --remote ${flags.remote}\` undoes the apply.` },
      )
    this.say(`\nDeployed: run ${runId} is live on ${flags.remote}.`)
    return { runId, remote: flags.remote, restarted: true, counts: applied.result.counts }
  }
}
