import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField } from '../../support/workspace-commands.ts'

export default class ChangesCheck extends BaseCommand {
  static override summary =
    'check what the site shares as a whole: every page the changes since one affect, and its views’ problems'
  static override description =
    'With --since, the pages checked are those changed by every change after that one, and a sample per changed type and view. With none, or --all, every published page is rendered. No more than 500 pages are rendered in one check; the rest are counted.'
  static override examples = [
    '<%= config.bin %> changes check --since 6f1c… --profile riverside --env staging',
    '<%= config.bin %> changes check --all',
  ]
  static override flags = {
    ...siteFlags,
    since: Flags.string({ summary: 'the change to check from, by its id', helpValue: '<change>' }),
    all: Flags.boolean({ summary: 'render every published page' }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [
      whereField,
      { name: 'ok', type: 'boolean' },
      { name: 'since', type: 'string', nullable: true },
      { name: 'upTo', type: 'string', nullable: true },
      { name: 'changes', type: 'integer' },
      { name: 'pages', type: 'array', items: { type: 'object' } },
      { name: 'failures', type: 'array', items: { type: 'object' } },
      {
        name: 'notChecked',
        type: 'array',
        items: {
          type: 'object',
          description: '{ kind, item, why, says }: what the check did not look at',
        },
      },
    ],
    outcomes: ['problems_found'],
    errors: ['usage', 'auth', 'not_found'],
  } as const

  async run() {
    const { flags } = await this.parse(ChangesCheck)
    return onSite(this, flags, undefined, async (site) => {
      const result = await site.json<{
        ok: boolean
        since: string | null
        upTo: string | null
        changes: number
        pages: Array<{ url: string | null; ok: boolean; ms: number; status: string }>
        failures: Array<{ kind: string; item: string; says: string }>
        notChecked: Array<{ kind: string; item: string; why: string; says: string }>
      }>('POST', 'changes/check', { since: flags.since, all: flags.all })
      for (const p of result.pages)
        this.say(`  ${p.ok ? 'ok  ' : 'FAIL'}  ${String(p.url).padEnd(40)} ${p.ms} ms`)
      for (const f of result.failures) this.say(`  ${f.kind}  ${f.item}  ${f.says}`)
      for (const n of result.notChecked) this.say(`  not checked: ${n.says}`)
      if (!result.ok) this.outcome = 'problems_found'
      return result
    })
  }
}
