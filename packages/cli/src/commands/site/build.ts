import { join, relative, resolve } from 'node:path'
import {
  buildBundleFromDirectory,
  describeProvenance,
  PUBLIC_WARNING_BYTES,
  signPackage,
} from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { describeBytes } from '../../support/describe.ts'
import { findingFields, writeSeedPackage } from '../../support/seed.ts'
import { signBuilt } from '../../support/signing.ts'
import { cwd, siteConfig } from '../../support/site.ts'
import { raiseVersionIfChanged } from '../../support/types.ts'
import { listTemplates } from '../../templates.ts'

export default class SiteBuild extends BaseCommand {
  static override summary =
    'a site package from a site directory: its schema, views, styles, content and code'
  static override description = [
    "Reads the directory's schema/, components/, css/, scripts/, public/ and content/, and builds its content against that schema in a throwaway database: no site or database of its own is needed. The bundle installs everything into a bare site in one transaction: `crombolo start --bundle <dir>`, or `site apply`.",
    '--check builds it and writes nothing: every problem in the content files, by file and line, an unknown type or property, a value its editor cannot take, a path that names nothing, a language the site has not got, a type its parent does not allow.',
    'The directory is the current one unless named; --template names a starter site the CLI ships instead.',
    'A site with server code of its own names it in its package.json, as globs in `crombolo.code`, or with --code here; the bundle then carries that code with package.json, bun.lock and crombolo.config.ts under code/. `site check-code` checks it against a CMS, and `bundle install <bundle> --code-into <dir>` installs it.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> site build sites/harbourstone --out ./harbourstone-bundle',
    '<%= config.bin %> site build --template demo/harbourstone --out ./harbourstone-bundle',
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
      summary: 'the directory to write it to',
      helpValue: '<dir>',
    }),
    check: Flags.boolean({ summary: 'build it, report its problems, and write nothing' }),
    'public-log': Flags.boolean({
      summary:
        "sign from a private repository anyway: Sigstore's public log records its name, workflow, ref and commit",
    }),
    'sign-with': Flags.string({
      summary: "sign it with this user key, as a CI job does, rather than the site's own",
      helpValue: '<key>',
    }),
    sign: Flags.boolean({
      summary: 'sign it once written, in GitHub Actions: `bundle sign` in the same step',
      exclusive: ['check'],
    }),
    name: Flags.string({ summary: "the site package's name", helpValue: '<name>' }),
    'with-media': Flags.boolean({
      summary: 'the media files too; left out unless asked',
    }),
    code: Flags.string({
      multiple: true,
      summary: "the site's own code, as globs; in place of crombolo.code in its package.json",
      helpValue: '<glob>',
    }),
  }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'id', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'out', type: 'string' },
      { name: 'nodes', type: 'integer' },
      { name: 'code', type: 'integer' },
      ...findingFields,
      {
        name: 'counts',
        type: 'object',
        fields: [
          { name: 'content', type: 'integer' },
          { name: 'library', type: 'integer' },
          { name: 'media', type: 'integer' },
        ],
      },
    ],
    errors: ['not_found', 'refused', 'usage'],
    outcomes: ['problems_found'],
  } as const

  async run() {
    const { args, flags } = await this.parse(SiteBuild)
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
    // This site, built to ship: a new version when its definitions changed under this one
    if (!flags.check && !flags.template && source === resolve(cwd())) {
      const config = await siteConfig()
      if (resolve(config.schemaDir) === join(source, 'schema'))
        await raiseVersionIfChanged(this, config)
    }
    const built = await buildBundleFromDirectory(source, {
      name: flags.name,
      code: flags.code,
      media: flags['with-media'],
    })
    const publicFiles = built.publicFiles ?? []
    const publicBytes = publicFiles.reduce((total, file) => total + file.size, 0)
    if (publicBytes > PUBLIC_WARNING_BYTES) {
      const largest = [...publicFiles]
        .sort((a, b) => b.size - a.size)
        .slice(0, 3)
        .map((file) => `${file.path} (${describeBytes(file.size)})`)
      this.warning(
        `  public/ adds ${describeBytes(publicBytes)} to the site package; the largest are ${largest.join(', ')}`,
      )
    }
    // --check reports the content files' findings by file and line, and writes nothing.
    if (flags.check && built.seed) {
      this.changedNothing = true
      const findings = built.seed.findings
      for (const finding of findings)
        this.say(`  ${finding.file}:${finding.line}  ${finding.message}`)
      const counts = built.seed.counts
      if (findings.length > 0) {
        this.say(`\n${findings.length} problem(s).`)
        this.outcome = 'problems_found'
      } else
        this.say(
          `  ${counts.content} page(s), ${counts.library} Library element(s), ${counts.media} media item(s): all good.`,
        )
      return {
        id: built.seed.set?.manifest.id ?? '',
        name: built.name,
        out: '',
        nodes: built.seed.set?.nodes.length ?? 0,
        code: built.code?.length ?? 0,
        findings,
        counts,
      }
    }
    if (built.problems.length > 0 || !built.files)
      throw new CliError(
        'refused',
        `${relative(process.cwd(), source) || '.'} cannot be built into a site package.`,
        {
          details: built.problems,
        },
      )
    if (!flags.out)
      throw new CliError('usage', 'Where to? Pass --out <dir>, or --check to write nothing.')
    const out = resolve(flags.out)
    writeSeedPackage({ ...(built.seed as NonNullable<typeof built.seed>), files: built.files }, out)
    const id = built.seed?.set?.manifest.id ?? ''
    const nodes = built.seed?.set?.nodes.length ?? 0
    this.say(
      `  wrote    ${relative(process.cwd(), out) || '.'}  (${built.name}: ${nodes} node(s), with its schema and views)`,
    )
    // With a key first: a Sigstore signature after it keeps it (story 316).
    this.say(`  ${await signBuilt(out, flags['sign-with'])}`)
    if (flags.sign) {
      const signed = await signPackage(out, { publicLog: flags['public-log'] }).catch(
        (error: unknown) => {
          throw new CliError(
            'refused',
            `It was built and not signed: ${error instanceof Error ? error.message : String(error)}`,
          )
        },
      )
      this.say(`  ${describeProvenance({ state: 'signed', source: signed.source })}`)
    }
    if (built.code)
      this.say(
        `  code     ${built.code.length} file(s); \`crombolo site check-code\` checks them, \`crombolo extension install <bundle> --code-into <dir>\` installs them`,
      )
    this.say(
      `\n  \`crombolo start --bundle ${relative(process.cwd(), out) || '.'} --publish\` installs it into a site.`,
    )
    return { id, name: built.name, out, nodes, code: built.code?.length ?? 0 }
  }
}
