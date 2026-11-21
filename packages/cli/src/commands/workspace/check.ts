import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField, workspaceArg } from '../../support/workspace-commands.ts'

export default class WorkspaceCheck extends BaseCommand {
  static override summary =
    'every check before a merge: each changed page rendered, a sample per changed type and template, every file’s problems'
  static override examples = [
    '<%= config.bin %> workspace check "Spring sale"',
    '<%= config.bin %> workspace check "Spring sale" --all',
  ]
  static override args = { workspace: workspaceArg }
  static override flags = {
    ...siteFlags,
    all: Flags.boolean({ summary: 'render every affected page, not a sample' }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [
      whereField,
      { name: 'ok', type: 'boolean' },
      { name: 'pages', type: 'array', items: { type: 'object' } },
      { name: 'failures', type: 'array', items: { type: 'object' } },
      { name: 'notChecked', type: 'array', items: { type: 'string' } },
    ],
    outcomes: ['problems_found'],
    errors: ['usage', 'auth', 'not_found'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspaceCheck)
    return onSite(this, flags, args.workspace, async (site, chosen) => {
      const result = await site.json<{
        ok: boolean
        pages: Array<{ url: string | null; ok: boolean; ms: number; status: string }>
        failures: Array<{ kind: string; item: string; says: string }>
        notChecked: string[]
      }>('POST', `workspaces/${chosen?.key}/check`, { all: flags.all })
      for (const p of result.pages)
        this.say(
          `  ${p.ok ? 'ok  ' : 'FAIL'}  ${String(p.url ?? '(not published)').padEnd(40)} ${p.ms} ms`,
        )
      for (const f of result.failures) this.say(`  ${f.kind}  ${f.item}  ${f.says}`)
      for (const n of result.notChecked) this.say(`  not checked: ${n}`)
      if (!result.ok) this.outcome = 'problems_found'
      return result
    })
  }
}
