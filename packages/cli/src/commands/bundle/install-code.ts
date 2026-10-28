import { relative, resolve } from 'node:path'
import { installBundleCode } from '@crombolo/server'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'

/** A bundle's code, installed where a host starts it (story 192). */
export default class BundleInstallCode extends BaseCommand {
  static override summary = "install a bundle's code into a directory, ready to start"
  static override description = [
    "Copies the code into an empty directory and installs it from its own bun.lock, running no install scripts. The @crombolo packages are left out: the CMS that runs the site provides them, so the directory has to be somewhere they resolve from, beneath that CMS's node_modules.",
    "Starting it, or restarting a running site so its server bundles are wired, is the host's step. `content import` installs the bundle's content, and leaves its code alone.",
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> bundle install-code ./natures-calendar-bundle /srv/sites/natures-calendar',
  ]
  static override args = {
    bundle: Args.string({ required: true, description: 'the bundle package directory' }),
    dir: Args.string({ required: true, description: 'an empty directory to install into' }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'dir', type: 'string' },
      { name: 'files', type: 'integer' },
    ],
    errors: ['refused'],
  } as const

  async run() {
    const { args } = await this.parse(BundleInstallCode)
    const target = resolve(args.dir)
    const result = await installBundleCode(resolve(args.bundle), target)
    if (result.problems.length > 0)
      throw new CliError('refused', 'The code was not installed.', { details: result.problems })
    this.say(`  installed  ${result.files} file(s) into ${relative(process.cwd(), target) || '.'}`)
    this.say('  Start it, or restart the site, to wire its server bundles.')
    return { dir: target, files: result.files }
  }
}
