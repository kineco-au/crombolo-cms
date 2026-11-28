/**
 * Story 452: what the view editor offers where, a pure function of the text and
 * the cursor (`|` below), and the providers `tsx-editors.js` registers with it.
 * Typing in a browser is `tests/browser/tailwind.browser.ts`.
 */
import { describe, expect, test } from 'bun:test'
import {
  classAt,
  classContextAt,
  hoverFor,
  indexClassList,
  splitVariants,
  suggestClasses,
} from '../packages/backoffice-host/plugin/tailwind-completion.js'

const at = (marked: string) => {
  const offset = marked.indexOf('|')
  return classContextAt(marked.replace('|', ''), offset)?.typed
}

describe('where a class is being written', () => {
  test.each([
    ['<div className="p-4 bg-re|">', 'bg-re'],
    ['<div className="|">', ''],
    ["<div class='flex |'>", ''],
    ['<div className="md:hov|er">', 'md:hov'],
    ['<div className={cn("a", open && "mt-|")}>', 'mt-'],
    ["<div className={clsx('a', { 'text-|': open })}>", 'text-'],
    ['<div className={`p-2 $' + '{open ? "mt-|" : ""}`}>', 'mt-'],
    ['<div className={`p-2 $' + '{open} fl|`}>', 'fl'],
    ['const card = cn(\n  "rounded",\n  "sh|"\n)', 'sh'],
    ['<p>Don\'t</p><div className="te|xt">', 'te'],
  ])('%s offers for %p', (marked, typed) => {
    expect(at(marked)).toBe(typed)
  })

  test.each([
    ['<div className="p-4" |>'],
    ['<div className={cn("a", |)}>'],
    ['const label = "p-|"'],
    ['<div id="p-|">'],
    ['<div className={cn("a")} title="b|">'],
    ['// className="p-4" then |'],
  ])('%s offers nothing', (marked) => {
    expect(at(marked)).toBeUndefined()
  })

  test('replaces the whole of the class the cursor is in', () => {
    const text = '<div className="p-4 bg-red-500 m-2">'
    const offset = text.indexOf('red')
    expect(classContextAt(text, offset)).toEqual({
      start: text.indexOf('bg-'),
      end: text.indexOf(' m-2'),
      typed: 'bg-',
    })
    expect(classAt(text, offset)?.word).toBe('bg-red-500')
    expect(classAt(text, text.indexOf(' m-2'))?.word).toBe('bg-red-500')
    expect(classAt('<div className="p-4  m-2">', 20)).toBeUndefined()
  })
})

const index = indexClassList({
  enabled: true,
  classes: [
    ['bg-red-500', '.bg-red-500 {\n  background-color: var(--color-red-500);\n}', '#fb2c36'],
    ['bg-brand', '.bg-brand {\n  background-color: var(--color-brand);\n}', '#ff6600'],
    ['block', '.block {\n  display: block;\n}'],
    ['p-4', '.p-4 {\n  padding: calc(var(--spacing) * 4);\n}'],
  ],
  variants: ['hover', 'md', 'dark', 'group-hover'],
})

describe('what is offered', () => {
  test('the classes beginning with what is typed, with their CSS and a colour', () => {
    expect(suggestClasses(index, 'bg-').items).toEqual([
      {
        label: 'bg-red-500',
        kind: 'class',
        css: '.bg-red-500 {\n  background-color: var(--color-red-500);\n}',
        color: '#fb2c36',
      },
      {
        label: 'bg-brand',
        kind: 'class',
        css: '.bg-brand {\n  background-color: var(--color-brand);\n}',
        color: '#ff6600',
      },
    ])
  })

  test('variants, and classes with the variants already written in front', () => {
    expect(suggestClasses(index, 'h').items.map((item) => item.label)).toEqual(['hover:'])
    expect(suggestClasses(index, 'md:hover:b').items.map((item) => item.label)).toEqual([
      'md:hover:bg-red-500',
      'md:hover:bg-brand',
      'md:hover:block',
    ])
    // A variant already written is not offered again.
    expect(suggestClasses(index, 'hover:h').items).toEqual([])
    expect(suggestClasses(index, '!p').items.map((item) => item.label)).toEqual(['!p-4'])
  })

  test('at most the limit, and incomplete beyond it or before anything is typed', () => {
    expect(suggestClasses(index, 'b', 2)).toMatchObject({ incomplete: true })
    expect(suggestClasses(index, 'b', 2).items.length).toBe(2)
    expect(suggestClasses(index, '').incomplete).toBe(true)
    expect(suggestClasses(index, 'p-').incomplete).toBe(false)
  })

  test('hovering a class shows its CSS, under its variants; a class it does not know, nothing', () => {
    expect(hoverFor(index, 'p-4')).toBe(
      '```css\n.p-4 {\n  padding: calc(var(--spacing) * 4);\n}\n```',
    )
    expect(hoverFor(index, 'md:block')).toStartWith('md:\n\n```css\n.block')
    expect(hoverFor(index, 'site-header')).toBeUndefined()
  })

  test('variants split at colons outside brackets', () => {
    expect(splitVariants('md:[&>*]:p-4')).toEqual({ variants: ['md', '[&>*]'], base: 'p-4' })
    expect(splitVariants('bg-[url(a:b)]')).toEqual({ variants: [], base: 'bg-[url(a:b)]' })
  })
})

describe('the view editor', () => {
  const source = () => Bun.file('packages/backoffice-host/plugin/tsx-editors.js').text()

  test('registers completion and hover through monaco, for view models it was given classes for', async () => {
    const editor = await source()
    expect(editor).toContain("registerCompletionItemProvider('typescript'")
    expect(editor).toContain("registerHoverProvider('typescript'")
    expect(editor).toContain('/tailwind-classes')
    expect(editor).toContain('CompletionItemKind.Color')
    expect(editor).toContain('tailwindModels.get(model)')
  })
})
