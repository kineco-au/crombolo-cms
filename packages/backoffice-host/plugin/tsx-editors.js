/**
 * Makes Umbraco's template and partial view editors write and read TSX instead
 * of Razor. Umbraco's client starts a template with a Razor scaffold, writes a
 * Razor `Layout = "x.cshtml"` block for a master template, starts a partial view
 * empty, and opens both in an editor configured for Razor. The fork of the
 * client (story 235) asks `umbCromboloHooks` at each of those places, and this
 * answers: a default-exported component, `export const layout = '<alias>'` for
 * its master, the server's `Empty` snippet for a partial view, and monaco's
 * TypeScript on a `.tsx` model. Snippets inserted into a view are translated to
 * TSX (`tsx-snippets.js`), and the inserts with no TSX equivalent, a partial view
 * (an import as well as a tag) and Razor's sections, are hidden.
 */
import { PartialViewService, TemplateService } from '@umbraco-cms/backoffice/external/backend-api'
import {
  classAt,
  classContextAt,
  hoverFor,
  indexClassList,
  suggestClasses,
} from './tailwind-completion.js'
import { highlightJsx } from './tsx-highlighting.js'
import { toTsxSnippet } from './tsx-snippets.js'
import {
  fileBeingCreated,
  fileLinkInsert,
  fileLinkInsertEntry,
  folderOf,
  importFor,
  memberNotes,
  modelExtension,
  PERSONALISED_PART_DIALOG,
  partInsert,
  personalisedPartInsert,
  withImport,
  withNamedImport,
} from './view-parts.js'

export const SCAFFOLD = `import type { PageProps } from '@crombolo/crombolo'

export default function Template({ model }: PageProps) {
  return (
    <div>
      <h1>{model.name}</h1>
    </div>
  )
}
`

const LAYOUT_EXPORT = /^export\s+const\s+layout\s*=\s*['"][^'"]*['"]\s*;?[ \t]*\n*/m

/**
 * Umbraco's own Razor layout block, the same shape its workspace writes and
 * matches. A TSX view can never legitimately hold one, and the patch below cannot
 * guarantee it is in place before Umbraco's `create()` runs — that method calls
 * `setLayoutTemplate(parent, true)` itself, so on a slow load the unpatched writer
 * can insert a block (with `undefined` for the alias it has not fetched yet)
 * before this module has replaced the method. Stripping it here makes the result
 * the same whichever of the two ran first.
 */
