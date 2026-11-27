/**
 * The content footer's three actions, each a strong tone from the palette with light text
 * (`buttons.js`): Save and preview cocoa, Save the accent, Save and publish green.
 *
 * Re-registered under Umbraco's own aliases, so what hangs off them (the menu beside
 * publishing, preview's menu items, Send for approval's place) still finds them. Each keeps
 * its own element and api; the element only gains the tone.
 */
import { loadManifestElement } from '@umbraco-cms/backoffice/extension-api'
import { UmbWorkspaceActionElement } from '@umbraco-cms/backoffice/workspace'
import { TONED_META, toned } from './buttons.js'

export const CONTENT_ACTION_TONES = {
  'Umb.WorkspaceAction.Document.SaveAndPreview': 'cocoa',
  'Umb.WorkspaceAction.Document.Save': 'accent',
  'Umb.WorkspaceAction.Document.SaveAndPublish': 'positive',
}

/** `alias` re-registered with its element toned, leaving the rest as Umbraco wrote it. */
export async function retone(extensionRegistry, alias, tone) {
  const manifest = extensionRegistry.getByAlias(alias)
  if (!manifest) return false
  const Base = manifest.element
    ? await loadManifestElement(manifest.element)
    : UmbWorkspaceActionElement
  if (!Base) return false
  const tag = `crombolo-${alias.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const Toned = customElements.get(tag) ?? toned(Base, tone)
  if (!customElements.get(tag)) customElements.define(tag, Toned)
  extensionRegistry.unregister(alias)
  extensionRegistry.register({
    ...manifest,
    element: () => Promise.resolve({ default: Toned }),
    meta: { ...manifest.meta, ...TONED_META },
  })
  return true
}

export const onInit = async (_host, extensionRegistry) => {
  for (const [alias, tone] of Object.entries(CONTENT_ACTION_TONES))
    await retone(extensionRegistry, alias, tone)
}
