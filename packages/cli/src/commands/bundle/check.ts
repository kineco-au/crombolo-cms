import { relative, resolve } from 'node:path'
import { checkBundleCode } from '@crombolo/server'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'

/** A bundle's code against this CMS (story 192): what `install-code` would install, and why it would not run. */
export default class BundleCheck extends BaseCommand {
  static override summary = "check a bundle's code against this CMS"
  static override description = [
    'Installs the code in a throwaway directory from its own bun.lock, running no install scripts and leaving the @crombolo packages to this CMS. Every bundle package the site declares has to be written for this version, and nothing installed may carry an @crombolo package of its own.',
    "None of the site's code is run, its crombolo.config.ts included, so the server bundles it wires are checked when the host first starts it. Every problem is listed, not the first. Nothing is written.",
  ].join('\n\n')
  static override examples = ['<%= config.bin %> bundle check ./natures-calendar-bundle']
  static override args = {
    bundle: Args.string({ required: true, description: 'the bundle package directory' }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [
      { name: 'bundle', type: 'string' },
      { name: 'files', type: 'integer' },
      { name: 'serverBundles', type: 'array', items: { type: 'string' } },
      { name: 'problems', type: 'array', items: { type: 'string' } },
    ],
    errors: ['refused'],
  } as const

  async run() {
    const { args } = await this.parse(BundleCheck)
    const dir = resolve(args.bundle)
    const shown = relative(process.cwd(), dir) || '.'
    this.progress(`  checking ${shown}: installing its code from its lockfile`)
    const result = await checkBundleCode(dir)
    if (result.problems.length > 0)
      throw new CliError('refused', `The code in ${shown} cannot run on this CMS.`, {
        details: result.problems,
      })
    this.say(`  code     ${result.files} file(s), installed from its lockfile`)
    this.say(
      `  carries  ${result.serverBundles.length > 0 ? result.serverBundles.join(', ') : 'no server bundles'}`,
    )
    this.say(`\n  \`crombolo bundle install-code ${shown} <dir>\` installs it.`)
    return { bundle: dir, files: result.files, serverBundles: result.serverBundles, problems: [] }
  }
}
