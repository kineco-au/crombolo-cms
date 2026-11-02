/**
 * Forms in the Library (story 239). A developer's form, from its TOML, gives
 * the Library one element type; an editor's element of that type is a Library
 * form, whose words are laid over the form's when a page shows it.
 */
import type { SchemaForm } from './forms.ts'
import { derivedKey } from './keys.ts'

/** The properties of every type made from a form, by alias. */
export const LIBRARY_FORM_PROPERTY = {
  heading: 'heading',
  introduction: 'introduction',
  submitLabel: 'submitLabel',
  messageOnSubmit: 'messageOnSubmit',
  redirectTo: 'redirectTo',
  recipients: 'recipients',
} as const

export interface LibraryFormPropertyDefinition {
  alias: string
  name: string
  description: string
  /** A built-in data type's alias. */
  dataType: string
}

export const LIBRARY_FORM_PROPERTIES: readonly LibraryFormPropertyDefinition[] = [
  {
    alias: LIBRARY_FORM_PROPERTY.heading,
    name: 'Heading',
    description: 'Shown above the form.',
    dataType: 'textstring',
  },
  {
    alias: LIBRARY_FORM_PROPERTY.introduction,
    name: 'Introduction',
    description: 'Shown under the heading, before the first field.',
    dataType: 'richtext',
  },
  {
    alias: LIBRARY_FORM_PROPERTY.submitLabel,
    name: 'Submit button',
    description: "The button's text. Leave empty for the form's own.",
    dataType: 'textstring',
  },
  {
    alias: LIBRARY_FORM_PROPERTY.messageOnSubmit,
    name: 'Thank-you message',
    description: "Shown once the form is sent. Leave empty for the form's own.",
    dataType: 'textarea',
  },
  {
    alias: LIBRARY_FORM_PROPERTY.redirectTo,
    name: 'Page to go to after sending',
    description: 'Shown in place of the thank-you message.',
    dataType: 'contentPicker',
  },
  {
    alias: LIBRARY_FORM_PROPERTY.recipients,
    name: 'E-mail entries to',
    description:
      "Addresses to tell about each entry, separated by commas. Leave empty for the form's own.",
    dataType: 'textstring',
  },
]

/** What identifies a form to its Library type: its key, or its alias when it has none. */
export const libraryFormId = (form: Pick<SchemaForm, 'key' | 'alias'>): string =>
  form.key ?? form.alias

/** The key of the element type made from a form; stable for as long as the form's id is. */
export const libraryFormTypeKey = (formId: string): string => derivedKey('form-type', formId)

/** The alias of the element type made from a form: `contactUs` gives `contactUsForm`. */
export const libraryFormTypeAlias = (form: Pick<SchemaForm, 'alias'>): string => `${form.alias}Form`

/** A property's key on the type made from a form. */
export const libraryFormPropertyKey = (typeKey: string, alias: string): string =>
  derivedKey(typeKey, alias)

/** The words on a Library form, as its element's values give them. */
export interface LibraryFormValues {
  heading?: string
  introduction?: string
  submitLabel?: string
  messageOnSubmit?: string
  /** A document key. */
  redirectTo?: string
  recipients?: string
}

/** Addresses from the recipients field: separated by commas, semicolons or new lines. */
export function libraryFormRecipients(text: string | undefined): string[] {
  return (text ?? '')
    .split(/[,;\n]/)
    .map((address) => address.trim())
    .filter(Boolean)
}

const filled = (value: string | undefined): string | undefined =>
  value && value.trim() !== '' ? value : undefined

/**
 * The form as a Library form shows it: each of the editor's words that is not
 * empty replaces the form's own, and the rest are the form's. Pure.
 */
export function applyLibraryForm(
  form: SchemaForm,
  key: string,
  values: LibraryFormValues,
): SchemaForm {
  const submitLabel = filled(values.submitLabel)
  const messageOnSubmit = filled(values.messageOnSubmit)
  const redirectTo = filled(values.redirectTo)
  const heading = filled(values.heading)
  const introduction = filled(values.introduction)
  const recipients = libraryFormRecipients(values.recipients)
  return {
    ...form,
    ...(submitLabel ? { submitLabel } : {}),
    ...(messageOnSubmit ? { messageOnSubmit } : {}),
    ...(redirectTo ? { redirectTo } : {}),
    library: {
      key,
      ...(heading ? { heading } : {}),
      ...(introduction ? { introduction } : {}),
      ...(recipients.length > 0 ? { recipients } : {}),
    },
  }
}
