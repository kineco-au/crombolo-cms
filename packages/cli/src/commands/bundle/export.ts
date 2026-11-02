import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { packageNameFor } from '@crombolo/transfer'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import * as ops from '../../operations/commands.ts'
import { exportContentFiles } from '../../support/content-files.ts'
import { counted, describeBytes, describeContentMode, here } from '../../support/describe.ts'
import { contentFlags, contentMode, many } from '../../support/flags.ts'
import { passphraseToSeal } from '../../support/prompt.ts'
import { siteConfig } from '../../support/site.ts'

export default class BundleExport extends BaseCommand {
  static override summary =
    'write a subtree as a private bundle package to move elsewhere, or as content files to edit'
  static override description = [
    'The subtree, its dependencies, and what the destination must already have.',
    "--source writes this site's content as the files `bundle apply` reads back instead: the pages named by --root and those below them into content/pages, or with --all every page, Library element and media item with its file. Values are written as a person would write them: rich text as { html }, pickers and links as paths, blocks as tables. A page keeps its key in its file, so applying the files again names the same pages.",
    'Names and the tree only, unless --include-content: values, media files (--with-media) and protected-page usernames, encrypted under a passphrase (asked for, or CROMBOLO_BUNDLE_PASSPHRASE). --allow-content-unencrypted writes them readable. --with-members and --with-users add people, always encrypted.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> bundle export --root /blog --out ./bundles/blog',
    '<%= config.bin %> bundle export --source --all',
  ]
  static override flags = {
    root: many('the subtree to export; repeatable', '<path|uuid>'),
    out: Flags.string({
      summary: 'the directory to write the package to',
      helpValue: '<dir>',
    }),
    source: Flags.boolean({ summary: "write this site's content files instead of a package" }),
    all: Flags.boolean({
      summary: 'with --source: every page, Library element and media item, with its file',
    }),
    only: Flags.boolean({ summary: 'the roots alone, not what is below them' }),
    drafts: Flags.boolean({ summary: 'drafts, not only what is published' }),
    'with-blueprints': Flags.boolean({ summary: 'the blueprints of its types' }),
    'with-media': Flags.boolean({ summary: 'with --include-content: the media files' }),
    'with-blobs': Flags.boolean({
      summary: 'the old name for --with-media',
      deprecated: { to: 'with-media' },
      hidden: true,
    }),
    'with-members': Flags.boolean({ summary: 'members, encrypted' }),
    'with-users': Flags.boolean({ summary: 'back-office users, encrypted' }),
    name: Flags.string({ summary: "the package's npm name", helpValue: '<npm name>' }),
    'package-version': Flags.string({ summary: "the package's version", helpValue: '<version>' }),
    ...contentFlags,
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'out', type: 'string' },
      { name: 'package', type: 'object' },
      { name: 'bundleId', type: 'string' },
      { name: 'counts', type: 'object' },
      { name: 'expected', type: 'array', items: { type: 'object' } },
      { name: 'content', type: 'string', enum: ['omitted', 'sealed', 'open'] },
      { name: 'blobs', type: 'object' },
      { name: 'written', type: 'array', items: { type: 'string' } },
    ],
    errors: ['usage', 'not_found', 'refused', 'auth'],
  } as const

  async run() {
    const { flags } = await this.parse(BundleExport)
    if (flags.source) {
      const { written } = await exportContentFiles(this, flags.root, flags.all)
      return { written }
    }
    if (flags.root.length === 0) this.fail('usage', 'bundle export needs --root <path|uuid>.')
    if (!flags.out) this.fail('usage', 'bundle export needs --out <dir>.')
    const out = flags.out as string
    const content = contentMode(this, flags)
    const result = await ops.contentExport(await siteConfig(), {
      content,
      roots: flags.root,
      only: flags.only,
      drafts: flags.drafts,
      withBlobs: flags['with-media'] || flags['with-blobs'],
      withMembers: flags['with-members'],
      withUsers: flags['with-users'],
      passphrase:
        content === 'sealed' || flags['with-members'] || flags['with-users']
          ? await passphraseToSeal()
          : undefined,
      withBlueprints: flags['with-blueprints'],
      // An export is a private package; without --name it is named for its directory.
      package: {
        name: flags.name ?? packageNameFor(basename(resolve(out))),
        version: flags['package-version'],
      },
    })
    for (const key of result.blobs.missing)
      this.warning(`  missing  ${key} is not in this environment's media store`)
    for (const file of result.files) {
      const target = join(out, file.path)
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, file.bytes ?? (file.text as string))
    }
    if (Object.keys(result.counts).length === 0)
      this.fail(
        'not_found',
        'Nothing was selected, so the package is empty.',
        'Check the --root values.',
      )
    this.say(`  wrote    ${here(out)}`)
    this.say(`  package  ${result.package.name}@${result.package.version} (private)`)
    this.say(
      `  bundle   ${result.bundleId} (${result.snapshot}): ${counted(result.counts, 'nothing selected')}`,
    )
    if (result.expected.length > 0) {
      this.say(`  expects  ${result.expected.length} node(s) to exist at the destination:`)
      for (const e of result.expected) this.say(`    ${e.key}  ${e.name}  (${e.why})`)
    }
    describeContentMode(this, result.content, result.people)
    if (result.blobs.carried > 0)
      this.say(
        `  blobs    ${result.blobs.carried} media file(s), ${describeBytes(result.blobs.bytes)}`,
      )
    else if (result.blobs.notCarried > 0)
      this.say(
        `  blobs    ${result.blobs.notCarried} media file(s) are not carried — pass --with-media to include them`,
      )
    return {
      out: here(out),
      package: result.package,
      bundleId: result.bundleId,
      counts: result.counts,
      expected: result.expected,
      content: result.content,
      blobs: result.blobs,
    }
  }
}
