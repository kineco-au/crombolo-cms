import { Args } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { refuseNamed } from '../profiles/choose.ts'
import { copyFlags, copySides, copySite, copySpec, siteFolders } from '../support/site-copy.ts'

export default class Push extends BaseCommand {
  static override summary = 'replace another site with this one, or with any site named by --from'
  static override description = [
    "From this folder's site, or --from, to the default profile, or --to: either may be hosted or a site folder. Shows what it would replace first; --dry-run stops there.",
    "A protected environment needs --force and its name typed back (--auto-approve skips that), and the site may also hold it for someone else's approval. A site folder is checked and backed up first, and asked about unless --yes. Between two hosted sites, everything passes through this machine.",
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> push --to staging --dry-run',
    '<%= config.bin %> push --to production --env live --force --auto-approve',
    '<%= config.bin %> push --from riverside-copy --to staging',
  ]
  static override args = {
    remote: Args.string({ description: 'gone: --to names the site', hidden: true }),
  }
  static override flags = copyFlags
  static override spec = { ...copySpec, confirmationBypassArg: '--auto-approve' } as const

  static override access = 'site' as const
  static override section = 'settings' as const
  static override adminOnly = true

  /** Each site folder it reads or replaces needs its sign-in. */
  protected override async gatedSites(): Promise<string[]> {
    const { args, flags } = await this.parse(Push)
    refuseNamed(args.remote, '--to')
    const { from, to } = copySides('push', flags)
    return siteFolders(from, to)
  }

  async run() {
    const { args, flags } = await this.parse(Push)
    refuseNamed(args.remote, '--to')
    const { from, to } = copySides('push', flags)
    if (flags['dry-run']) this.changedNothing = true
    return copySite(this, from, to, flags)
  }
}
