import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isDirectory,
  readPackageJson,
  SITE_PACKAGE_NOT_INSTALLED,
  validateBundlePackage,
} from '@crombolo/backoffice-host/registry'
import { extractTarball } from '@crombolo/server'
import { loadBundle } from '@crombolo/transfer'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'

/** Whether a package is an extension this CMS takes (story 306), hand-written ones included. */
export default class BundleCheck extends BaseCommand {
  static override summary = 'check an extension package before publishing or installing it'
  static override description =
    'Reads its package.json and, when it carries content, its bundle.json and every file they list, as an install would: what it says it is, its manifest, and that nothing changed since it was built. A site package is refused: it is applied with `crombolo site apply`, never installed. Nothing is installed or written.'
  static override examples = [
    '<%= config.bin %> bundle check ./acme-kit',
    '<%= config.bin %> bundle check ./acme-kit-1.0.0.tgz',
  ]
  static override args = {
    bundle: Args.string({ required: true, description: 'the package directory or .tgz' }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [
      { name: 'name', type: 'string', nullable: true },
      { name: 'problems', type: 'array', items: { type: 'string' } },
    ],
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    const { args } = await this.parse(BundleCheck)
    this.changedNothing = true
    if (!existsSync(args.bundle)) this.fail('not_found', `${args.bundle} does not exist.`)
    if (isDirectory(args.bundle)) return this.#check(args.bundle)
    const into = await mkdtemp(join(tmpdir(), 'crombolo-bundle-check-'))
    try {
      await extractTarball(args.bundle, into)
      return await this.#check(existsSync(join(into, 'package')) ? join(into, 'package') : into)
    } finally {
      await rm(into, { recursive: true, force: true })
    }
  }

  async #check(dir: string) {
    const json = readPackageJson(join(dir, 'package.json'))
    if (!json) this.fail('not_found', 'It has no package.json, so it is not a package.')
    const field = json.crombolo as { bundleType?: unknown; content?: unknown } | undefined
    const problems =
      field?.bundleType === 'site' ? [SITE_PACKAGE_NOT_INSTALLED] : validateBundlePackage(json, dir)
    if (problems.length === 0 && field?.content === true)
      problems.push(
        ...loadBundle(dir).problems.map((problem) => `${problem.file}: ${problem.message}`),
      )
    if (problems.length > 0)
      this.fail(
        'refused',
        `${json.name ?? 'It'} is not an extension this site takes.`,
        undefined,
        problems,
      )
    this.say(`  ${json.name}@${json.version} is an extension this site takes.`)
    return { name: json.name ?? null, problems: [] }
  }
}
