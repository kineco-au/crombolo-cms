import { allFormFields } from '@crombolo/core'
import { BaseCommand } from '../../base.ts'
import { formUsage } from '../../support/form-edit.ts'
import { siteConfig } from '../../support/site.ts'
import { loadTypes, needSchemaDir } from '../../support/types.ts'

/** The site's forms (story 251). */
export default class FormsList extends BaseCommand {
  static override summary = "the site's forms"
  static override description =
    'Each with its name, fields and workflows; with how many pages and Library forms use it when the site has a database. `crombolo forms show <alias>` shows one.'
  static override examples = ['<%= config.bin %> forms list']
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      {
        name: 'items',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'alias', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'fields', type: 'integer' },
            { name: 'workflows', type: 'integer' },
            { name: 'pages', type: 'integer', nullable: true },
            { name: 'libraryForms', type: 'integer', nullable: true },
          ],
        },
      },
    ],
    errors: ['not_found'],
  } as const

  async run() {
    const config = await siteConfig()
    needSchemaDir(config)
    const forms = [...(loadTypes(config).set.forms ?? [])].sort((a, b) =>
      a.alias.localeCompare(b.alias),
    )
    const items = []
    for (const form of forms) {
      const used = await formUsage(config, form)
      items.push({
        alias: form.alias,
        name: form.name,
        fields: allFormFields(form).length,
        workflows: form.workflows.length,
        pages: used?.pages ?? null,
        libraryForms: used?.libraryForms ?? null,
      })
    }
    for (const item of items)
      this.say(
        `  ${item.alias.padEnd(24)} ${item.name.padEnd(28)} ${item.fields} field(s), ${item.workflows} workflow(s)${item.pages === null ? '' : `, used by ${item.pages} page(s) and ${item.libraryForms} Library form(s)`}`,
      )
    if (items.length === 0)
      this.say('The site has no forms: `crombolo forms new <alias>` makes one.')
    return { items }
  }
}
