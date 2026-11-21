import { readFileSync } from 'node:fs'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { onSite, siteFlags, whereField, workspaceArg } from '../../support/workspace-commands.ts'

const MARKERS = /^(<{7}|={7}|>{7})( |$)/m

export default class WorkspaceResolve extends BaseCommand {
  static override summary =
    'settle one conflict: a page’s part by --mine or --theirs, a file by those or its merged text'
  static override examples = [
    '<%= config.bin %> workspace resolve "Spring sale" 2f6c…#title|| --mine',
    '<%= config.bin %> workspace resolve "Spring sale" components/banner.tsx --file banner.tsx',
  ]
  static override args = {
    workspace: workspaceArg,
    item: Args.string({
      required: true,
      description: 'a page’s part as `conflicts` names it (<key>#<part>), or a file’s path',
    }),
  }
  static override flags = {
    ...siteFlags,
    mine: Flags.boolean({
      summary: 'keep the workspace’s',
      exclusive: ['theirs', 'file', 'value'],
    }),
    theirs: Flags.boolean({ summary: 'take Shared’s', exclusive: ['mine', 'file', 'value'] }),
    file: Flags.string({ summary: 'a file’s merged text, from this file', helpValue: '<path>' }),
    value: Flags.string({ summary: 'a file’s merged text, given here', helpValue: '<text>' }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      whereField,
      { name: 'item', type: 'string' },
      { name: 'resolved', type: 'boolean' },
    ],
    errors: ['usage', 'auth', 'not_found', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspaceResolve)
    if (!flags.mine && !flags.theirs && flags.file === undefined && flags.value === undefined)
      this.fail('usage', 'Say how: --mine, --theirs, --file <path> or --value <text>.')
    return onSite(this, flags, args.workspace, async (site, chosen) => {
      const page = /^([0-9a-f-]{36})#(.+)$/i.exec(args.item)
      if (page) {
        if (!flags.mine && !flags.theirs)
          this.fail('usage', 'A page’s part is settled with --mine or --theirs.')
        await site.json('POST', `workspaces/${chosen?.key}/conflicts`, {
          page: page[1],
          answers: { [page[2] as string]: flags.mine ? 'mine' : 'theirs' },
        })
      } else {
        const text = flags.file !== undefined ? readFileSync(flags.file, 'utf8') : flags.value
        if (text !== undefined && MARKERS.test(text))
          this.fail('refused', `${args.item} still holds conflict markers: settle them first.`)
        await site.json('POST', `workspaces/${chosen?.key}/files/resolve`, {
          path: args.item,
          ...(text !== undefined ? { text } : { side: flags.mine ? 'mine' : 'theirs' }),
        })
      }
      this.say(`  resolved ${args.item}`)
      return { item: args.item, resolved: true }
    })
  }
}
