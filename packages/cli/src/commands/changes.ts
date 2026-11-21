import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { onSite, siteFlags, whereField } from '../support/workspace-commands.ts'

export default class Changes extends BaseCommand {
  static override summary =
    'the changes made there, newest first, or one of them with what it holds'
  static override examples = [
    '<%= config.bin %> changes',
    '<%= config.bin %> changes 6f1c… --profile riverside --env production',
  ]
  static override args = { change: Args.string({ description: 'one change, by its id' }) }
  static override flags = {
    ...siteFlags,
    take: Flags.integer({ summary: 'how many', default: 20 }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      whereField,
      { name: 'items', type: 'array', items: { type: 'object' } },
      { name: 'change', type: 'object', nullable: true },
    ],
    errors: ['usage', 'auth', 'not_found'],
  } as const

  async run() {
    const { args, flags } = await this.parse(Changes)
    return onSite(this, flags, undefined, async (site) => {
      if (args.change) {
        const change = await site.json<{
          id: string
          name: string | null
          kind: string
          files: unknown[]
          pages: unknown[]
        }>('GET', `changes/${args.change}`)
        this.say(
          `  ${change.kind}  ${change.name ?? change.id}: ${change.files.length} file(s), ${change.pages.length} page(s)`,
        )
        return { items: [], change }
      }
      const { items } = await site.json<{
        items: Array<{ id: string; kind: string; name: string | null; startedAt: string }>
      }>('GET', `changes?take=${flags.take}`)
      for (const c of items)
        this.say(`  ${c.startedAt.slice(0, 16)}  ${c.kind.padEnd(7)} ${c.name ?? ''}  ${c.id}`)
      return { items, change: null }
    })
  }
}
