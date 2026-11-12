/**
 * Story 340: the words and fields of Settings → E-mail.
 */
import { describe, expect, test } from 'bun:test'
import {
  bodyOf,
  draftOf,
  fieldsFor,
  needsAttention,
  summaryOf,
} from '../packages/backoffice-host/plugin/email-settings-words.js'

describe('Settings → E-mail (story 340)', () => {
  test('each provider asks for its own fields', () => {
    expect(fieldsFor('resend')).toEqual([])
    expect(fieldsFor('ses').map((field) => field.name)).toEqual(['sesRegion', 'sesAccessKeyId'])
    expect(fieldsFor('custom').map((field) => field.name)).toEqual(['url'])
  })

  test('a save sends the provider’s own fields, and a key only when one was typed', () => {
    const draft = { ...draftOf({ provider: 'ses', from: ' a@example.org ', url: 'https://x' }) }
    draft.sesRegion = 'ap-southeast-2'
    draft.sesAccessKeyId = 'AKIA'
    expect(bodyOf(draft)).toEqual({
      provider: 'ses',
      from: 'a@example.org',
      fromName: '',
      sesRegion: 'ap-southeast-2',
      sesAccessKeyId: 'AKIA',
    })
    expect(bodyOf({ ...draft, key: ' secret ' }).key).toBe('secret')
  })

  test('nothing set starts on the first provider', () => {
    expect(draftOf(undefined).provider).toBe('resend')
  })

  test('says where e-mail stands', () => {
    expect(summaryOf({ source: 'off' })).toContain('turned off')
    expect(
      summaryOf({ source: 'settings', provider: 'postmark', status: { available: true } }),
    ).toBe('E-mail is sent through Postmark.')
    expect(summaryOf({ source: 'none', status: { available: false, provider: 'log' } })).toContain(
      "server's log",
    )
    expect(summaryOf({ source: 'none', status: { available: false } })).toContain('not set up')
  })

  test('the card is marked only while e-mail cannot be sent', () => {
    expect(needsAttention({ available: false })).toBe(true)
    expect(needsAttention({ available: true })).toBe(false)
    expect(needsAttention(undefined)).toBe(false)
  })
})
