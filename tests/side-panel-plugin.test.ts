/**
 * Story 182: side panels docked beside the back office. The rules a panel
 * follows (its width, when it becomes a sheet, what is remembered), and a guard
 * on the vendored shell the layout patch rewrites.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clampWidth,
  DEFAULTS,
  limitsOf,
  modeFor,
  shellIsAsExpected,
  store,
  stored,
  widthForKey,
} from '../packages/backoffice-host/plugin/side-panel/layout.js'
import { ROOT } from '../scripts/packages.ts'

describe('a panel’s width', () => {
  test('defaults to 400, between 280 and 720', () => {
    expect(DEFAULTS).toEqual({ defaultWidth: 400, minWidth: 280, maxWidth: 720 })
    expect(clampWidth(undefined, {}, 1920)).toBe(400)
  })

  test('stays within the panel’s limits and at most half the window', () => {
    const meta = { minWidth: 300, maxWidth: 900 }
    expect(clampWidth(100, meta, 1920)).toBe(300)
    expect(clampWidth(2000, meta, 1920)).toBe(900)
    // Half of 1200 is under the panel's own maximum.
    expect(clampWidth(2000, meta, 1200)).toBe(600)
    // Never under the minimum, even on a window too narrow for half.
    expect(clampWidth(500, meta, 500)).toBe(300)
  })

  test('limits with nonsense in them fall back, and keep min under max', () => {
    expect(limitsOf({ minWidth: -1, maxWidth: 'wide' })).toEqual({
      min: 280,
      max: 720,
      preferred: 400,
    })
    expect(limitsOf({ minWidth: 500, maxWidth: 300 })).toEqual({
      min: 500,
      max: 500,
      preferred: 500,
    })
  })

  test('the splitter moves 16 px a key, and Home and End jump to the limits', () => {
    expect(widthForKey('ArrowLeft', 400, {}, 1920)).toBe(416)
    expect(widthForKey('ArrowRight', 400, {}, 1920)).toBe(384)
    expect(widthForKey('Home', 400, {}, 1920)).toBe(280)
    expect(widthForKey('End', 400, {}, 1920)).toBe(720)
    expect(widthForKey('End', 400, {}, 1000)).toBe(500)
    expect(widthForKey('Enter', 400, {}, 1920)).toBeUndefined()
  })
})

describe('docked or a sheet', () => {
  test('a sheet below 768 px, or when main would drop under 480 px', () => {
    expect(modeFor(1440, 400)).toBe('docked')
    expect(modeFor(767, 300)).toBe('sheet')
    expect(modeFor(900, 450)).toBe('sheet')
    expect(modeFor(900, 420)).toBe('docked')
  })
})

describe('what is remembered', () => {
  const memory = () => {
    const values = new Map<string, string>()
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    } as unknown as Storage
  }

  test('is the open panel and each width, per user', () => {
    const storage = memory()
    store('user-a', { open: 'acme.help', widths: { 'acme.help': 512 } }, storage)
    expect(stored('user-a', storage)).toEqual({ open: 'acme.help', widths: { 'acme.help': 512 } })
    expect(stored('user-b', storage)).toEqual({ open: null, widths: {} })
  })

  test('is nothing when storage throws or holds nonsense', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(() => store('u', { open: 'x', widths: {} }, throwing)).not.toThrow()
    expect(stored('u', throwing)).toEqual({ open: null, widths: {} })
    const storage = memory()
    storage.setItem('crombolo.sidePanel.u', '"a string"')
    expect(stored('u', storage)).toEqual({ open: null, widths: {} })
  })
})

describe('the vendored shell the layout patch rewrites', () => {
  const chunks = join(ROOT, 'packages/backoffice-dist/dist/chunks')
  const shell = readdirSync(chunks)
    .filter((name) => name.startsWith('backoffice.element-') && name.endsWith('.js'))
    .map((name) => readFileSync(join(chunks, name), 'utf8'))
    .find((source) => source.includes('<umb-backoffice-main>'))

  test('still renders header, main and a slot, in that order', () => {
    expect(shell).toBeDefined()
    // The bundle holds several elements' renders; the shell's is the one with main in it.
    const template =
      [...(shell ?? '').matchAll(/render\(\)\{return \w+`([^`]*)`/g)]
        .map((match) => match[1] ?? '')
        .find((text) => text.includes('<umb-backoffice-main>')) ?? ''
    expect(template).toContain('<umb-backoffice-header>')
    expect(shellIsAsExpected([template])).toBe(true)
    // Anything else in the template would be dropped by the patch.
    expect(template.replace(/\s+/g, '')).toBe(
      '<umb-backoffice-header></umb-backoffice-header><umb-backoffice-main></umb-backoffice-main><slot></slot>',
    )
  })

  test('main still fixes its own height under a 60 px header, which the row overrides', () => {
    expect(shell).toContain('100% - 60px')
  })

  test('the check refuses a shell that has changed', () => {
    expect(shellIsAsExpected(['<umb-backoffice-main></umb-backoffice-main><slot></slot>'])).toBe(
      false,
    )
    expect(shellIsAsExpected(undefined)).toBe(false)
  })
})
