import { join, relative, resolve } from 'node:path'
import { buildBundleFromDirectory } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { writeSeedPackage } from '../../support/seed.ts'
import { listTemplates } from '../../templates.ts'

export default class BundleBuild extends BaseCommand {
  static override summary = 'a bundle from a site directory: its schema, views, styles and seed'
  static override description = [
    "Reads the directory's schema/, components/, css/, scripts/ and seed/, and compiles the seed against that schema in a throwaway database: no site or database of its own is needed. The bundle installs everything into a bare site in one transaction: `crombolo start --bundle <dir>`, or `content import`.",
    'The directory is the current one unless named; --template names a starter site the CLI ships instead.',
  ].join('\n\n')
  static override aliases = ['seed:build']
  static override deprecateAliases = true
  static override examples = [
    '<%= config.bin %> bundle build sites/harbourstone --out ./harbourstone-bundle',
    '<%= config.bin %> bundle build --template demo/harbourstone --out ./harbourstone-bundle',
  ]
  static override args = {
    dir: Args.string({ description: 'the site directory; this one when left out' }),
  }
  static override flags = {
    template: Flags.string({
      summary: 'a starter site the CLI ships, instead of a directory',
      helpValue: '<id>',
      exclusive: ['dir'],
    }),
    out: Flags.string({
      required: true,
      summary: 'the directory to write it to',
      helpValue: '<dir>',
    }),
    name: Flags.string({ summary: "the bundle's package name", helpValue: '<name>' }),
  }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'id', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'out', type: 'string' },
      { name: 'nodes', type: 'integer' },
    ],
    errors: ['not_found', 'refused', 'usage'],
  } as const

  async run() {
    const { args, flags } = await this.parse(BundleBuild)
    let source = resolve(args.dir ?? process.cwd())
    if (flags.template) {
      const templates = listTemplates()
      const found = templates.find((t) => t.id === flags.template)
      if (!found)
        throw new CliError('not_found', `There is no starter site "${flags.template}".`, {
          hint: `Name one of: ${templates.map((t) => t.id).join(', ')}.`,
        })
      source = join(found.dir, 'files')
    }
    const built = await buildBundleFromDirectory(source, { name: flags.name })
    if (built.problems.length > 0 || !built.files)
      throw new CliError(
        'refused',
        `${relative(process.cwd(), source) || '.'} cannot be built into a bundle.`,
        {
          hint: built.seed
            ? '`crombolo seed check` in that directory lists what is wrong.'
            : undefined,
          details: built.problems,
        },
      )
    const out = resolve(flags.out)
    writeSeedPackage({ ...(built.seed as NonNullable<typeof built.seed>), files: built.files }, out)
    const id = built.seed?.set?.manifest.id ?? ''
    const nodes = built.seed?.set?.nodes.length ?? 0
    this.say(
      `  wrote    ${relative(process.cwd(), out) || '.'}  (${built.name}: ${nodes} node(s), with its schema and views)`,
    )
    this.say(
      `\n  \`crombolo start --bundle ${relative(process.cwd(), out) || '.'} --publish\` installs it into a site.`,
    )
    return { id, name: built.name, out, nodes }
  }
}
