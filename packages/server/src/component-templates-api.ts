/**
 * `<backoffice>/crombolo/api/templates` (outside the contract): every component
 * on disk, for a page's template picker, with the template a content type would
 * name it by, where it has one. A component nothing names yet has no template
 * row; registering one makes the row, as the schema sync would when a type first
 * names it, and leaves the file alone.
 */
import { hasSection, type Principal } from '@crombolo/api-management'
import { ComponentRepository, type Db } from '@crombolo/data'
import { listComponents } from './components.ts'

export interface ComponentTemplate {
  alias: string
  /** The template's key, or null for a component no template row names yet. */
  id: string | null
  /** The extension that renders it, by name, when one does (story 312). */
  extension?: string
}

/**
 * Every component on disk, every extension's, and every template row, joined by
 * alias, by alias. The site's own file wins over an extension's of the same alias. Pure.
 */
export function componentTemplates(
  onDisk: readonly string[],
  rows: readonly { key: string; alias: string }[],
  extensions: readonly { alias: string; extension: string }[] = [],
): ComponentTemplate[] {
  const keys = new Map(rows.map((row) => [row.alias, row.key]))
  const files = new Set(onDisk)
  const owners = new Map(
    extensions
      .filter((entry) => !files.has(entry.alias))
      .map((entry) => [entry.alias, entry.extension]),
  )
  const aliases = new Set([...onDisk, ...owners.keys(), ...rows.map((row) => row.alias)])
  return [...aliases].sort().map((alias) => {
    const extension = owners.get(alias)
    return { alias, id: keys.get(alias) ?? null, ...(extension ? { extension } : {}) }
  })
}

export async function handleComponentTemplates(
  request: Request,
  principal: Principal,
  options: {
    db: Db
    componentsDir: string
    /** The extensions' components, read-only, each with its extension's name. */
    extensionComponents?: () => readonly { alias: string; extension: string }[]
  },
): Promise<Response> {
  const repo = new ComponentRepository(options.db)
  const onDisk = listComponents(options.componentsDir).map((file) => file.alias)
  const extensions = options.extensionComponents?.() ?? []

  if (request.method === 'GET')
    return Response.json({ items: componentTemplates(onDisk, await repo.all(), extensions) })

  if (request.method === 'POST') {
    // As changing which templates a type allows: Settings.
    if (!hasSection(principal, 'settings'))
      return Response.json(
        { message: 'Making a component a template needs access to Structure.' },
        { status: 403 },
      )
    const body = (await request.json().catch(() => ({}))) as { alias?: unknown }
    const alias = typeof body.alias === 'string' ? body.alias : ''
    if (!onDisk.includes(alias) && !extensions.some((entry) => entry.alias === alias))
      return Response.json({ message: 'There is no component with that name.' }, { status: 404 })
    const existing = await repo.byAlias(alias)
    if (existing) return Response.json({ id: existing.key })
    const saved = await repo.save({ key: crypto.randomUUID(), name: alias, alias, content: null })
    return Response.json({ id: saved.key }, { status: 201 })
  }
  return new Response('Method Not Allowed', { status: 405 })
}
