import { basename, resolve } from 'node:path'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField } from '../../support/workspace-commands.ts'

export default class ChangesStage extends BaseCommand {
  static override summary =
    "stage a site bundle, or a site's checkout, into a workspace there as a change, measured from its source's last merge"
  static override description = [
    "The site works out what changed since the source's base, what was merged from it last, and stages that into the workspace, three ways against Shared, to be looked at and merged there. It never merges.",
    'The first staging from a source names its base: --base now for the site as it is, or --base <change key> for the site as that change left it. Nothing is deleted unless --prune.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> changes stage ./site --into "CI" --source ci/main --base now --profile riverside --env staging',
    '<%= config.bin %> changes stage site.tgz --into "CI" --source ci/main --dry-run',
  ]
  static override args = {
    path: Args.string({
      description: "a site bundle (.tgz or its folder), or a site's checkout",
      required: true,
    }),
  }
  static override flags = {
    ...siteFlags,
    into: Flags.string({
      summary: 'the workspace it goes into, by name or key; one by that name is opened if none is',
      required: true,
      helpValue: '<workspace>',
    }),
    source: Flags.string({
      summary:
        'where it comes from, as the site remembers it: its base is what was last merged from here',
      required: true,
      helpValue: '<name>',
    }),
    base: Flags.string({
      summary: "what it is measured from the first time: now, or a change's key",
      helpValue: 'now|<change>',
    }),
    prune: Flags.boolean({
      summary: 'delete what the base had and it lacks, each accepted by name at the merge',
    }),
    'dry-run': Flags.boolean({ summary: 'say what staging it would do, and stage nothing' }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      whereField,
      { name: 'workspace', type: 'string', nullable: true },
      { name: 'pages', type: 'array', items: { type: 'object' } },
      { name: 'files', type: 'array', items: { type: 'object' } },
      { name: 'conflicts', type: 'array', items: { type: 'object' } },
      { name: 'leftOut', type: 'array', items: { type: 'string' } },
    ],
    outcomes: ['conflicts_found'],
    errors: ['usage', 'auth', 'not_found', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ChangesStage)
    const { siteBundleBytes } = await import('../../support/site-bundle.ts')
    const path = resolve(args.path)
    let bytes: Uint8Array
    try {
      bytes = siteBundleBytes(path, basename(path))
    } catch (error) {
      this.fail('usage', error instanceof Error ? error.message : String(error))
    }
    if (flags['dry-run']) this.changedNothing = true
    return onSite(this, flags, undefined, async (site) => {
      const query = new URLSearchParams({
        source: flags.source,
        into: flags.into,
        ...(flags.base ? { base: flags.base } : {}),
        ...(flags.prune ? { prune: 'true' } : {}),
        ...(flags['dry-run'] ? { check: 'true' } : {}),
      })
      const answered = await site.call('PUT', `changes/from-site?${query}`, bytes, {
        'content-type': 'application/gzip',
        'crombolo-sha256': new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
      })
      const body = (await answered.json().catch(() => ({}))) as {
        workspace?: string | null
        pages?: Array<{ name: string; action: string }>
        files?: Array<{ path: string; class: string }>
        conflicts?: Array<{ says: string }>
        leftOut?: string[]
        title?: string
        message?: string
        detail?: string
      }
      if (!answered.ok && answered.status !== 409)
        this.fail(
          answered.status === 404 ? 'not_found' : 'refused',
          [body.title ?? body.message ?? `It answered ${answered.status}.`, body.detail]
            .filter(Boolean)
            .join(' '),
        )
      for (const p of body.pages ?? []) this.say(`  page  ${p.action.padEnd(7)} ${p.name}`)
      for (const f of body.files ?? []) this.say(`  file  ${f.path} (${f.class})`)
      for (const c of body.conflicts ?? []) this.say(`  conflict  ${c.says}`)
      if ((body.leftOut ?? []).length > 0)
        this.say(`  left out: ${(body.leftOut ?? []).join(', ')}`)
      if ((body.conflicts ?? []).length > 0) this.outcome = 'conflicts_found'
      this.say(
        flags['dry-run']
          ? '  Nothing was staged: without --dry-run it is.'
          : `  staged into ${flags.into}${body.workspace ? ` (${body.workspace})` : ''}`,
      )
      return {
        workspace: body.workspace ?? null,
        pages: body.pages ?? [],
        files: body.files ?? [],
        conflicts: body.conflicts ?? [],
        leftOut: body.leftOut ?? [],
      }
    })
  }
}
