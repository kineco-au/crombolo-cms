/**
 * A form as data, for an app that draws it itself (story 056): what a visitor
 * sees and answers, and what a submission must carry. Never its workflows, its
 * notes or its storage rules, which are the site's business and can hold
 * addresses and secrets. docs/delivery-api.md, "Forms".
 */
import {
  allFormFields,
  choiceOptions,
  FORM_HONEYPOT_FIELD,
  FORM_PAGE_FIELD,
  FORM_RENDERED_FIELD,
  FORM_TOKEN_FIELD,
  type FormTypes,
  formFieldType,
  type SchemaForm,
  type SchemaFormField,
} from '@crombolo/core'

export interface ApiFormContext {
  types: FormTypes
  /** Where a submission is posted: absolute, since an app is somewhere else. */
  action: string
  /** Signed for this form and `renderedAt`, as a rendered form's is. */
  token: string
  renderedAt: number
  /** The address of the page `redirectTo` names, if it has one. */
  redirectUrl: string | undefined
}

/** A form picker's value when it is not expanded: enough to fetch the rest. */
export const apiFormReference = (form: SchemaForm) => ({
  id: form.key ?? form.alias,
  alias: form.alias,
  name: form.name,
})

const defined = (record: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))

function apiField(field: SchemaFormField): Record<string, unknown> {
  return defined({
    key: field.key,
    alias: field.alias,
    type: field.type,
    caption: field.caption,
    helpText: field.helpText,
    mandatory: field.mandatory,
    mandatoryMessage: field.mandatoryMessage,
    pattern: field.pattern,
    patternMessage: field.patternMessage,
    cssClass: field.cssClass,
    autocomplete: field.autocomplete,
    // A source's choices already resolved; the stored list otherwise.
    options: field.source || field.values.length > 0 ? choiceOptions(field) : undefined,
    placeholder: field.placeholder,
    defaultValue: field.defaultValue,
    content: field.content,
    maxlength: field.maxlength,
    rows: field.rows,
    min: field.min,
    max: field.max,
    step: field.step,
    accept: field.accept.length > 0 ? field.accept : undefined,
    maxSizeKb: field.maxSizeKb,
    multiple: field.multiple,
    settings: field.settings,
    condition: field.condition,
  })
}

/** The form an app draws and submits. Pure. */
export function apiForm(form: SchemaForm, context: ApiFormContext): Record<string, unknown> {
  const used = new Set(allFormFields(form).map((field) => field.type))
  const types: Record<string, unknown> = {}
  for (const type of used) {
    const info = formFieldType(type, context.types)
    if (!info) continue
    types[type] = defined({
      label: info.label,
      stores: info.stores,
      choices: info.choices,
      presentational: info.presentational,
      // A bundle's type says what it is and what it takes, so an app can recognise one it does not know.
      bundle: info.bundle,
      settings: info.declared.length > 0 ? info.declared : undefined,
    })
  }
  return defined({
    ...apiFormReference(form),
    stepPages: form.stepPages ?? false,
    submitLabel: form.submitLabel,
    nextLabel: form.nextLabel,
    previousLabel: form.previousLabel,
    messageOnSubmit: form.messageOnSubmit,
    redirectTo: context.redirectUrl,
    pages: form.pages.map((page) =>
      defined({
        caption: page.caption,
        condition: page.condition,
        groups: page.groups.map((group) =>
          defined({
            caption: group.caption,
            columns: group.columns,
            condition: group.condition,
            fields: group.fields.map(apiField),
          }),
        ),
      }),
    ),
    types,
    submit: {
      action: context.action,
      method: 'POST',
      // Post these with the answers, as multipart or URL-encoded form data.
      fields: defined({
        [FORM_TOKEN_FIELD]: context.token,
        [FORM_RENDERED_FIELD]: String(context.renderedAt),
      }),
      // Sent empty: a bot fills it. Absent when the form has no honeypot.
      honeypot: form.honeypot ? FORM_HONEYPOT_FIELD : undefined,
      // Set to a page's index to check that page alone, for a stepped form.
      page: FORM_PAGE_FIELD,
    },
  })
}
