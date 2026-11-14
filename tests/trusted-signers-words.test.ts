/**
 * Story 335: what Settings → Trusted signers says a removal switched off.
 */
import { describe, expect, test } from 'bun:test'
import { switchedOffWords } from '../packages/backoffice-host/plugin/trusted-signers-words.js'

describe('what removing a signer switched off', () => {
  test('nothing says nothing', () => {
    expect(switchedOffWords(undefined)).toBe('')
    expect(switchedOffWords([])).toBe('')
  })

  test('names each extension, in a sentence that fits how many', () => {
    expect(switchedOffWords(['SEO'])).toBe(
      'SEO was switched off: nothing this site trusts vouches for it now. Trust the signer again, or grant it again, to turn it back on.',
    )
    expect(switchedOffWords(['SEO', 'CRM', 'Forms'])).toMatch(
      /^SEO, CRM and Forms were switched off: .* them now\./,
    )
  })
})
