import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  extensionDialogProblems,
  readPackageJson,
  validateBundlePackage,
} from '@crombolo/backoffice-host/registry'
import { buildAhead, extensionEventNameProblems, VERSION } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { cwd, siteConfigAt } from '../support/site.ts'

/** The image a crombolo version runs in (story 087). */
export const IMAGE = 'ghcr.io/kineco-au/crombolo'

/**
 * A site's packages installed, and checked as a start would take them (story 087): its
 * crombolo the CLI's own, every extension one this site runs, and what a start builds built.
 */
export default class Install extends BaseCommand {
  static override summary = "install the site's packages, and check it will start"
  static override description = [
    "Installs what the site's package.json names, with Bun's installer, then checks it as a start would: that its @crombolo/crombolo is this CLI's own version, that every extension among its packages is one this site runs, and that its views and back-office screens build.",
    'In an image built on the crombolo image, a site that would not start fails the build instead of its first start.',
  ].join('\n\n')
  static override examples = ['<%= config.bin %> install', '<%= config.bin %> install --production']
  static override flags = {
    production: Flags.boolean({ summary: 'leave the development dependencies out' }),
  }
  static override access = 'none' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'version', type: 'string', description: "the site's crombolo" },
      { name: 'extensions', type: 'array', items: { type: 'string' } },
    ],
    errors: ['not_found', 'refused', 'usage'],
  } as const

  async run() {
    const { flags } = await this.parse(Install)
    const dir = cwd()
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest))
      this.fail('not_found', 'There is no package.json here, so this is not a site.')
    const json = JSON.parse(readFileSync(manifest, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const range = json.dependencies?.['@crombolo/crombolo']
    if (!range)
      this.fail('refused', 'The site does not depend on @crombolo/crombolo, so it cannot run.')
    if (!Bun.semver.satisfies(VERSION, range))
      this.fail(
        'refused',
        `The site asks for @crombolo/crombolo ${range}, and this is ${VERSION}.`,
        `Build on ${IMAGE}:${range.replace(/^[\^~=]/, '')}, or change the site's package.json to ${VERSION}.`,
      )

    const installed = Bun.spawnSync(
      ['bun', 'install', ...(flags.production ? ['--production'] : [])],
      { cwd: dir, stdout: 'inherit', stderr: 'inherit' },
    )
    if (installed.exitCode !== 0) this.fail('refused', 'The packages could not be installed.')
    const own = readPackageJson(join(dir, 'node_modules', '@crombolo', 'crombolo', 'package.json'))
    if (own?.version !== VERSION)
      this.fail(
        'refused',
        `@crombolo/crombolo ${own?.version ?? '(none)'} was installed, and this is ${VERSION}.`,
        `Pin it to ${VERSION} in the site's package.json.`,
      )

    const extensions: string[] = []
    const problems: string[] = []
    for (const name of Object.keys(json.dependencies ?? {})) {
      const at = join(dir, 'node_modules', name)
      const pkg = readPackageJson(join(at, 'package.json'))
      const field = pkg?.crombolo as { bundleType?: unknown } | undefined
      if (!pkg || field?.bundleType !== 'extension') continue
      extensions.push(name)
      for (const problem of [
        ...validateBundlePackage(pkg, at),
        ...extensionDialogProblems(at),
        ...extensionEventNameProblems(at),
      ])
        problems.push(`${name}: ${problem}`)
    }
    if (problems.length > 0)
      this.fail(
        'refused',
        'An extension the site installs is one it would not run.',
        undefined,
        problems,
      )

    const built = await buildAhead(await siteConfigAt(dir))
    if (built.length > 0)
      this.fail('refused', 'The site would not start as it is.', undefined, built)
    this.say(
      `  installed  the site, on crombolo ${VERSION}${extensions.length > 0 ? `, with ${extensions.join(', ')}` : ''}; it builds.`,
    )
    return { version: VERSION, extensions }
  }
}
