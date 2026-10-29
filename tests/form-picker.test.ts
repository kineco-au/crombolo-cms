import { describe, expect, test } from 'bun:test'
import {
  formPickerOptions,
  NO_FORM_VALUE,
} from '../packages/backoffice-host/plugin/form-picker-options.js'

const forms = [
  { key: 'contact', name: 'Write to the cove' },
  { key: 'visit', name: 'Book a visit' },
]

describe('the form picker choices', () => {
  test('offers each form and selects the saved key by its name', () => {
    const options = formPickerOptions(forms, 'contact')
    expect(options.map((option) => option.name)).toEqual([
      'No form',
      'Write to the cove',
      'Book a visit',
    ])
    expect(options.filter((option) => option.selected)).toEqual([
      { name: 'Write to the cove', value: 'contact', selected: true },
    ])
  })

  test('clearing the selection selects No form and preserves the other choices', () => {
    for (const empty of ['', undefined]) {
      const options = formPickerOptions(forms, empty)
      expect(options.filter((option) => option.selected).map((option) => option.value)).toEqual([
        NO_FORM_VALUE,
      ])
      expect(options.map((option) => option.value)).toEqual([NO_FORM_VALUE, 'contact', 'visit'])
      expect(options[0]?.value).not.toBe('')
    }
  })

  test('retains a missing saved form without selecting another form in its place', () => {
    const options = formPickerOptions(forms, 'removed')
    expect(options.filter((option) => option.selected)).toEqual([
      { name: 'Unavailable form', value: 'removed', selected: true },
    ])
  })

  test('an empty site can retain an unavailable saved form or an empty value', () => {
    expect(formPickerOptions([], 'removed').find((option) => option.selected)?.value).toBe(
      'removed',
    )
    expect(formPickerOptions([], undefined)).toEqual([
      { name: 'No form', value: NO_FORM_VALUE, selected: true },
    ])
  })
})
