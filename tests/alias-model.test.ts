/**
 * An alias made from a name, as Umbraco's editors make one: camel case for a
 * form and its fields, the words of a file name for a workflow and its stages.
 */
import { describe, expect, test } from 'bun:test'
import { camelAlias, kebabAlias } from '../packages/backoffice-host/plugin/alias-model.js'

describe('a form’s or a field’s alias', () => {
  test('is the name in camel case, letters and digits only', () => {
    expect(camelAlias("Visitor's name")).toBe('visitorSName')
    expect(camelAlias('Your e-mail address')).toBe('yourEMailAddress')
    expect(camelAlias('Contact us 2026')).toBe('contactUs2026')
    expect(camelAlias('HTML snippet')).toBe('htmlSnippet')
  })

  test('starts with a letter, and is empty for a name with none', () => {
    expect(camelAlias('2nd choice')).toBe('ndChoice')
    expect(camelAlias('  ')).toBe('')
    expect(camelAlias('!!')).toBe('')
  })

  test('is a dictionary item’s name for a caption that names one', () => {
    expect(camelAlias('{#contact.name}')).toBe('contactName')
    expect(camelAlias('#contact.email')).toBe('contactEmail')
  })
})

describe('a workflow’s or a stage’s alias', () => {
  test('is the words of the name, lower case, joined by hyphens', () => {
    expect(kebabAlias('Policy sign-off')).toBe('policy-sign-off')
    expect(kebabAlias('Legal Review 2')).toBe('legal-review-2')
    expect(kebabAlias('')).toBe('')
  })
})
