import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { packageNameFor } from '@crombolo/transfer'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import * as ops from '../../operations/commands.ts'
import { counted, describeBytes, describeContentMode, here } from '../../support/describe.ts'
import { contentFlags, contentMode, many } from '../../support/flags.ts'
import { passphraseToSeal } from '../../support/prompt.ts'
import { siteConfig } from '../../support/site.ts'

/** The site as a site package (stories 104, 306): all of it in one file, or a subtree. */
export default class SiteExport extends BaseCommand {
  static override summary =
    'write the site as a site package, to move it to another machine or host, or a subtree of it'
  static override description = [
    'Schema, components, styles, scripts, dictionary, every page and media item and their files. Domains and people stay behind unless --with-members or --with-users, which are encrypted.',
    "The site's own data, and that of its extensions, stays behind unless --with-site-data, which is encrypted.",
    '--anonymise replaces every personal value as it writes. Site data travels only as its anonymise rules allow: a table without one travels empty.',
    '--subtree writes the pages below a path instead, their dependencies, and what the destination must already have, as a package directory. Names and the tree only, unless --include-content: values, media files (--with-media) and protected-page usernames, encrypted under a passphrase (asked for, or CROMBOLO_BUNDLE_PASSPHRASE). --allow-content-unencrypted writes them readable.',
    'A site package is applied with `crombolo site apply`, never installed: it replaces what it carries.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> site export --out site.tgz',
    '<%= config.bin %> site export --subtree /blog --out ./packages/blog',
  ]
  static override flags = {
    out: Flags.string({
      summary: 'the file to write; with --subtree, the directory',
      helpValue: '<file.tgz|dir>',
    }),
    subtree: many('a subtree to export instead of the whole site; repeatable', '<path|uuid>'),
    only: Flags.boolean({ summary: 'with --subtree: the roots alone, not what is below them' }),
    'with-blueprints': Flags.boolean({ summary: 'with --subtree: the blueprints of its types' }),
    'with-media': Flags.boolean({ summary: 'the media files too; left out unless asked' }),
    drafts: Flags.boolean({ summary: 'drafts too' }),
    'with-members': Flags.boolean({ summary: 'members, encrypted' }),
    'with-users': Flags.boolean({ summary: 'back-office users, encrypted' }),
    'with-site-data': Flags.boolean({
      summary: "the site's and its extensions' own data, encrypted",
    }),
    anonymise: Flags.boolean({ summary: 'replace every personal value as it writes' }),
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
      { name: 'counts', type: 'object' },
      { name: 'sections', type: 'object', nullable: true },
      { name: 'media', type: 'object', nullable: true },
      { name: 'people', type: 'object', nullable: true },
      { name: 'anonymised', type: 'integer', nullable: true },
      {
        name: 'siteData',
        type: 'object',
        nullable: true,
        description: 'tables and rows carried; emptied names the tables that travelled empty',
      },
      { name: 'bundleId', type: 'string', nullable: true },
      { name: 'expected', type: 'array', items: { type: 'object' }, nullable: true },
      { name: 'content', type: 'string', enum: ['omitted', 'sealed', 'open'], nullable: true },
      { name: 'blobs', type: 'object', nullable: true },
    ],
    errors: ['usage', 'not_found', 'refused', 'auth', 'io'],
  } as const

  async run() {
    const { flags } = await this.parse(SiteExport)
    if (flags.subtree.length > 0) {
      if (!flags.out) this.fail('usage', 'site export --subtree needs --out <dir>.')
      const out = flags.out as string
      const content = contentMode(this, flags)
      const result = await ops.contentExport(await siteConfig(), {
        content,
        roots: flags.subtree,
        only: flags.only,
        drafts: flags.drafts,
        withBlobs: flags['with-media'],
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
          'Check the --subtree values.',
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
    const config = await siteConfig()
    const withPeople = flags['with-members'] || flags['with-users']
    const out = resolve(
      flags.out ??
        `${packageNameFor(`${config.siteName}-site`)}-${new Date().toISOString().slice(0, 10)}.tgz`,
    )
    const result = await ops.siteExport(config, {
      out,
      media: flags['with-media'],
      drafts: flags.drafts,
      withMembers: flags['with-members'],
      withUsers: flags['with-users'],
      withSiteData: flags['with-site-data'],
      anonymise: flags.anonymise,
      passphrase:
        (withPeople && !(flags.anonymise && !flags['with-members'])) || flags['with-site-data']
          ? await passphraseToSeal()
          : undefined,
      package: { name: flags.name, version: flags['package-version'] },
    })
    this.say(`  wrote    ${here(result.out)}`)
    this.say(`  package  ${result.package.name}@${result.package.version} (private)`)
    this.say(`  content  ${counted(result.counts, 'none')}, unencrypted`)
    if (Object.keys(result.sections).length > 0) this.say(`  files    ${counted(result.sections)}`)
    if (result.media.omitted)
      this.say(
        '  media    left out: importing it brings the media items without their files; pass --with-media to include them',
      )
    else
      this.say(`  media    ${result.media.carried} file(s), ${describeBytes(result.media.bytes)}`)
    for (const key of result.media.missing)
      this.warning(`  missing  ${key} is not in this environment's media store`)
    if (result.people.members + result.people.users > 0)
      this.say(
        `  people   ${result.people.members} member(s), ${result.people.users} user(s), encrypted`,
      )
    else this.say('  people   left out: pass --with-members or --with-users to bring them')
    if (result.siteData) {
      this.say(
        `  site data  ${result.siteData.tables} table(s), ${result.siteData.rows} row(s), encrypted`,
      )
      for (const table of result.siteData.emptied)
        this.say(`  emptied  ${table}: no anonymise rule lets it travel`)
    }
    if (result.anonymised !== undefined)
      this.say(
        `  anonymised  ${result.anonymised} email address(es) replaced; no back-office users`,
      )
    return {
      out: here(result.out),
      package: result.package,
      counts: result.counts,
      sections: result.sections,
      media: result.media,
      people: result.people,
      anonymised: result.anonymised ?? null,
      siteData: result.siteData ?? null,
    }
  }
}
