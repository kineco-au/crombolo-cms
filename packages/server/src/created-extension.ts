/**
 * A Bundle Editor definition built as an extension for other sites (story 312):
 * the templates and partial views it picks are its code, under `src/server/components/`
 * with a factory that declares them, and render in its own process where it is
 * installed. Its schema and pages name them by its id, `<id>/<alias>`. The rest
 * is its payload, as data. docs/bundles.md, "The Bundle Editor".
 */
import type { BundleFile, BundlePackageInfo, ContentSet } from '@crombolo/transfer'

const COMPONENTS = 'components/'

/** The factory the generated entry exports, which `crombolo.server` names. */
export const CREATED_EXTENSION_FACTORY = 'extension'

/** Each `"alias"` in a TOML string list or string that names a picked component, as `"<id>/alias"`. */
function renamed(text: string, id: string, aliases: ReadonlySet<string>): string {
  const quoted = (value: string) =>
    value.replace(/"([^"]+)"/g, (whole, alias: string) =>
      aliases.has(alias) ? `"${id}/${alias}"` : whole,
    )
  return text
    .replace(
      /^(\s*components\s*=\s*\[)([^\]]*)(\])/gm,
      (_, open, list, close) => `${open}${quoted(list)}${close}`,
    )
    .replace(
      /^(\s*default-component\s*=\s*)("[^"]*")/gm,
      (_, key, value) => `${key}${quoted(value)}`,
    )
}

/** A component file's alias: its path under `components/`, a folder template by its folder. */
const aliasOf = (path: string) =>
  path
    .slice(COMPONENTS.length)
    .replace(/\/page\.tsx$/, '')
    .replace(/\.tsx$/, '')

/**
 * The payload without its components, its schema and pages naming them under
 * `id`, and the code that carries them; no code when nothing is picked.
 */
export function createdExtension(
  id: string,
  sections: readonly BundleFile[],
  set: ContentSet,
): { payload: BundleFile[]; set: ContentSet; code?: BundlePackageInfo['code'] } {
  const components = sections.filter((file) => file.path.startsWith(COMPONENTS))
  if (components.length === 0) return { payload: [...sections], set }
  // Each component it carries, by alias: what the picks were, whichever way they were named.
  const aliases = new Set(
    components.filter((file) => file.path.endsWith('.tsx')).map((file) => aliasOf(file.path)),
  )
  const payload = sections
    .filter((file) => !file.path.startsWith(COMPONENTS))
    .map((file) =>
      file.path.startsWith('schema/') && file.path.endsWith('.toml') && file.text !== undefined
        ? { ...file, text: renamed(file.text, id, aliases) }
        : file,
    )
  const renamedSet: ContentSet = {
    ...set,
    nodes: set.nodes.map((node) =>
      node.template && aliases.has(node.template)
        ? { ...node, template: `${id}/${node.template}` }
        : node,
    ),
  }
  const declared = components.filter((file) => file.path.endsWith('.tsx'))
  const entry = [
    '// Written by the Bundle Editor (story 312): the components this extension brings.',
    ...declared.map((file, index) => `import * as c${index} from './${file.path}'`),
    '',
    `export function ${CREATED_EXTENSION_FACTORY}() {`,
    '  return {',
    `    id: ${JSON.stringify(id)},`,
    "    section: 'content',",
    '    capabilities: [],',
    '    components: {',
    ...declared.map((file, index) => `      ${JSON.stringify(aliasOf(file.path))}: c${index},`),
    '    },',
    '  }',
    '}',
    '',
  ].join('\n')
  return {
    payload,
    set: renamedSet,
    code: {
      entry: 'src/server/index.ts',
      server: CREATED_EXTENSION_FACTORY,
      permissions: {
        templates: 'Renders the templates and partial views it brings in your pages',
      },
      files: [
        { path: 'src/server/index.ts', text: entry },
        ...components.map((file) => ({ ...file, path: `src/server/${file.path}` })),
      ],
    },
  }
}
