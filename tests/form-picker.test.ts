import { describe, expect, test } from 'bun:test'
import {
  formPickerOptions,
  NO_FORM_VALUE,
  pickedForm,
} from '../packages/backoffice-host/plugin/form-picker-options.js'

const forms = [
  { key: 'contact', name: 'Write to the cove' },
  { key: 'visit', name: 'Book a visit' },
]

// Story 239: what the picker offers are Library forms, each made from a form.
const libraryForms = [
  {
    key: 'sales',
    name: 'Contact – Sales',
    formKey: 'contact',
    formName: 'Write to the cove',
    published: true,
  },
  {
    key: 'support',
    name: 'Contact – Support',
    formKey: 'contact',
    formName: 'Write to the cove',
    published: false,
  },
]

describe('the form picker choices', () => {
  test('offers each Library form, grouped by its form, and selects the saved key', () => {
    const options = formPickerOptions({ forms, libraryForms }, 'sales')
    expect(options.map((option) => [option.name, option.group])).toEqual([
      ['No form', undefined],
      ['Contact – Sales', 'Write to the cove'],
      ['Contact – Support (not published)', 'Write to the cove'],
    ])
    expect(options.filter((option) => option.selected).map((option) => option.value)).toEqual([
      'sales',
    ])
  })

  test('clearing the selection selects No form and preserves the other choices', () => {
    for (const empty of ['', undefined]) {
      const options = formPickerOptions({ forms, libraryForms }, empty)
      expect(options.filter((option) => option.selected).map((option) => option.value)).toEqual([
        NO_FORM_VALUE,
      ])
      expect(options.map((option) => option.value)).toEqual([NO_FORM_VALUE, 'sales', 'support'])
      expect(options[0]?.value).not.toBe('')
    }
  })

  test('a page that names a form itself keeps it, in the form’s own words', () => {
    const options = formPickerOptions({ forms, libraryForms }, 'visit')
    expect(options.filter((option) => option.selected)).toEqual([
      {
        name: "Book a visit (the form's own words)",
        value: 'visit',
        group: 'Forms',
        selected: true,
      },
    ])
  })

  test('retains a missing saved choice without selecting another in its place', () => {
    const options = formPickerOptions({ forms, libraryForms }, 'removed')
    expect(options.filter((option) => option.selected)).toEqual([
      { name: 'Unavailable form', value: 'removed', selected: true },
    ])
    expect(formPickerOptions({}, undefined)).toEqual([
      { name: 'No form', value: NO_FORM_VALUE, selected: true },
    ])
  })

  test('the fields shown are the form a choice is made from', () => {
    expect(pickedForm({ forms, libraryForms }, 'support')?.form.key).toBe('contact')
    expect(pickedForm({ forms, libraryForms }, 'support')?.library?.published).toBe(false)
    expect(pickedForm({ forms, libraryForms }, 'visit')?.form.name).toBe('Book a visit')
    expect(pickedForm({ forms, libraryForms }, 'visit')?.library).toBeUndefined()
    expect(pickedForm({ forms, libraryForms }, 'removed')).toBeUndefined()
  })
})
