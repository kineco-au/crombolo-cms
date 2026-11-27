import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { workSite } from '../../support/work-site.ts'
import { onSite, siteFlags, whereField, workspaceArg } from '../../support/workspace-commands.ts'

export default class WorkspaceDiff extends BaseCommand {
  static override summary =
    'how a workspace differs: from Shared (what a merge changes), from where it began, or from another environment'
  static override examples = [
    '<%= config.bin %> workspace diff "Spring sale"',
    '<%= config.bin %> workspace diff "Spring sale" --against base',
    '<%= config.bin %> workspace diff "Spring sale" --against production --to riverside',
  ]
  static override args = { workspace: workspaceArg }
  static override flags = {
    ...siteFlags,
    against: Flags.string({
      summary: 'shared, base, or an environment of the site --to names',
      default: 'shared',
      helpValue: 'shared|base|<env>',
    }),
    to: Flags.string({
      summary: 'the profile of the site --against <env> is on',
      helpValue: '<name>',
    }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [
      whereField,
      { name: 'against', type: 'string' },
      { name: 'pages', type: 'array', items: { type: 'object' } },
      { name: 'files', type: 'array', items: { type: 'object' } },
      { name: 'conflicts', type: 'array', items: { type: 'object' } },
    ],
    errors: ['usage', 'auth', 'not_found', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspaceDiff)
    return onSite(this, flags, args.workspace, async (site, chosen) => {
      if (flags.against === 'shared' || flags.against === 'base') {
        const diff = await site.json<{
          pages: Array<{ name: string; fields: Array<{ field: string }> }>
          files: Array<{ path: string }>
        }>('GET', `workspaces/${chosen?.key}/diff?against=${flags.against}`)
        for (const p of diff.pages)
          for (const f of p.fields) this.say(`  page  ${p.name}  ${f.field.split('|')[0]}`)
        for (const f of diff.files) this.say(`  file  ${f.path}`)
        return { against: flags.against, pages: diff.pages, files: diff.files, conflicts: [] }
      }
      // What applying it to another environment would do: checked there, changing nothing.
      const taken = await site.call('GET', `workspaces/${chosen?.key}/change`)
      if (!taken.ok) this.fail('refused', `The workspace could not be taken: ${taken.status}.`)
      const bytes = new Uint8Array(await taken.arrayBuffer())
      const there = await workSite({ profile: flags.to, env: flags.against })
      try {
        const checked = await there.call('PUT', 'changes?check=true', bytes, {
          'content-type': 'application/gzip',
          'crombolo-sha256': taken.headers.get('crombolo-sha256') ?? '',
        })
        const body = (await checked.json()) as {
          pages: Array<{ name: string; action: string }>
          files: Array<{ path: string }>
          conflicts: Array<{ says: string }>
        }
        for (const p of body.pages ?? []) this.say(`  page  ${p.action.padEnd(7)} ${p.name}`)
        for (const f of body.files ?? []) this.say(`  file  ${f.path}`)
        for (const c of body.conflicts ?? []) this.say(`  conflict  ${c.says}`)
        if ((body.conflicts ?? []).length > 0) this.outcome = 'conflicts_found'
        return {
          against: there.where(),
          pages: body.pages ?? [],
          files: body.files ?? [],
          conflicts: body.conflicts ?? [],
        }
      } finally {
        await there.close()
      }
    })
  }
}
