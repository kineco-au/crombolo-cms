import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { exportContentFiles } from '../../support/content-files.ts'
import { many } from '../../support/flags.ts'

/** The site's content as the files `site apply` reads back (story 306; was `bundle export --source`). */
export default class ContentExport extends BaseCommand {
  static override summary = "write this site's content as content files, to edit and apply again"
  static override description =
    'The pages named by --root and those below them into content/pages, or with --all every page, Library element and media item with its file. Values are written as a person would write them: rich text as { html }, pickers and links as paths, blocks as tables. A page keeps its key in its file, so applying the files again names the same pages.'
  static override examples = [
    '<%= config.bin %> content export --root /blog',
    '<%= config.bin %> content export --all',
  ]
  static override flags = {
    root: many('a subtree to write; repeatable', '<path|uuid>'),
    all: Flags.boolean({ summary: 'every page, Library element and media item, with its file' }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [{ name: 'written', type: 'array', items: { type: 'string' } }],
    errors: ['usage', 'not_found', 'auth'],
  } as const

  async run() {
    const { flags } = await this.parse(ContentExport)
    const { written } = await exportContentFiles(this, flags.root, flags.all)
    return { written }
  }
}
