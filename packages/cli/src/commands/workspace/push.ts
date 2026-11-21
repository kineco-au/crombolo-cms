import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { workSite } from '../../support/work-site.ts'
import { onSite, siteFlags, whereField, workspaceArg } from '../../support/workspace-commands.ts'

export default class WorkspacePush extends BaseCommand {
  static override summary =
    'send a workspace from here to a workspace on another site, where it is looked at and merged; it never merges'
  static override examples = [
    '<%= config.bin %> workspace push "Spring sale" --to riverside --to-env production --yes',
  ]
  static override args = { workspace: workspaceArg }
  static override flags = {
    ...siteFlags,
    to: Flags.string({
      summary: 'the site it goes to, by its profile',
      required: true,
      helpValue: '<name>',
    }),
    'to-env': Flags.string({ summary: 'its environment', helpValue: '<id>' }),
    yes: Flags.boolean({ summary: 'send it, rather than only saying what it holds' }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    confirmationBypassArg: '--yes',
    outputFields: [
      whereField,
      { name: 'to', type: 'string' },
      { name: 'workspace', type: 'string', nullable: true },
      { name: 'conflicts', type: 'array', items: { type: 'object' } },
    ],
    outcomes: ['conflicts_found'],
    errors: ['usage', 'auth', 'not_found', 'refused', 'confirmation_required'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspacePush)
    return onSite(this, flags, args.workspace, async (site, chosen) => {
      const taken = await site.call('GET', `workspaces/${chosen?.key}/change`)
      if (!taken.ok)
        this.fail('refused', `The workspace could not be taken: it answered ${taken.status}.`)
      const bytes = new Uint8Array(await taken.arrayBuffer())
      const there = await workSite({ profile: flags.to, env: flags['to-env'] })
      try {
        this.say(`  → ${there.where()}`)
        if (!flags.yes) {
          const checked = (await (
            await there.call('PUT', 'changes?check=true', bytes, {
              'content-type': 'application/gzip',
              'crombolo-sha256': taken.headers.get('crombolo-sha256') ?? '',
            })
          ).json()) as {
            pages?: Array<{ name: string; action: string }>
            files?: Array<{ path: string; class: string }>
          }
          for (const p of checked.pages ?? []) this.say(`  page  ${p.action.padEnd(7)} ${p.name}`)
          for (const f of checked.files ?? []) this.say(`  file  ${f.path} (${f.class})`)
          this.say('  Nothing was sent: --yes sends it.')
          this.changedNothing = true
          return { to: there.where(), workspace: null, conflicts: [] }
        }
        const staged = await there.call('PUT', 'changes?stage=true', bytes, {
          'content-type': 'application/gzip',
          'crombolo-sha256': taken.headers.get('crombolo-sha256') ?? '',
        })
        const body = (await staged.json()) as {
          workspace: string | null
          conflicts: Array<{ says: string }>
        }
        for (const c of body.conflicts ?? []) this.say(`  conflict  ${c.says}`)
        if ((body.conflicts ?? []).length > 0) this.outcome = 'conflicts_found'
        this.say(
          `  sent: a workspace there holds it${body.workspace ? ` (${body.workspace})` : ''}`,
        )
        return { to: there.where(), workspace: body.workspace, conflicts: body.conflicts ?? [] }
      } finally {
        await there.close()
      }
    })
  }
}
