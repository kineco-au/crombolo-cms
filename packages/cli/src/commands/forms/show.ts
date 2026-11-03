import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { describeCondition, findForm, formUsage } from '../../support/form-edit.ts'

/** One form in full: its pages, fieldsets and fields in order, its workflows and what uses it (story 251). */
export default class FormsShow extends BaseCommand {
  static override summary = 'one form: its pages, fieldsets, fields, workflows and what uses it'
  static override examples = ['<%= config.bin %> forms show contact']
  static override args = { alias: Args.string({ required: true, description: "the form's alias" }) }
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    stdoutSchema: {},
    errors: ['not_found'],
  } as const

  async run() {
    const { args } = await this.parse(FormsShow)
    const { config, form } = await findForm(args.alias)
    const used = await formUsage(config, form)
    this.say(`Form "${form.name}" (${form.alias})`)
    const traits = [
      form.storeEntries ? 'keeps its entries' : 'keeps no entries',
      form.requiresApproval ? 'entries wait for approval' : '',
      form.stepPages ? 'one page at a time' : '',
      form.honeypot ? 'catches spam with a hidden field' : '',
      form.maxEntries ? `at most ${form.maxEntries} entries` : '',
    ].filter(Boolean)
    this.say(`  ${traits.join(' · ')}`)
    if (form.messageOnSubmit) this.say(`  after sending: "${form.messageOnSubmit}"`)
    if (form.redirectTo) this.say(`  after sending: goes to page ${form.redirectTo}`)
    form.pages.forEach((page, p) => {
      this.say(
        `\n  Page ${p + 1}${page.caption ? ` "${page.caption}"` : ''}${page.condition ? `, ${describeCondition(page.condition)}` : ''}`,
      )
      page.groups.forEach((group, g) => {
        this.say(
          `    Fieldset ${g + 1}${group.caption ? ` "${group.caption}"` : ''}${group.columns > 1 ? `, ${group.columns} columns` : ''}${group.condition ? `, ${describeCondition(group.condition)}` : ''}`,
        )
        for (const field of group.fields)
          this.say(
            `      ${field.alias.padEnd(22)} ${field.caption.padEnd(24)} ${field.type}${field.mandatory ? '  mandatory' : ''}${field.condition ? `  ${describeCondition(field.condition)}` : ''}`,
          )
        if (group.fields.length === 0) this.say('      (no fields)')
      })
    })
    this.say(form.workflows.length > 0 ? '\n  Workflows' : '\n  No workflows.')
    for (const w of form.workflows) this.say(`    ${w.name} (${w.type}), on ${w.on}`)
    if (used)
      this.say(`\n  Used by ${used.pages} page(s) and ${used.libraryForms} Library form(s).`)
    this.say('\n`crombolo forms field add <form> <alias> --type <type>` adds a field.')
    return { ...form, usedBy: used ?? null }
  }
}