const LAYOUT_BLOCK = /@\{[\s\S]*?Layout\s*=\s*(?:"[^"]*"|null)\s*;[\s\S]*?\}[ \t]*\n*/g

/** `content` with its `export const layout` set to `alias`, or removed when null. */
export function withLayout(content, alias) {
  const rest = content.replace(LAYOUT_BLOCK, '').replace(LAYOUT_EXPORT, '')
  if (!alias) return rest
  const line = `export const layout = '${alias}'\n\n`
  // After the imports, where a view declares it
  const imports = /^(?:import[^\n]*\n)+\n*/.exec(rest)
  if (!imports) return line + rest
  return `${imports[0].replace(/\n*$/, '\n\n')}${line}${rest.slice(imports[0].length)}`
}

/**
 * The dialect a crombolo view is written in. Accepted on `umb-code-editor`'s
 * `language` in place of one of Umbraco's own, and what Umbraco's hard-coded
 * `razor` is read as.
 *
 * monaco has no `tsx` language of its own, and registering one would be a step
 * backwards: TypeScript decides whether a file may contain JSX from its *file
 * name*, and its worker only attaches to the `typescript` and `javascript`
 * modes. A `tsx` language would therefore tokenise and then be ignored by the
 * service every completion and every real error comes from. So the dialect is
 * monaco's `typescript` mode plus a model whose URI ends in `.tsx`.
 */
export const TSX = 'tsx'

/**
 * The virtual directory a view is opened in. It mirrors `components/` on disk so
 * that a view's `../schema/content-types.d.ts` resolves in the editor exactly as
 * it resolves for `tsc`.
 */
const COMPONENTS = 'file:///components'

/**
 * `bundler` module resolution, which is what the site's tsconfig uses and what
 * resolves the served module. monaco's editor-side `ModuleResolutionKind` names
 * only Classic and NodeJs — the enum predates the option — but the worker's own
 * TypeScript knows it, and monaco passes the compiler options through untouched.
 */
const BUNDLER = 100

let opened = 0

function pluginApi() {
  const href = document.querySelector('base')?.getAttribute('href') ?? '/umbraco/'
  return `${href.replace(/\/$/, '')}/crombolo/api`
}

/** What the server checks a view against, and in which JSX mode; no libs if it will not say. */
async function typeLibs() {
  try {
    const response = await fetch(`${pluginApi()}/editor-types`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`the server answered ${response.status}`)
    const body = await response.json()
    return {
      libs: Array.isArray(body?.libs) ? body.libs : [],
      jsxImportSource:
        typeof body?.jsxImportSource === 'string' ? body.jsxImportSource : '@crombolo/crombolo',
    }
  } catch (error) {
    // Said out loud, because the consequence is not obvious: with no types,
    // `@crombolo/crombolo` does not resolve, so there is no `JSX.IntrinsicElements` and
    // TypeScript underlines every tag in the view. Type checking is turned off
    // below rather than left to report that.
    console.error('Crombolo could not fetch the types for the view editor', error)
    return { libs: [], jsxImportSource: '@crombolo/crombolo' }
  }
}

/** The site's Tailwind classes (story 452), or undefined when it has Tailwind off or will not say. */
async function tailwindClasses() {
  try {
    const response = await fetch(`${pluginApi()}/tailwind-classes`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`the server answered ${response.status}`)
    const body = await response.json()
    return body?.enabled ? indexClassList(body) : undefined
  } catch (error) {
    console.warn('Crombolo could not fetch the Tailwind classes for the view editor', error)
    return undefined
  }
}

/** Each view's model and the classes it offers; a model not here offers none. */
const tailwindModels = new WeakMap()
let tailwindRegistered = false

/**
 * The completion and hover providers, registered once on monaco's TypeScript
 * and answering only in a view's model, inside a class string.
 */
function registerTailwind(monaco) {
  if (tailwindRegistered) return
  tailwindRegistered = true
  const { CompletionItemKind } = monaco.languages
  monaco.languages.registerCompletionItemProvider('typescript', {
    triggerCharacters: ['"', "'", '`', ' ', ':', '-'],
    provideCompletionItems(model, position) {
      const index = tailwindModels.get(model)
      if (!index) return { suggestions: [] }
      const text = model.getValue()
      const at = classContextAt(text, model.getOffsetAt(position))
      if (!at) return { suggestions: [] }
      const { items, incomplete } = suggestClasses(index, at.typed)
      const from = model.getPositionAt(at.start)
      const to = model.getPositionAt(at.end)
      const range = new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column)
      return {
        incomplete,
        suggestions: items.map((item, order) => ({
          label: item.label,
          insertText: item.label,
          filterText: item.label,
          sortText: String(order).padStart(5, '0'),
          range,
          kind: item.color
            ? CompletionItemKind.Color
            : item.kind === 'variant'
              ? CompletionItemKind.Keyword
              : CompletionItemKind.Constant,
          detail: item.css ? item.css.replace(/\s+/g, ' ') : 'variant',
          // A colour's documentation is the colour, which monaco draws as a swatch.
          documentation:
            item.color ?? (item.css ? { value: `\`\`\`css\n${item.css}\n\`\`\`` } : undefined),
          ...(item.kind === 'variant'
            ? { command: { id: 'editor.action.triggerSuggest', title: 'Classes' } }
            : {}),
        })),
      }
    },
  })
  monaco.languages.registerHoverProvider('typescript', {
    provideHover(model, position) {
      const index = tailwindModels.get(model)
      if (!index) return null
      const at = classAt(model.getValue(), model.getOffsetAt(position))
      const shown = at && hoverFor(index, at.word)
      if (!shown) return null
      const from = model.getPositionAt(at.start)
      const to = model.getPositionAt(at.end)
      return {
        range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
        contents: [{ value: shown }],
      }
    },
  })
}

