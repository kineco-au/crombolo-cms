import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { workSite, workspaceNamed } from '../../support/work-site.ts'
import { onSite, siteFlags, whereField } from '../../support/workspace-commands.ts'

const gz = (sha: string) => ({ 'content-type': 'application/gzip', 'crombolo-sha256': sha })

export default class WorkspacePull extends BaseCommand {
  static override summary =
    'bring changes from another site: those merged there that this site lacks, or one of its workspaces to work on here'
  static override examples = [
    '<%= config.bin %> workspace pull --from riverside --from-env production --yes',
    '<%= config.bin %> workspace pull "Spring sale" --from riverside --from-env production --yes',
  ]
  static override args = {
    workspace: Args.string({ description: 'a workspace there, by its name or key' }),
  }
  static override flags = {
    ...siteFlags,
    from: Flags.string({
      summary: 'the site it comes from, by its profile',
      required: true,
      helpValue: '<name>',
    }),
    'from-env': Flags.string({ summary: 'its environment', helpValue: '<id>' }),
    yes: Flags.boolean({ summary: 'bring it, rather than only saying what would come' }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    confirmationBypassArg: '--yes',
    outputFields: [
      whereField,
      { name: 'from', type: 'string' },
      { name: 'applied', type: 'array', items: { type: 'string' } },
      { name: 'workspace', type: 'string', nullable: true },
      { name: 'conflicts', type: 'array', items: { type: 'object' } },
    ],
    outcomes: ['conflicts_found'],
    errors: ['usage', 'auth', 'not_found', 'refused', 'confirmation_required'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspacePull)
    return onSite(this, flags, undefined, async (here) => {
      const there = await workSite({ profile: flags.from, env: flags['from-env'] })
      try {
        this.say(`  ← ${there.where()}`)
        if (args.workspace) {
          const chosen = await workspaceNamed(there, args.workspace)
          const taken = await there.call('GET', `workspaces/${chosen.key}/change`)
          if (!taken.ok)
            this.fail('refused', `"${chosen.name}" could not be taken: ${taken.status}.`)
          if (!flags.yes) {
            this.say(`  would bring "${chosen.name}" here: --yes brings it.`)
            this.changedNothing = true
            return { from: there.where(), applied: [], workspace: null, conflicts: [] }
          }
          const staged = (await (
            await here.call(
              'PUT',
              'changes?stage=true&editable=true',
              new Uint8Array(await taken.arrayBuffer()),
              gz(taken.headers.get('crombolo-sha256') ?? ''),
            )
          ).json()) as { workspace: string | null; conflicts: Array<{ says: string }> }
          for (const c of staged.conflicts ?? []) this.say(`  conflict  ${c.says}`)
          if ((staged.conflicts ?? []).length > 0) this.outcome = 'conflicts_found'
          this.say(`  brought "${chosen.name}" into a workspace here`)
          return {
            from: there.where(),
            applied: [],
            workspace: staged.workspace,
            conflicts: staged.conflicts ?? [],
          }
        }
        const { items } = await there.json<{
          items: Array<{ id: string; key: string; kind: string; name: string | null }>
        }>('GET', 'changes?take=500')
        const candidates = items.filter((c) => c.kind === 'merge' || c.kind === 'edit').reverse()
        const { held } = await here.json<{ held: string[] }>(
          'GET',
          `changes/held?keys=${candidates.map((c) => c.key).join(',')}`,
        )
        const missing = candidates.filter((c) => !held.includes(c.key))
        for (const c of missing) this.say(`  ${c.kind.padEnd(6)} ${c.name ?? c.key}`)
        if (missing.length === 0)
          this.say('  Nothing to bring: this site holds every change there.')
        if (!flags.yes) {
          if (missing.length > 0) this.say('  Nothing was brought: --yes brings them.')
          this.changedNothing = true
          return { from: there.where(), applied: [], workspace: null, conflicts: [] }
        }
        const applied: string[] = []
        for (const c of missing) {
          const taken = await there.call('GET', `changes/${c.id}/bundle`)
          const answer = (await (
            await here.call(
              'PUT',
              'changes',
              new Uint8Array(await taken.arrayBuffer()),
              gz(taken.headers.get('crombolo-sha256') ?? ''),
            )
          ).json()) as { ok: boolean; conflicts?: Array<{ says: string }>; workspace?: string }
          if (!answer.ok) {
            // Left in a workspace here to resolve; nothing after it is brought.
            for (const x of answer.conflicts ?? []) this.say(`  conflict  ${x.says}`)
            this.outcome = 'conflicts_found'
            return {
              from: there.where(),
              applied,
              workspace: answer.workspace ?? null,
              conflicts: answer.conflicts ?? [],
            }
          }
          applied.push(c.key)
        }
        this.say(`  brought ${applied.length} change(s)`)
        return { from: there.where(), applied, workspace: null, conflicts: [] }
      } finally {
        await there.close()
      }
    })
  }
}
