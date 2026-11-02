/** The select reserves an empty value for its disabled placeholder. */
export const NO_FORM_VALUE = '@none'

/**
 * @typedef {{ key: string, name: string }} FormSummary
 * @typedef {{ key: string, name: string, formKey: string, formName: string | null, published: boolean }} LibraryFormItem
 * @typedef {{ name: string, value: string, group?: string, selected: boolean }} PickerOption
 */

/**
 * Choices for the form picker (story 239): each Library form, grouped by the
 * form it is made from. A page saved before Library forms names a form itself,
 * which stays selected, shown in the form's own words; a saved choice that has
 * since gone stays too, as unavailable.
 *
 * @param {{ forms?: FormSummary[], libraryForms?: LibraryFormItem[] }} from
 * @param {string | undefined} value
 * @returns {PickerOption[]}
 */
export function formPickerOptions({ forms = [], libraryForms = [] }, value) {
  /** @type {PickerOption[]} */
  const options = [
    { name: 'No form', value: NO_FORM_VALUE, selected: !value },
    ...libraryForms.map((item) => ({
      name: item.published ? item.name : `${item.name} (not published)`,
      value: item.key,
      group: item.formName ?? 'Unavailable form',
      selected: item.key === value,
    })),
  ]
  if (!value || libraryForms.some((item) => item.key === value)) return options
  const form = forms.find((candidate) => candidate.key === value)
  options.push(
    form
      ? { name: `${form.name} (the form's own words)`, value, group: 'Forms', selected: true }
      : { name: 'Unavailable form', value, selected: true },
  )
  return options
}

/**
 * The form a picked value shows: a Library form's, or the form a page names itself.
 *
 * @param {{ forms?: FormSummary[], libraryForms?: LibraryFormItem[] }} from
 * @param {string | undefined} value
 */
export function pickedForm({ forms = [], libraryForms = [] }, value) {
  if (!value) return undefined
  const item = libraryForms.find((candidate) => candidate.key === value)
  const key = item ? item.formKey : value
  const form = forms.find((candidate) => candidate.key === key)
  return form ? { form, library: item } : undefined
}

/**
 * The entries view's Library form filter for one form; empty when it has none.
 *
 * @param {LibraryFormItem[]} libraryForms
 * @param {string} formKey
 */
export function entriesLibraryOptions(libraryForms, formKey, selected = '') {
  const own = libraryForms.filter((item) => item.formKey === formKey)
  if (own.length === 0) return []
  return [
    { name: 'Any Library form', value: '', selected: selected === '' },
    ...own.map((item) => ({ name: item.name, value: item.key, selected: item.key === selected })),
    { name: 'None: the form itself', value: 'none', selected: selected === 'none' },
  ]
}