let loaded
let highlighted

/**
 * Configures monaco's TypeScript service for TSX, and reports both monaco and
 * whether the dialect is usable.
 *
 * Done on the first view to open rather than at boot, because monaco is several
 * megabytes and most sessions never open one. The types are asked for every time
 * instead of once, so a content type a colleague added is in this editor as
 * soon as the view is reopened; the endpoint tags them, so the browser fetches
 * them again only when they have changed.
 */
async function configureTsx() {
  let monaco
  try {
    loaded ??= import('@umbraco-cms/backoffice/external/monaco-editor')
    monaco = (await loaded).monaco
    // `monaco.typescript`, not `monaco.languages.typescript`: monaco exports each
    // language service as its own top-level namespace, and the nested form is
    // where older versions kept it. Read both, because getting this wrong is what
    // went wrong the first time — and it went wrong quietly.
    const ts = monaco.typescript ?? monaco.languages?.typescript
    if (!ts) throw new Error('monaco exposes no TypeScript service')
    const { JsxEmit, ModuleKind, ScriptTarget, typescriptDefaults } = ts
    // Colours the markup, which monaco's TypeScript grammar leaves plain.
    highlighted ??= highlightJsx(monaco)
    await highlighted
    const { libs, jsxImportSource } = await typeLibs()
    // The site's `apps/site/tsconfig.json`, so that what the editor underlines
    // is what `tsc` would report and nothing else — down to the JSX mode the
    // site chose, `@crombolo/crombolo` or `@crombolo/crombolo/loose`.
    typescriptDefaults.setCompilerOptions({
      allowNonTsExtensions: true,
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      moduleResolution: BUNDLER,
      jsx: JsxEmit.ReactJSX,
      jsxImportSource,
      allowImportingTsExtensions: true,
      noEmit: true,
      strict: true,
    })
    // Replaced wholesale rather than added one at a time, so a refresh cannot
    // leave a stale copy of the generated types behind.
    typescriptDefaults.setExtraLibs(
      libs.map((lib) => ({ filePath: lib.path, content: lib.content })),
    )
    // Without the types, every name in the view is unresolved and checking it
    // says nothing true. Syntax is still worth checking, and the dialect —
    // highlighting, brackets, JSX that parses — is unaffected either way.
    typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: libs.length === 0,
      noSyntaxValidation: false,
    })
    return { monaco, ok: true }
  } catch (error) {
    // Reported rather than swallowed. Configured against the wrong namespace,
    // this failed silently and turned every tag in a view red — and a console
    // error is what the browser suite fails a test on, so the next time this
    // breaks a test says so instead of a person noticing.
    console.error('Crombolo could not configure the TSX dialect for the view editor', error)
    return { monaco, ok: false }
  }
}

/**
 * How a view's code editor works, for the fork's `viewEditor` seam: monaco's
 * `typescript` on a model named as a `.tsx` file, configured before the editor is
 * made, with inserted snippets translated.
 */
