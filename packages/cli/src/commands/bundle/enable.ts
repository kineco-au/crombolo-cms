import { BaseCommand } from '../../base.ts'
import { switchArgs, switchBundle, switchFlags, switchSpec } from '../../support/bundle-switch.ts'

export default class BundleEnable extends BaseCommand {
  static override summary = "turn a disabled bundle's server features back on, here or on a remote"
  static override description =
    'Its pages, jobs and screens stop or start at once, with no restart, as Disable and Enable do in Settings, under Bundles. On a remote it needs CROMBOLO_REMOTE_ACCESS=all and an administrator.'
  static override examples = [
    '<%= config.bin %> bundle enable redirects',
    '<%= config.bin %> bundle enable redirects --remote production',
  ]
  static override args = switchArgs
  static override flags = switchFlags
  static override spec = switchSpec

  async run() {
    const { args, flags } = await this.parse(BundleEnable)
    return switchBundle(this, args.name, flags, true)
  }
}
