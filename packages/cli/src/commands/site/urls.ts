import { join } from 'node:path'
import { updateUrls, writeSchemaVersion } from '@crombolo/schema'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { siteDefinitions } from '../../support/site-definitions.ts'
import { commitDefinitionEdit, editSpec } from '../../support/type-edit.ts'

/** How page addresses are built: whether the top-level page is in them (story 251). */
export default class SiteUrls extends BaseCommand {
  static override summary = 'whether page addresses leave out the top-level page'
  static override description =
    'Hidden, the default, the home page is / and its children /about; shown, they are /home and /home/about.'
  static override examples = [
    '<%= config.bin %> site urls --show-top-level',
    '<%= config.bin %> site urls --hide-top-level',
  ]
  static override flags = {
    'hide-top-level': Flags.boolean({
      summary: 'leave the top-level page out of every address',
      exclusive: ['show-top-level'],
    }),
    'show-top-level': Flags.boolean({ summary: 'put the top-level page in every address' }),
    'dry-run': Flags.boolean({ summary: 'say what would change, and change nothing' }),
    'no-apply': Flags.boolean({
      summary: 'change it, and leave applying it to `crombolo types sync`',
    }),
  }
  static override spec = editSpec

  async run() {
    const { flags } = await this.parse(SiteUrls)
    if (!flags['hide-top-level'] && !flags['show-top-level'])
      throw new CliError('usage', 'Say which: --hide-top-level or --show-top-level.')
    const { config, loaded } = await siteDefinitions()
    const hide = flags['hide-top-level']
    return commitDefinitionEdit(
      this,
      {
        config,
        alias: 'URLs',
        file: join(config.schemaDir, 'schema.toml'),
        current: writeSchemaVersion(loaded.set.version, loaded.set.urls),
        next: writeSchemaVersion(loaded.set.version, updateUrls(loaded.set.urls, hide)),
      },
      [
        hide
          ? 'Page addresses leave out the top-level page.'
          : 'Page addresses include the top-level page.',
      ],
      flags,
    )
  }
}
