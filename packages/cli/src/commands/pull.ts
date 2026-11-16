import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { refuseNamed } from '../profiles/choose.ts'
import { serveSite } from '../support/serve.ts'
import { copyFlags, copySides, copySite, copySpec, siteFolders } from '../support/site-copy.ts'

export default class Pull extends BaseCommand {
  static override summary =
    'a copy of another site: started here, or replacing this site or any named by --to'
  static override description = [
    "From the default profile, or --from, to this folder's site, or --to: either may be hosted or a site folder. From a hosted site it is sealed and anonymised unless --full. In an empty folder it starts a new site and serves it; in a site it replaces it, saying first what it loses (recycled, and asked about unless --yes).",
    '--media-info-only fetches media files one at a time, only what changed since the last pull; --lazy-media fetches each the first time it is asked for; --no-media leaves them out.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> pull --from production --env staging --yes',
    '<%= config.bin %> pull --from production --to riverside-copy',
  ]
  static override args = {
    remote: Args.string({ description: 'gone: --from names the site', hidden: true }),
  }
  static override flags = {
    ...copyFlags,
    agents: Flags.boolean({
      summary: "in an empty folder: write AGENTS.md, with crombolo's guide and the remote's",
      default: true,
      allowNo: true,
    }),
  }
  static override spec = {
    ...copySpec,
    outputFields: [
      ...copySpec.outputFields,
      {
        name: 'serving',
        type: 'object',
        description: 'in an empty folder: where the new site answers',
      },
    ],
  } as const

  static override access = 'site' as const
  static override section = 'settings' as const
  static override adminOnly = true

  /** Each site folder it reads or replaces needs its sign-in. */
  protected override async gatedSites(): Promise<string[]> {
    const { args, flags } = await this.parse(Pull)
    refuseNamed(args.remote, '--from')
    const { from, to } = copySides('pull', flags)
    return siteFolders(from, to)
  }

  async run() {
    const { args, flags } = await this.parse(Pull)
    refuseNamed(args.remote, '--from')
    const { from, to } = copySides('pull', flags)
    if (flags['dry-run']) this.changedNothing = true
    const result = await copySite(this, from, to, flags)
    if (!result.started) return result
    // A new site serves, as `start --from` does, so its one record is written before it does.
    const serving = await serveSite(this, {
      keepAdmin: true,
      bundles: [],
      backupTaken: false,
      resolve: [],
      'allow-missing-blobs': false,
      publish: false,
      'no-schema': false,
      'no-files': false,
      'replace-files': false,
    })
    if (this.jsonEnabled()) process.stdout.write(`${JSON.stringify({ ...result, serving })}\n`)
    return
  }
}
