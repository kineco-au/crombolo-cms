/** Story 351: what the back office says about command-line tokens. */
import { describe, expect, test } from 'bun:test'
import {
  createButton,
  day,
  expiryChoices,
  PERMISSION_DESCRIPTION,
  PERMISSION_LABEL,
  revokeQuestion,
  tokenLine,
} from '../packages/backoffice-host/plugin/cli-tokens-words.js'
import { TRANSFER } from '../packages/backoffice-host/plugin/group-editor-words.js'
import manifest from '../packages/backoffice-host/plugin/umbraco-package.json'

describe('command-line tokens, in words', () => {
  test('a token says when it stops working and when it was last used', () => {
    const expiresAt = new Date(2026, 11, 14, 12).toISOString()
    expect(day(expiresAt, 'en-GB')).toBe('14 Dec 2026')
    expect(tokenLine({ expiresAt, lastUsedAt: null }, 'en-GB')).toBe(
      'Works until 14 Dec 2026, not used yet',
    )
    const lastUsedAt = new Date(2026, 10, 20, 12).toISOString()
    expect(tokenLine({ expiresAt, lastUsedAt }, 'en-GB')).toBe(
      'Works until 14 Dec 2026, last used 20 Nov 2026',
    )
  })

  test('how long one lasts stops at the site’s limit', () => {
    expect(expiryChoices(90).map((c) => c.days)).toEqual([7, 30, 60, 90])
    expect(expiryChoices(45).map((c) => c.label)).toEqual(['7 days', '30 days', '45 days'])
    expect(expiryChoices(1)).toEqual([{ days: 1, label: '1 day' }])
  })

  test('Create waits for a name, and revoking asks first', () => {
    expect(createButton(' ')).toEqual({ enabled: false, label: 'Give it a name' })
    expect(createButton('deploy')).toEqual({ enabled: true, label: 'Create token' })
    expect(revokeQuestion('deploy')).toContain('"deploy"')
  })

  test('the permission reads the same in the group editor and its manifest, with no jargon', () => {
    const entry = TRANSFER.find((t) => t.verb === 'Crombolo.CliTokens.Create')
    expect(entry?.label).toBe(PERMISSION_LABEL)
    const declared = manifest.extensions.find(
      (e) => e.alias === 'Crombolo.UserPermission.CliTokens.Create',
    ) as { meta: { label: string; description: string } } | undefined
    expect(declared?.meta).toMatchObject({
      label: 'Command-line tokens',
      description: PERMISSION_DESCRIPTION,
    })
    for (const words of [PERMISSION_LABEL, PERMISSION_DESCRIPTION, entry?.line ?? ''])
      expect(words).not.toMatch(/CLI|PAT|bearer|API|Crombolo\./)
  })
})
