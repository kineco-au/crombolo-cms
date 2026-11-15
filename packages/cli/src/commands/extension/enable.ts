import { BaseCommand } from '../../base.ts'
import { switchArgs, switchBundle, switchFlags, switchSpec } from '../../support/bundle-switch.ts'

export default class ExtensionEnable extends BaseCommand {
  static override summary =
    "turn a disabled bundle's server features back on, here or on another site"
  static override description =
    'Its pages, jobs and screens stop or start at once, with no restart, as Disable and Enable do in Settings, under Bundles. On a hosted site it needs CROMBOLO_REMOTE_ACCESS=all and an administrator.'
  static override examples = [
    '<%= config.bin %> extension enable redirects',
    '<%= config.bin %> extension enable redirects --profile production',
  ]
  static override args = switchArgs
  static override flags = switchFlags
  static override access = 'site' as const
  static override section = 'settings' as const
  static override spec = switchSpec

  async run() {
    const { args, flags } = await this.parse(ExtensionEnable)
    return switchBundle(this, args.name, flags, true)
  }
}
