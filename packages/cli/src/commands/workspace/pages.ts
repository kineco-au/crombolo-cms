import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField, workspaceArg } from '../../support/workspace-commands.ts'

export default class WorkspacePages extends BaseCommand {
  static override summary =
    'each page a workspace affects: its address, whether it rendered, and how long it took'
  static override examples = ['<%= config.bin %> workspace pages "Spring sale" --failing']
  static override args = { workspace: workspaceArg }
  static override flags = {
    ...siteFlags,
    failing: Flags.boolean({ summary: 'only those that did not render' }),
    all: Flags.boolean({ summary: 'every affected page, not a sample per type and template' }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [whereField, { name: 'items', type: 'array', items: { type: 'object' } }],
    errors: ['usage', 'auth', 'not_found'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspacePages)
    return onSite(this, flags, args.workspace, async (site, chosen) => {
      const query = [flags.failing ? 'failing=true' : '', flags.all ? 'all=true' : '']
        .filter(Boolean)
        .join('&')
      const { items } = await site.json<{
        items: Array<{ url: string | null; ok: boolean; ms: number; status: string; name: string }>
      }>('GET', `workspaces/${chosen?.key}/pages${query ? `?${query}` : ''}`)
      for (const p of items)
        this.say(
          `  ${p.ok ? 'ok  ' : 'FAIL'}  ${String(p.url ?? p.name).padEnd(40)} ${p.status} ${p.ms} ms`,
        )
      if (items.some((p) => !p.ok)) this.outcome = 'problems_found'
      return { items }
    })
  }
}
