/**
 * The back office asks and tells in its own look: no browser `confirm`, `alert` or
 * `prompt`, and every native dialog the plugin opens is styled as the rest is (AGENTS.md).
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nativeDialogUses } from '@crombolo/backoffice-host'
import {
  actionAttributes,
  actionButton,
  actionButtons,
  actionElement,
  actionElements,
  orderActions,
} from '../packages/backoffice-host/plugin/dialog-actions.js'

const PLUGIN = join(import.meta.dir, '..', 'packages', 'backoffice-host', 'plugin')

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.name.endsWith('.js') ? [path] : []
  })

describe('the back office’s dialogs', () => {
  test('never use the browser’s confirm, alert or prompt', () => {
    const found = sources(PLUGIN)
      .filter((file) =>
        nativeDialogUses(readFileSync(file, 'utf8')).some((use) => !use.startsWith('a dialog')),
      )
      .map((file) => file.slice(PLUGIN.length + 1))
    expect(found).toEqual([])
  })

  test('a dialog opened on the page itself is styled as the back office is', () => {
    const opened = /createElement\(\s*'dialog'|el\(\s*'dialog'/
    const unstyled = sources(PLUGIN)
      .filter((file) => opened.test(readFileSync(file, 'utf8')))
      .filter((file) => {
        const text = readFileSync(file, 'utf8')
        return !text.includes('crombolo-dialog') || !text.includes('useDialogStyles()')
      })
      .map((file) => file.slice(PLUGIN.length + 1))
    expect(unstyled).toEqual([])
  })

  test('every dialog of the plugin is laid out as the rest, with a title bar, by the one element', () => {
    const own = sources(PLUGIN).filter((file) =>
      /<dialog\b|createElement\(\s*'dialog'|el\(\s*'dialog'/.test(readFileSync(file, 'utf8')),
    )
    expect(own.length).toBeGreaterThan(0)
    expect(
      own
        .filter((file) => !readFileSync(file, 'utf8').includes('uui-dialog-layout'))
        .map((file) => file.slice(PLUGIN.length + 1)),
    ).toEqual([])
  })
})

/** Just enough of a document for the element builder: attributes and listeners. */
const fakeDocument = () =>
  ({
    createElement: (tag: string) => {
      const attributes = new Map<string, string>()
      const listeners: Record<string, Array<() => void>> = {}
      return {
        tag,
        attributes,
        listeners,
        setAttribute: (name: string, value: string) => attributes.set(name, String(value)),
        addEventListener: (event: string, fn: () => void) => {
          listeners[event] = [...(listeners[event] ?? []), fn]
        },
      }
    },
  }) as unknown as Document

type Fake = { tag: string; attributes: Map<string, string>; listeners: Record<string, unknown[]> }

describe('the actions at the foot of a dialog', () => {
  test('no plugin file but the one module puts buttons in a footer’s actions', () => {
    const own =
      /<(?!uui-action-bar\b)[\w-]+\b[^>]*\bslot="actions"|data-primary|slot:\s*'actions'|\.slot\s*=\s*'actions'/
    const drawn = sources(PLUGIN)
      .filter((file) => !file.endsWith('dialog-actions.js'))
      .filter((file) => own.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(PLUGIN.length + 1))
    expect(drawn).toEqual([])
  })

  test('each kind has its look', () => {
    expect(actionAttributes({ kind: 'primary', label: 'Create' })).toEqual({
      slot: 'actions',
      look: 'primary',
      color: 'positive',
      label: 'Create',
    })
    expect(actionAttributes({ kind: 'secondary', label: 'Cancel' })).toEqual({
      slot: 'actions',
      look: 'secondary',
      label: 'Cancel',
    })
    expect(actionAttributes({ kind: 'danger', label: 'Delete' })).toEqual({
      slot: 'actions',
      look: 'secondary',
      color: 'danger',
      label: 'Delete',
    })
    expect(() => actionAttributes({ kind: 'loud', label: 'Go' })).toThrow()
  })

  test('the action itself is last, the rest in the order given, and the absent left out', () => {
    const save = { kind: 'primary', label: 'Save' }
    const del = { kind: 'danger', label: 'Delete' }
    const cancel = { kind: 'secondary', label: 'Cancel' }
    expect(orderActions([save, del, false, cancel, undefined]).map((a) => a.label)).toEqual([
      'Delete',
      'Cancel',
      'Save',
    ])
  })

  test('a footer gets uui-buttons with the look of their kind', () => {
    const onClick = () => {}
    const template = actionButton({ kind: 'danger', label: 'Delete', disabled: true, onClick })
    const markup = template.strings.join('')
    expect(markup).toContain('<uui-button')
    expect(markup).toContain('slot="actions"')
    expect(template.values.slice(0, 3)).toEqual(['secondary', 'danger', 'Delete'])
    expect(template.values).toContain(true)
    expect(template.values).toContain(onClick)
    const [first, last] = actionButtons(
      { kind: 'primary', label: 'Save' },
      { kind: 'secondary', label: 'Close' },
    )
    expect(first?.values[2]).toBe('Close')
    expect(last?.values.slice(0, 3)).toEqual(['primary', 'positive', 'Save'])
  })

  test('a dialog on the page gets the same uui-buttons, in the same order', () => {
    const onClick = () => {}
    const doc = fakeDocument()
    const button = actionElement(
      { kind: 'primary', label: 'Create', disabled: true, title: 'Why', onClick },
      doc,
    ) as unknown as Fake
    expect(button.tag).toBe('uui-button')
    expect(Object.fromEntries(button.attributes)).toEqual({
      slot: 'actions',
      look: 'primary',
      color: 'positive',
      label: 'Create',
      title: 'Why',
      disabled: '',
    })
    expect(button.listeners.click).toEqual([onClick])
    const cancel = actionElement({ kind: 'secondary', label: 'Cancel' }, doc) as unknown as Fake
    expect(cancel.attributes.has('color')).toBe(false)
    expect(
      (
        actionElements(
          [
            { kind: 'primary', label: 'OK' },
            { kind: 'secondary', label: 'Cancel' },
          ],
          doc,
        ) as unknown as Fake[]
      ).map((b) => b.attributes.get('label')),
    ).toEqual(['Cancel', 'OK'])
  })
})