function viewEditor() {
  let configured = { monaco: undefined, ok: false }
  let model
  let file
  let classes
  return {
    language: 'typescript',
    async prepare() {
      ;[configured, classes] = await Promise.all([configureTsx(), tailwindClasses()])
      file = await openFile()
    },
    created(editor) {
      const { monaco, ok } = configured
      const created = editor?.getModel?.()
      if (!monaco || !created) return
      if (!ok) {
        // Without the dialect, TypeScript reads a view as a plain `.ts` file and
        // underlines every tag in it. Plain text says less and lies less.
        monaco.editor.setModelLanguage(created, 'plaintext')
        return
      }
      // monaco names the model it creates `inmemory://model/1`, and a name with no
      // `.tsx` on it is a file TypeScript refuses to read JSX in: every tag in the
      // view would be a syntax error. So the model is replaced by one named as the
      // file it is, in its own folder, so that its relative imports resolve.
      model = monaco.editor.createModel(
        created.getValue(),
        'typescript',
        monaco.Uri.parse(`${COMPONENTS}${folderOf(file)}/view-${++opened}${modelExtension(file)}`),
      )
      editor.setModel(model)
      created.dispose()
      editor.onDidDispose(() => model.dispose())
      // Story 452: Tailwind's classes as they are typed, strings included.
      if (classes) {
        tailwindModels.set(model, classes)
        registerTailwind(monaco)
        editor.updateOptions?.({
          quickSuggestions: { other: true, comments: false, strings: true },
        })
      }
      // Story 264: a file that shows the signed-in member says what that does to sharing.
      const note = () =>
        monaco.editor.setModelMarkers(
          model,
          'crombolo-member',
          memberNotes(model.getValue()).map((at) => ({
            severity: monaco.MarkerSeverity.Info,
            message: at.message,
            startLineNumber: at.line,
            startColumn: at.start,
            endLineNumber: at.line,
            endColumn: at.end,
          })),
        )
      note()
      let pending
      model.onDidChangeContent(() => {
        clearTimeout(pending)
        pending = setTimeout(note, 300)
      })
    },
    insert(text) {
      // Story 450: a link to a File is a tag at the cursor and `file` imported.
      const link = fileLinkInsert(text)
      if (link && model) {
        const before = model.getValue()
        const after = withNamedImport(before, 'file', '@crombolo/crombolo')
        if (after !== before) {
          const { monaco } = configured
          let start = 0
          while (start < before.length && before[start] === after[start]) start += 1
          let end = 0
          while (
            end < before.length - start &&
            before[before.length - 1 - end] === after[after.length - 1 - end]
          )
            end += 1
          const from = model.getPositionAt(start)
          const to = model.getPositionAt(before.length - end)
          model.pushEditOperations(
            [],
            [
              {
                range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
                text: after.slice(start, after.length - end),
              },
            ],
            () => null,
          )
        }
        return link.tag
      }
      // A part is a tag at the cursor and an import at the top (story 264).
      const part = partInsert(text)
      if (!part || !model) return toTsxSnippet(text)
      const line = importFor(part.path, file)
      const next = withImport(model.getValue(), line)
      if (next !== model.getValue()) {
        const { monaco } = configured
        const at = /^(?:import[^\n]*\n)*/.exec(model.getValue())?.[0].split('\n').length ?? 1
        model.pushEditOperations(
          [],
          [{ range: new monaco.Range(at, 1, at, 1), text: `${line}\n` }],
          () => null,
        )
      }
      return part.tag
    },
  }
}

/** The view open in the editor, as a path under `components/`, from the address. */
async function openFile() {
  const creating = fileBeingCreated(location.pathname)
  if (creating) return creating
  const partial = /\/workspace\/partial-view\/edit\/([^/?#]+)/.exec(location.pathname)
  if (partial) return decodeURIComponent(partial[1]).replace('%dot%', '.')
  const template = /\/workspace\/template\/edit\/([0-9a-f-]{36})/i.exec(location.pathname)
  if (!template) return undefined
  try {
    const { data } = await TemplateService.getTemplateById({ path: { id: template[1] } })
    return data?.alias ? `/${data.alias}.tsx` : undefined
  } catch {
    return undefined
  }
}

/** The fork's seams, answered for TSX views. */
export const TSX_HOOKS = {
  viewEditor: (language) => (language === TSX || language === 'razor' ? viewEditor() : undefined),
  templateScaffold: () => SCAFFOLD,
  async partialViewScaffold() {
    const { data } = await PartialViewService.getPartialViewSnippetById({ path: { id: 'Empty' } })
    return data?.content
  },
  writeLayout: withLayout,
  translateSnippet: toTsxSnippet,
  viewLanguageLabel: 'TypeScript',
  hideRazorInserts: true,
  // A partial view is a tag and an import, which `insert` writes (story 264).
  showPartialViewInsert: true,
  extraInserts: [personalisedPartInsert, fileLinkInsertEntry],
}

export const onInit = async (_host, extensionRegistry) => {
  extensionRegistry?.register(PERSONALISED_PART_DIALOG)
  const { umbCromboloHooks } = await import('@umbraco-cms/backoffice/extension-registry')
  Object.assign(umbCromboloHooks, TSX_HOOKS)
}
