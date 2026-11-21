import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField, workspaceArg } from '../../support/workspace-commands.ts'

export default class WorkspaceRender extends BaseCommand {
  static override summary =
    'one page of a workspace’s site: whether it rendered, and its error if not'
  static override examples = ['<%= config.bin %> workspace render "Spring sale" /offers']
  static override args = {
    workspace: workspaceArg,
    path: Args.string({ required: true, description: 'the page’s address on the site' }),
  }
  static override flags = { ...siteFlags, html: Flags.boolean({ summary: 'print the page too' }) }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [
      whereField,
      { name: 'status', type: 'string' },
      { name: 'error', type: 'string', nullable: true },
      { name: 'html', type: 'string', nullable: true },
    ],
    outcomes: ['problems_found'],
    errors: ['usage', 'auth', 'not_found'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspaceRender)
    return onSite(this, flags, args.workspace, async (site, chosen) => {
      const result = await site.json<{ status: string; error?: string; html?: string }>(
        'GET',
        `workspaces/${chosen?.key}/render?path=${encodeURIComponent(args.path)}`,
      )
      this.say(`  ${result.status}${result.error ? `: ${result.error}` : ''}`)
      if (flags.html && result.html) this.say(result.html)
      if (result.status === 'error') this.outcome = 'problems_found'
      return { status: result.status, error: result.error ?? null, html: result.html ?? null }
    })
  }
}
