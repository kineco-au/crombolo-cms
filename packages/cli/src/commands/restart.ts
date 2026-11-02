import { Flags } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { restartLocal, restartRemote } from '../support/restart.ts'
import { cwd } from '../support/site.ts'

/** A new server for the site, with no outage (story 241). */
export default class Restart extends BaseCommand {
  static override summary = 'restart the site, so code installed since it started runs'
  static override description = [
    '`crombolo start` runs the server and restarts it: a new server starts beside the one serving, takes over once it is up, and the old one stops. A new server that fails to start leaves the old one serving, and says why.',
    'Here it restarts the `crombolo start` running in this directory; --remote restarts a remote, which needs its CROMBOLO_REMOTE_ACCESS to be all and an administrator, or CI whose rule may install code.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> restart',
    '<%= config.bin %> restart --remote production',
  ]
  static override flags = {
    remote: Flags.string({ summary: 'restart this remote instead', helpValue: '<name>' }),
    env: Flags.string({ summary: "with --remote: the remote's environment", helpValue: '<id>' }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'restarted', type: 'boolean' },
      { name: 'remote', type: 'string', nullable: true },
    ],
    errors: ['refused', 'unavailable', 'auth', 'not_found', 'usage'],
  } as const

  async run() {
    const { flags } = await this.parse(Restart)
    const outcome = flags.remote
      ? await restartRemote(this, flags)
      : await restartLocal(this, cwd())
    const where = flags.remote ?? 'this site'
    if (!outcome.ok)
      this.fail(
        'refused',
        `${where} did not restart: ${outcome.reason ?? 'the new server did not start'}. The server that was running still is.`,
      )
    this.say(`  restarted  ${where}: the new server is serving.`)
    return { restarted: true, remote: flags.remote ?? null }
  }
}
