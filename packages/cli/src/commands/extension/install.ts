import { relative, resolve } from 'node:path'
import {
  createMarketplace,
  describeProvenance,
  installBundleCode,
  loadConfig,
  userKeyOf,
} from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'

/** `--delegate-to` as a grant stores it; the CLI has no user of its own (story 325). */
const delegateOf = (value: string | undefined): string | null => {
  if (!value) return null
  const key = userKeyOf(value)
  if (!key) throw new CliError('usage', `--delegate-to is a user's key, not "${value}".`)
  return key
}

import {
  cliActor,
  confirmLevel,
  grantGaps,
  parseSpec,
  remoteBundles,
  withLocalBundles,
} from '../../support/bundles.ts'

const RESTART = 'Not live until `crombolo restart'

/** A remote's bundles are its own; reading the registry needs none of this machine's. */
const NO_EXTENSIONS = {
  list: () => [],
  bundles: () => ({ bundles: [], problems: [] }),
  invalidate: () => {},
}

export default class ExtensionInstall extends BaseCommand {
  static override summary = 'add an extension to this site, or a remote, as a dependency'
  static override description = [
    "What Install does in Settings, under Extensions: `bun add` in a root of its own, extensions/<id>/, recorded in crombolo.extensions.json, never in the site's package.json; then the content the bundle carries with --apply-content. A bundle with server code names every permission it asks for with --grant, or nothing is installed: a newer version that asks for more is refused until the script grants it.",
    "An extension runs once it is granted what it asks for: --grant names every permission, exactly. Nothing is imported into crombolo.config.ts; to grant it from the site's code, list it under `extensions` there. Installed code runs after `crombolo restart`.",
    'On a remote it needs CROMBOLO_REMOTE_ACCESS=all, "Change a site\'s structure and code" and "Install code on this site", which administrators have only when a group gives it to them.',
    "--code-into installs a site package's own code into an empty directory, ready for a host to start it: the argument is then the site package's directory.",
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> extension install @acme/crm --grant content.read --grant members.read',
    '<%= config.bin %> extension install @acme/crm@2.1.0 --grant documents.read --remote production',
    '<%= config.bin %> extension install ./acme-site-bundle --code-into /srv/sites/acme',
  ]
  static override args = {
    bundle: Args.string({
      required: true,
      description:
        'a package name, name@version, a packed .tgz, or with --code-into a site package',
    }),
  }
  static override flags = {
    grant: Flags.string({
      multiple: true,
      summary: 'a permission it asks for; name every one',
      helpValue: '<permission>',
    }),
    'delegate-to': Flags.string({
      summary: 'with user.delegate: the user a job or an event acts for when nobody is using it',
      helpValue: '<user key>',
    }),
    'apply-content': Flags.boolean({ summary: 'apply the content it carries too' }),
    layout: Flags.string({
      summary: "the site's layout its page templates sit in",
      helpValue: '<component>',
    }),
    wire: Flags.boolean({
      summary: 'retired: an extension runs once granted, with nothing imported',
      hidden: true,
    }),
    'code-into': Flags.string({
      summary: "install a site package's own code into this empty directory",
      helpValue: '<dir>',
      exclusive: ['remote', 'wire', 'grant', 'apply-content'],
    }),
    remote: Flags.string({ summary: 'install it on this remote instead', helpValue: '<name>' }),
    env: Flags.string({ summary: "with --remote: the remote's environment", helpValue: '<id>' }),
    'dry-run': Flags.boolean({ summary: 'say what it would install and grant; install nothing' }),
  }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string', nullable: true },
      { name: 'restartPending', type: 'boolean' },
      { name: 'wired', type: 'boolean' },
      { name: 'remote', type: 'string', nullable: true },
      { name: 'dir', type: 'string', nullable: true },
      { name: 'files', type: 'integer', nullable: true },
    ],
    errors: ['refused', 'usage', 'auth', 'not_found', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ExtensionInstall)
    if (flags['code-into']) return this.#codeInto(args.bundle, flags['code-into'])
    // Story 310: nothing is wired any more.
    if (flags.wire)
      throw new CliError(
        'usage',
        '--wire is gone: an extension runs once it is granted, with nothing imported.',
        {
          hint: "Grant it with --grant, or list it under `extensions` in crombolo.config.ts with what the site's code grants it.",
        },
      )
    const spec = parseSpec(args.bundle)
    if (spec.file && flags.remote)
      throw new CliError('usage', 'A remote installs from the package registry, not a file here.')
    const grant = flags.grant ?? []
    if (!flags['dry-run']) await confirmLevel((line) => this.say(line), spec.name, grant)

    // Read first, so a grant that does not match refuses before anything lands.
    const inspected = spec.file
      ? undefined
      : flags.remote
        ? await createMarketplace({
            ...registryOf(),
            extensions: NO_EXTENSIONS,
            siteDir: process.cwd(),
          }).inspect(spec.name, spec.version)
        : await withLocalBundles((admin) => admin.inspect(spec.name, spec.version))
    if (inspected && !inspected.ok) throw new CliError('refused', inspected.message)
    if (inspected?.ok && inspected.server) this.#refuseGaps(spec.name, inspected.permissions, grant)
    if (flags['dry-run']) {
      this.changedNothing = true
      this.say(
        `  would install ${spec.name}${spec.version ? `@${spec.version}` : ''}${flags.remote ? ` on ${flags.remote}` : ''}`,
      )
      if (inspected?.ok) this.say(`  signed   ${describeProvenance(inspected.provenance)}`)
      if (inspected?.ok && inspected.server)
        this.say(
          `  granting ${inspected.permissions.join(', ') || 'nothing'}; ${RESTART.toLowerCase()}\``,
        )
      return {
        name: spec.name,
        version: spec.version ?? null,
        restartPending: false,
        wired: false,
        remote: flags.remote ?? null,
        dir: null,
        files: null,
      }
    }

    if (flags.remote) {
      const remote = await remoteBundles(flags.remote, flags.env)
      const outcome = await remote.install({
        name: spec.name,
        version: spec.version,
        grant,
        applyContent: flags['apply-content'],
        delegateTo: delegateOf(flags['delegate-to']),
        ...(flags.layout ? { settings: { layout: flags.layout } } : {}),
      })
      if (outcome.provenance) this.say(`  signed   ${describeProvenance(outcome.provenance)}`)
      this.say(`  ${outcome.message}`)
      if (outcome.restartPending) this.say(`  ${RESTART} --remote ${remote.name}\`.`)
      return {
        name: spec.name,
        version: outcome.dependency?.version ?? spec.version ?? null,
        restartPending: outcome.restartPending === true,
        wired: false,
        remote: remote.name,
        dir: null,
        files: null,
      }
    }

    return withLocalBundles(async (admin, _siteDir) => {
      const outcome = await admin.install(cliActor(), {
        name: spec.file ?? spec.name,
        version: spec.version,
        file: Boolean(spec.file),
        applyContent: flags['apply-content'],
        grant,
        delegateTo: delegateOf(flags['delegate-to']),
        ...(flags.layout ? { settings: { layout: flags.layout } } : {}),
      })
      if (!outcome.ok) {
        if (outcome.needsGrant)
          this.#refuseGaps(
            spec.name,
            (outcome.permissions ?? []).map((p) => p.permission),
            grant,
          )
        throw new CliError('refused', outcome.message)
      }
      if (outcome.provenance) this.say(`  signed   ${describeProvenance(outcome.provenance)}`)
      this.say(`  ${outcome.message}`)
      if (outcome.content) this.say(`  ${outcome.content.message}`)
      const name = outcome.dependency?.name ?? spec.name
      const wired = false
      if (outcome.restartPending) this.say(`  ${RESTART}\`.`)
      return {
        name,
        version: outcome.dependency?.version ?? spec.version ?? null,
        restartPending: outcome.restartPending === true || wired,
        wired,
        remote: null,
        dir: null,
        files: null,
      }
    })
  }

  /** A grant must name exactly what the bundle asks for (story 222). */
  #refuseGaps(name: string, asked: readonly string[], granted: readonly string[]) {
    const { missing, extra } = grantGaps(asked, granted)
    if (missing.length === 0 && extra.length === 0) return
    throw new CliError(
      'refused',
      `${name} runs code on the server and asks for ${asked.length > 0 ? asked.join(', ') : 'nothing'}. Nothing was installed.`,
      {
        hint: `Name every permission it asks for: ${asked.map((p) => `--grant ${p}`).join(' ') || 'no --grant'}.`,
        details: [
          ...missing.map((p) => `not granted: ${p}`),
          ...extra.map((p) => `not asked for: ${p}`),
        ],
      },
    )
  }

  async #codeInto(bundle: string, dir: string) {
    const target = resolve(dir)
    const result = await installBundleCode(resolve(bundle), target)
    if (result.problems.length > 0)
      throw new CliError('refused', 'The code was not installed.', { details: result.problems })
    this.say(`  installed  ${result.files} file(s) into ${relative(process.cwd(), target) || '.'}`)
    this.say('  Start it, or restart the site, to wire its server bundles.')
    return {
      name: bundle,
      version: null,
      restartPending: false,
      wired: false,
      remote: null,
      dir: target,
      files: result.files,
    }
  }
}

/** The registry a remote install is read from before it is sent: this machine's setting. */
function registryOf() {
  const config = loadConfig({}, process.cwd())
  return {
    registry: config.npmRegistry,
    keyword: config.packageKeyword,
    marketplaceUrl: config.marketplaceUrl,
  }
}
