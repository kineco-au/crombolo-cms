/** The select reserves an empty value for its disabled placeholder. */
export const NO_FORM_VALUE = '@none'

/** Choices for the form picker, including a saved form that has since gone. */
export function formPickerOptions(forms, value) {
  const options = [
    { name: 'No form', value: NO_FORM_VALUE, selected: !value },
    ...forms.map((form) => ({ name: form.name, value: form.key, selected: form.key === value })),
  ]
  if (value && !forms.some((form) => form.key === value))
    options.push({ name: 'Unavailable form', value, selected: true })
  return options
}
