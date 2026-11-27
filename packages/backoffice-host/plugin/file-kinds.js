/**
 * The kinds of File in the content tree (story 450): which editor a File's
 * name opens its body in, and the checks on its name and body. The same
 * module runs in the File's editor as you type and on the server when it is
 * saved, so a File that isn't well-formed is never published. The table
 * matches `FILE_KINDS` in `@crombolo/core`, which `tests/file-items.test.ts`
 * holds it to.
 */

/** Extension, served as, editor, checked as. */
export const FILE_KINDS = [
  ['.txt', 'text/plain; charset=utf-8', 'text'],
  ['.md', 'text/markdown; charset=utf-8', 'markdown'],
  ['.json', 'application/json', 'json', 'json'],
  ['.xml', 'application/xml', 'xml', 'xml'],
  ['.csv', 'text/csv; charset=utf-8', 'csv'],
  ['.webmanifest', 'application/manifest+json', 'json', 'json'],
  ['.html', 'text/html; charset=utf-8', 'html'],
  ['.svg', 'image/svg+xml', 'svg', 'xml'],
  ['.pdf', 'application/pdf', 'upload'],
  ['.png', 'image/png', 'upload'],
  ['.jpg', 'image/jpeg', 'upload'],
  ['.jpeg', 'image/jpeg', 'upload'],
  ['.gif', 'image/gif', 'upload'],
  ['.webp', 'image/webp', 'upload'],
  ['.ico', 'image/x-icon', 'upload'],
].map(([extension, contentType, editor, check]) => ({
  extension,
  contentType,
  editor,
  text: editor !== 'upload',
  ...(check ? { check } : {}),
}))

export const FILE_EXTENSIONS = FILE_KINDS.map((kind) => kind.extension)

/** The largest upload a File takes. */
export const FILE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024

const WELL_KNOWN = '.well-known'

