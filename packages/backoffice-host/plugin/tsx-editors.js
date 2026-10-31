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
import { PartialViewService } from '@umbraco-cms/backoffice/external/backend-api'
import { toTsxSnippet } from './tsx-snippets.js'

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

let loaded

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
  return {
    language: 'typescript',
    async prepare() {
      configured = await configureTsx()
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
      // file it is.
      const model = monaco.editor.createModel(
        created.getValue(),
        'typescript',
        monaco.Uri.parse(`${COMPONENTS}/view-${++opened}.tsx`),
      )
      editor.setModel(model)
      created.dispose()
      editor.onDidDispose(() => model.dispose())
    },
    insert: toTsxSnippet,
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
}

export const onInit = async () => {
  const { umbCromboloHooks } = await import('@umbraco-cms/backoffice/extension-registry')
  Object.assign(umbCromboloHooks, TSX_HOOKS)
}
