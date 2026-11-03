import { updateForm } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { commitFormEdit, findForm, formEditFlags, formEditSpec } from '../../support/form-edit.ts'
import { startNodeAt } from '../../support/type-edit.ts'

const yesNo = (summary: string) => Flags.boolean({ summary, allowNo: true })

/** A form's own settings (story 251). */
export default class FormsUpdate extends BaseCommand {
  static override summary =
    "change a form's settings: its name, what it keeps, its buttons and what follows sending"
  static override description =
    'Checked against the site first, then applied, unless --no-apply. `--message ""`, `--redirect-to none`, `--minimum-seconds 0` and `--max-entries 0` take one away.'
  static override examples = [
    '<%= config.bin %> forms update contact --name "Get in touch" --message "Thanks, we will be in touch"',
    '<%= config.bin %> forms update contact --redirect-to /Home/Thanks --requires-approval',
  ]
  static override args = { alias: Args.string({ required: true, description: "the form's alias" }) }
  static override flags = {
    name: Flags.string({ summary: 'its name', helpValue: '<name>' }),
    'store-entries': yesNo('keep each entry'),
    'requires-approval': yesNo('entries wait until someone approves them'),
    'step-pages': yesNo('show one page at a time'),
    'submit-label': Flags.string({ summary: "the send button's words", helpValue: '<text>' }),
    'next-label': Flags.string({ summary: "the next-page button's words", helpValue: '<text>' }),
    'previous-label': Flags.string({
      summary: "the previous-page button's words",
      helpValue: '<text>',
    }),
    message: Flags.string({
      summary: 'what a visitor sees after sending; "" for none',
      helpValue: '<text>',
    }),
    'redirect-to': Flags.string({
      summary: 'the page a visitor goes to after sending, by its path; none for none',
      helpValue: '<path|none>',
    }),
    theme: Flags.string({ summary: 'its theme', helpValue: '<theme>' }),
    honeypot: yesNo('catch spam with a field visitors never fill'),
    'minimum-seconds': Flags.integer({
      summary: 'mark as spam an entry sent faster than this; 0 for no limit',
    }),
    'max-entries': Flags.integer({
      summary: 'refuse entries once there are this many; 0 for no limit',
    }),
    ...formEditFlags,
  }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsUpdate)
    const found = await findForm(args.alias)
    const to = flags['redirect-to']
    const redirectTo =
      to === undefined
        ? undefined
        : to === 'none'
          ? null
          : await startNodeAt(this, found.config, to)
    const result = updateForm(found.form, {
      name: flags.name,
      storeEntries: flags['store-entries'],
      requiresApproval: flags['requires-approval'],
      stepPages: flags['step-pages'],
      submitLabel: flags['submit-label'],
      nextLabel: flags['next-label'],
      previousLabel: flags['previous-label'],
      messageOnSubmit: flags.message,
      redirectTo,
      theme: flags.theme,
      honeypot: flags.honeypot,
      minimumSubmitSeconds: flags['minimum-seconds'],
      maxEntries: flags['max-entries'],
    })
    const said = (flag: boolean | undefined, yes: string, no: string) =>
      flag === undefined ? [] : [`  ${flag ? yes : no}`]
    const change = [
      `The form "${found.form.name}" (${found.form.alias}):`,
      ...(flags.name ? [`  named "${flags.name}"`] : []),
      ...said(flags['store-entries'], 'keeps its entries', 'keeps no entries'),
      ...said(flags['requires-approval'], 'entries wait for approval', 'entries need no approval'),
      ...said(flags['step-pages'], 'one page at a time', 'every page at once'),
      ...(flags['submit-label'] !== undefined
        ? [`  the send button says "${flags['submit-label']}"`]
        : []),
      ...(flags.message !== undefined
        ? [flags.message ? `  after sending: "${flags.message}"` : '  no message after sending']
        : []),
      ...(to !== undefined
        ? [to === 'none' ? '  goes nowhere after sending' : `  goes to ${to} after sending`]
        : []),
      ...said(flags.honeypot, 'catches spam with a hidden field', 'no hidden spam field'),
      ...(flags['max-entries'] !== undefined
        ? [
            flags['max-entries'] > 0
              ? `  at most ${flags['max-entries']} entries`
              : '  no limit on entries',
          ]
        : []),
    ]
    return commitFormEdit(this, found, result, change, flags)
  }
}
