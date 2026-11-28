/**
 * Tailwind's classes in the view editor (story 452): where in a view a class is
 * being written, and which classes and variants to offer there. Pure, so what is
 * offered where is tested without a browser; `tsx-editors.js` hands it to monaco.
 */

/** How far back a class string can begin; a view's markup is rarely further from its attribute. */
const WINDOW = 4000

/** Where a class string, or an expression that hands one to `class`, begins. */
const OPENERS =
  /\b(?:className|class)\s*=\s*(["'{])|\b(?:clsx|cn|cx|classnames|classNames|twMerge|twJoin)\s*(\()/g

const CLOSES = { '(': ')', '{': '}', '[': ']' }

/**
 * What the code from `from` to `to` leaves open, starting inside `opener`: the
 * string the end is in, `code` when it is in the expression but no string, or
 * `closed` when the expression ended first.
 */
function lex(text, from, to, opener) {
  const stack = [{ type: 'code', close: CLOSES[opener] }]
  for (let i = from; i < to; i++) {
    const top = stack[stack.length - 1]
    const c = text[i]
    if (top.type === 'string') {
      if (c === '\\') i++
      else if (c === top.quote || c === '\n') stack.pop()
      continue
    }
    if (top.type === 'template') {
      if (c === '\\') i++
      else if (c === '`') stack.pop()
      else if (c === '$' && text[i + 1] === '{') {
        stack.push({ type: 'code', close: '}' })
        i++
      }
      continue
    }
    if (c === '"' || c === "'") stack.push({ type: 'string', quote: c, start: i + 1 })
    else if (c === '`') stack.push({ type: 'template', start: i + 1 })
    else if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      i = end < 0 || end >= to ? to : end
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end < 0 || end + 2 > to) return { state: 'code' }
      i = end + 1
    } else if (c in CLOSES) stack.push({ type: 'code', close: CLOSES[c] })
    else if (c === top.close) {
      stack.pop()
      if (stack.length === 0) return { state: 'closed' }
    }
  }
  const top = stack[stack.length - 1]
  return top.type === 'code' ? { state: 'code' } : { state: 'string', start: top.start }
}

/**
 * Where the class string the cursor is in begins: inside `className="…"` or
 * `class='…'`, or a string or template string in `className={…}` or a
 * `clsx`/`cn` call. Undefined anywhere else.
 */
export function classStringAt(text, offset) {
  const from = Math.max(0, offset - WINDOW)
  const before = text.slice(from, offset)
  const openers = [...before.matchAll(OPENERS)]
  for (let index = openers.length - 1; index >= 0; index--) {
    const match = openers[index]
    const opener = match[1] ?? match[2]
    const after = from + match.index + match[0].length
    if (opener === '"' || opener === "'") {
      if (!text.slice(after, offset).includes(opener)) return after
      continue
    }
    const found = lex(text, after, offset, opener)
    if (found.state === 'string') return found.start
    if (found.state === 'code') return undefined
  }
  return undefined
}

const BREAK = /[\s"'`]/

/**
 * The class being written at the cursor: `typed` up to the cursor, and the
 * offsets of the whole of it, for completion to replace. Undefined outside a
 * class string.
 */
export function classContextAt(text, offset) {
  const string = classStringAt(text, offset)
  if (string === undefined) return undefined
  let start = offset
  while (start > string && !BREAK.test(text[start - 1]) && text[start - 1] !== '}') start--
  let end = offset
  while (end < text.length && !BREAK.test(text[end]) && text[end] !== '$') end++
  return { start, end, typed: text.slice(start, offset) }
}

/** The class under the cursor, for hover; undefined outside a class string or between classes. */
export function classAt(text, offset) {
  const context = classContextAt(text, offset)
  if (!context || context.end === context.start) return undefined
  return { start: context.start, end: context.end, word: text.slice(context.start, context.end) }
}

/** `md:hover:bg-red-500` as its variants and its class, with `:` inside brackets kept. */
export function splitVariants(token) {
  const parts = []
  let depth = 0
  let from = 0
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth = Math.max(0, depth - 1)
    else if (c === ':' && depth === 0) {
      parts.push(token.slice(from, i))
      from = i + 1
    }
  }
  return { variants: parts, base: token.slice(from) }
}

/**
 * The server's answer made ready to search: the classes in its order, by name for
 * hover, and the variants.
 */
export function indexClassList(list) {
  const classes = Array.isArray(list?.classes) ? list.classes : []
  const byName = new Map()
  for (const [name, css, color] of classes) byName.set(name, { css, color })
  return {
    classes: classes.map(([name]) => name),
    byName,
    variants: Array.isArray(list?.variants) ? list.variants : [],
  }
}

/**
 * What to offer for `typed`: the variants and classes beginning with what is
 * typed after its variants, each with the variants already written in front, at
 * most `limit` of them; `incomplete` when there were more.
 */
export function suggestClasses(index, typed, limit = 500) {
  const { variants, base } = splitVariants(typed)
  const important = base.startsWith('!') ? '!' : ''
  const partial = base.slice(important.length)
  const prefix = variants.map((variant) => `${variant}:`).join('')
  const items = []
  let more = false
  const add = (item) => {
    if (items.length < limit) items.push(item)
    else more = true
  }
  if (!important)
    for (const variant of index.variants)
      if (variant.startsWith(partial) && !variants.includes(variant))
        add({ label: `${prefix}${variant}:`, kind: 'variant' })
  for (const name of index.classes)
    if (name.startsWith(partial)) {
      const { css, color } = index.byName.get(name)
      add({
        label: `${prefix}${important}${name}`,
        kind: 'class',
        css,
        ...(color ? { color } : {}),
      })
    }
  return { items, incomplete: more || partial.length === 0 }
}

/** What hovering a class shows: its CSS, under the variants it is written with. */
export function hoverFor(index, word) {
  const { variants, base } = splitVariants(word)
  const found = index.byName.get(base.replace(/^!/, ''))
  if (!found) return undefined
  return `${variants.length ? `${variants.map((variant) => `${variant}:`).join('')}\n\n` : ''}\`\`\`css\n${found.css}\n\`\`\``
}
