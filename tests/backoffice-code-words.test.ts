/**
 * Story 320: what the Extensions screens say before back-office code is granted:
 * what it does, that it can't be kept apart, and whom to trust, with the
 * publisher and its signature named.
 */
import { describe, expect, test } from 'bun:test'
import { BACKOFFICE_CODE_WARNING, describePermissions } from '@crombolo/backoffice-host'
import {
  backOfficeCodeWords,
  splitBackOfficeCode,
} from '../packages/backoffice-host/plugin/bundles-backoffice-code-words.js'

describe('the back-office code warning', () => {
  const [ask] = describePermissions([
    { permission: 'backoffice.code', reason: 'Shows the SEO report' },
  ])

  test('names the publisher and what its signature shows', () => {
    const words = backOfficeCodeWords(ask as never, 'acme', {
      label: 'Signed',
      detail: 'Built from github.com/acme/seo at v1.2.0 (abc1234).',
    })
    expect(words).toEqual({
      label: 'Runs in your back office as each person using it',
      reason: 'Shows the SEO report',
      warning: BACKOFFICE_CODE_WARNING,
      publisher: 'Published by acme.',
      signature: 'Signed. Built from github.com/acme/seo at v1.2.0 (abc1234).',
      confirm: 'I trust acme to act as anyone signed in to this back office',
    })
    expect(words.warning).toContain("Don't install this from a publisher you don't trust.")
  })

  test('says when nobody knows who published it', () => {
    const words = backOfficeCodeWords(ask as never, null, undefined)
    expect(words.publisher).toBe("Who published this isn't known.")
    expect(words.confirm).toBe(
      'I trust its publisher to act as anyone signed in to this back office',
    )
  })

  test('is shown first and apart from the confined permissions', () => {
    const asks = [{ permission: 'content.read' }, { permission: 'backoffice.code' }]
    expect(splitBackOfficeCode(asks)).toEqual({
      code: { permission: 'backoffice.code' },
      rest: [{ permission: 'content.read' }],
    })
  })
})