/** `agents.md` is `.md`; a name with none, or only a leading dot, has none. Pure. */
export const extensionOf = (name) => {
  const dot = (name ?? '').lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/** The kind a File's name makes it; undefined for a folder or an extension off the list. Pure. */
export const kindOf = (name) => {
  const extension = extensionOf(name)
  return extension ? FILE_KINDS.find((kind) => kind.extension === extension) : undefined
}

/** The editor a File's body opens in: one per kind, `folder` for a name with no extension. Pure. */
export const editorFor = (name) => {
  if (!extensionOf(name)) return 'folder'
  return kindOf(name)?.editor ?? 'unknown'
}

/** Whether a body is an upload: one already kept, or one just sent. Pure. */
export const isUpload = (value) =>
  Boolean(value && typeof value === 'object' && (value.src || value.temporaryFileId))

/** Why a File can't have this name, or undefined when it can. Pure. */
export function nameProblem(name, parentName) {
  if (typeof name !== 'string' || name.length === 0) return 'A File needs a name.'
  if (name !== name.trim()) return "A File's name can't start or end with a space."
  if (/[/?#\\]/.test(name))
    return `A File's name is one part of its address, so it can't have / ? # or \\ in it.`
  // biome-ignore lint/suspicious/noControlCharactersInRegex: a control character is what it refuses
  if (/[\u0000-\u001f\u007f]/.test(name))
    return "A File's name can't have control characters in it."
  if (name === '.' || name === '..') return `A File can't be named ${name}.`
  if (name.startsWith('.') && name !== WELL_KNOWN && parentName !== WELL_KNOWN)
    return `A File's name can't start with a dot, except inside ${WELL_KNOWN}.`
  const extension = extensionOf(name)
  if (extension && !kindOf(name))
    return `${extension} isn't a kind of File this site serves. Use one of: ${FILE_EXTENSIONS.join(', ')}.`
  return undefined
}

/**
 * Why a File's body can't be saved with its name, or undefined when it can:
 * `{ message, line?, column? }`. `upload` is the name and size of an upload
 * just sent, where the body is one. Pure.
 */
export function bodyProblem(name, value, upload) {
  const kind = kindOf(name)
  const text = typeof value === 'string' ? value : undefined
  const uploaded = isUpload(value)
  if (!extensionOf(name)) {
    if (uploaded || (text && text.length > 0))
      return {
        message:
          'A File with no extension is a folder and has no body. Give it a name with an extension, such as notes.txt, to serve its body.',
      }
    return undefined
  }
  if (!kind) return undefined
  if (uploaded) {
    const sent = upload?.name ?? value.name ?? value.src
    const sentKind = sent ? kindOf(sent.split('/').pop()) : undefined
    if (sentKind && sentKind.contentType !== kind.contentType)
      return {
        message: `The upload is a ${extensionOf(sent)} file and this File is a ${kind.extension}. Replace the body with a ${kind.extension} file, or rename the File.`,
      }
    const size = upload?.size ?? value.size
    if (typeof size === 'number' && size > FILE_UPLOAD_MAX_BYTES)
      return { message: `The upload is ${megabytes(size)}; a File takes at most 10 MB.` }
    return undefined
  }
  if (!kind.text) {
    if (text && text.length > 0)
      return {
        message: `A ${kind.extension} File's body is an uploaded file, not text. Replace the body with an upload.`,
      }
    return { message: `A ${kind.extension} File needs an uploaded file as its body.` }
  }
  if (!text) return undefined
  if (kind.check === 'json') return wellFormedJson(text)
  if (kind.check === 'xml') return wellFormedXml(text)
  return undefined
}

const megabytes = (bytes) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`

/** Line and column, from 1, of an offset in `text`. Pure. */
function place(text, offset) {
  const before = text.slice(0, offset).split('\n')
  return { line: before.length, column: before[before.length - 1].length + 1 }
}

function refusal(kind, text, offset, what) {
  const at = place(text, Math.min(offset, text.length))
  return {
    message: `This isn't well-formed ${kind}: ${what} at line ${at.line}, column ${at.column}.`,
    ...at,
  }
}

/** Why `text` isn't JSON, with where, or undefined when it is. Pure. */
export function wellFormedJson(text) {
  let i = 0
  const fail = (what) => {
    throw { offset: i, what }
  }
  const space = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++
  }
  const literal = (word) => {
    if (text.slice(i, i + word.length) !== word) fail('an unexpected character')
    i += word.length
  }
  const string = () => {
    i++
    while (i < text.length) {
      const c = text[i]
      if (c === '"') {
        i++
        return
      }
      if (c === '\\') {
        const next = text[i + 1]
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('a broken \\u escape')
          i += 6
        } else if (next !== undefined && '"\\/bfnrt'.includes(next)) i += 2
        else fail('a broken escape')
      } else if (c < ' ') fail('a line break or control character inside a string')
      else i++
    }
    fail('a string that never ends')
  }
  const number = () => {
    const found = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i))
    if (!found) fail('a broken number')
    i += found[0].length
  }
  const value = () => {
    space()
    const c = text[i]
    if (c === '{') {
      i++
      space()
      if (text[i] === '}') {
        i++
        return
      }
      for (;;) {
        space()
        if (text[i] !== '"') fail('a name in quotes expected')
        string()
        space()
        if (text[i] !== ':') fail('a colon expected')
        i++
        value()
        space()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === '}') {
          i++
          return
        }
        fail('a comma or } expected')
      }
    }
    if (c === '[') {
      i++
      space()
      if (text[i] === ']') {
        i++
        return
      }
      for (;;) {
        value()
        space()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === ']') {
          i++
          return
        }
        fail('a comma or ] expected')
      }
    }
    if (c === '"') return string()
    if (c === 't') return literal('true')
    if (c === 'f') return literal('false')
    if (c === 'n') return literal('null')
    if (c === '-' || (c >= '0' && c <= '9')) return number()
    fail(c === undefined ? 'the text ends too soon' : 'an unexpected character')
  }
  try {
    value()
    space()
    if (i < text.length) fail('more after the end')
    return undefined
  } catch (error) {
    return refusal('JSON', text, error.offset, error.what)
  }
}

const NAME = /^[A-Za-z_:À-￿][\w.:\-·À-￿]*/
const PREDEFINED = new Set(['amp', 'lt', 'gt', 'quot', 'apos'])

