/**
 * Story 179: the AI assistant left the CMS. A config still naming it refuses
 * to start rather than quietly running without it, and nothing exports it.
 */
import { describe, expect, test } from 'bun:test'
import * as crombolo from '@crombolo/crombolo'
import { loadConfig } from '@crombolo/server'

describe('the assistant is gone', () => {
  test('a config naming it refuses to start, pointing at where to go instead', () => {
    expect(() => loadConfig({ assistant: { provider: {} } } as never)).toThrow(
      /removed from crombolo in 0\.26 \(story 179\).*Tools a host provides/,
    )
  })

  test('nothing exports it', () => {
    expect('bedrock' in crombolo).toBe(false)
  })
})
