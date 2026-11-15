import SiteApply from './apply.ts'

/** `site apply --dry-run`, by its own name (story 306): what applying a site package would do. */
export default class SiteCheck extends SiteApply {
  static override summary =
    'what applying a site package would do, here or on another site, changing nothing'
  static override description = [
    'The same check `site apply` makes first: a site package opens with what it replaces, its config and package.json, then its code, then the rest. Nothing is written.',
    'With --save, the answers given are written into the package for the apply that follows.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> site check ./acme-site',
    '<%= config.bin %> site check ./acme-site --profile production',
  ]

  static override access = 'none' as const
  static override section = undefined

  override async run() {
    if (!this.argv.includes('--dry-run')) this.argv.push('--dry-run')
    return super.run()
  }
}