/** Why `text` isn't well-formed XML, with where, or undefined when it is. Pure. */
export function wellFormedXml(text) {
  let i = 0
  const open = []
  let roots = 0
  const fail = (what, at = i) => {
    throw { offset: at, what }
  }
  const skipTo = (end, what) => {
    const found = text.indexOf(end, i)
    if (found < 0) fail(what)
    i = found + end.length
  }
  const entity = () => {
    const found = /^&(#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z_][\w.-]*);/.exec(text.slice(i))
    if (!found || (!found[1].startsWith('#') && !PREDEFINED.has(found[1])))
      fail('an & that is not an entity such as &amp;')
    i += found[0].length
  }
  try {
    if (text.charCodeAt(0) === 0xfeff) i = 1
    while (i < text.length) {
      const c = text[i]
      if (c === '<') {
        if (text.startsWith('<!--', i)) skipTo('-->', 'a comment that never ends')
        else if (text.startsWith('<![CDATA[', i)) {
          if (open.length === 0) fail('text outside the root element')
          skipTo(']]>', 'a CDATA section that never ends')
        } else if (text.startsWith('<?', i)) skipTo('?>', 'an instruction that never ends')
        else if (text.startsWith('<!DOCTYPE', i)) {
          let depth = 0
          for (i += 9; i < text.length; i++) {
            if (text[i] === '[') depth++
            else if (text[i] === ']') depth--
            else if (text[i] === '>' && depth <= 0) break
          }
          if (i >= text.length) fail('a DOCTYPE that never ends')
          i++
        } else if (text[i + 1] === '/') {
          const start = i
          i += 2
          const name = NAME.exec(text.slice(i))?.[0]
          if (!name) fail('a closing tag with no name')
          i += name.length
          while (' \t\n\r'.includes(text[i]) && i < text.length) i++
          if (text[i] !== '>') fail('a closing tag that never ends')
          i++
          const expected = open.pop()
          if (expected === undefined) fail(`</${name}> with nothing open`, start)
          if (expected !== name) fail(`</${name}> where </${expected}> was expected`, start)
        } else {
          i++
          const name = NAME.exec(text.slice(i))?.[0]
          if (!name) fail('a < that does not start a tag')
          if (open.length === 0 && ++roots > 1) fail('a second root element', i - 1)
          i += name.length
          const seen = new Set()
          for (;;) {
            const gap = /^[ \t\n\r]*/.exec(text.slice(i))[0].length
            i += gap
            if (text.startsWith('/>', i)) {
              i += 2
              break
            }
            if (text[i] === '>') {
              i++
              open.push(name)
              break
            }
            if (i >= text.length) fail(`a <${name}> tag that never ends`)
            if (gap === 0) fail('attributes without a space between them')
            const attribute = NAME.exec(text.slice(i))?.[0]
            if (!attribute) fail('an unexpected character in a tag')
            if (seen.has(attribute)) fail(`the attribute ${attribute} twice`)
            seen.add(attribute)
            i += attribute.length
            i += /^[ \t\n\r]*/.exec(text.slice(i))[0].length
            if (text[i] !== '=') fail(`the attribute ${attribute} with no value`)
            i++
            i += /^[ \t\n\r]*/.exec(text.slice(i))[0].length
            const quote = text[i]
            if (quote !== '"' && quote !== "'")
              fail(`the attribute ${attribute}'s value not in quotes`)
            i++
            while (text[i] !== quote) {
              if (i >= text.length) fail('an attribute value that never ends')
              if (text[i] === '<') fail('a < inside an attribute value')
              if (text[i] === '&') entity()
              else i++
            }
            i++
          }
        }
      } else if (c === '&') {
        if (open.length === 0) fail('text outside the root element')
        entity()
      } else {
        if (open.length === 0 && !' \t\n\r'.includes(c)) fail('text outside the root element')
        i++
      }
    }
    if (open.length > 0) fail(`<${open[open.length - 1]}> is never closed`)
    if (roots === 0) fail('no root element')
    return undefined
  } catch (error) {
    return refusal('XML', text, error.offset, error.what)
  }
}

/** The first rows of a CSV, as cells, for the table beside its editor. Pure. */
export function csvRows(text, limit = 20) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length && rows.length < limit; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if ((cell !== '' || row.length > 0) && rows.length < limit) rows.push([...row, cell])
  return rows
}

/** The note above an editor that is showing the wrong kind of body for the File's name. Pure. */
export function replaceNote(name, value) {
  const editor = editorFor(name)
  if (editor === 'folder' || editor === 'unknown') return undefined
  const extension = extensionOf(name)
  if (editor === 'upload' && typeof value === 'string' && value.length > 0)
    return `This File's body is text, and a ${extension} File's body is an uploaded file. Replace it with an upload to save the File.`
  if (editor !== 'upload' && isUpload(value) && value.src) {
    const sent = value.name ?? value.src.split('/').pop()
    if (kindOf(sent)?.contentType !== kindOf(name)?.contentType)
      return `This File's body is an uploaded ${extensionOf(sent) || 'file'}, and this File is a ${extension}. Replace it to save the File.`
  }
  return undefined
}

/** A size as people say it. Pure. */
export const sizeText = (bytes) =>
  bytes >= 1024 * 1024
    ? `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`
    : bytes >= 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${bytes} bytes`
