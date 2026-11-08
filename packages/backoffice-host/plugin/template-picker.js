/**
 * A page's template picker (the Info view's "Choose"): a panel that slides in, as
 * Umbraco's pickers do, with every component in a tree of its folders
 * (`template-picker-modal.js`). The fork asks for it through
 * `umbCromboloHooks.pickTemplate`.
 */
import { UMB_CURRENT_USER_CONTEXT } from '@umbraco-cms/backoffice/current-user'

export const TEMPLATE_PICKER_MODAL = 'Crombolo.Modal.TemplatePicker'
const STRUCTURE = 'Crombolo.Section.Structure'

/** Whether the reader may change a content type: Structure, which Settings brings. */
async function mayChangeTypes(host) {
  const context = await host.getContext?.(UMB_CURRENT_USER_CONTEXT).catch(() => undefined)
  if (!context) return false
  const user = await new Promise((resolve) => {
    const subscription = context.currentUser.subscribe((current) => {
      resolve(current)
      queueMicrotask(() => subscription.unsubscribe())
    })
  })
  return user?.isAdmin === true || (user?.allowedSections ?? []).includes(STRUCTURE)
}

export const onInit = async (_host, extensionRegistry) => {
  extensionRegistry.register({
    type: 'modal',
    alias: TEMPLATE_PICKER_MODAL,
    name: 'Crombolo Template Picker',
    element: () => import('./template-picker-modal.js'),
  })
  const [{ umbCromboloHooks }, { UmbModalToken, umbOpenModal }] = await Promise.all([
    import('@umbraco-cms/backoffice/extension-registry'),
    import('@umbraco-cms/backoffice/modal'),
  ])
  const token = new UmbModalToken(TEMPLATE_PICKER_MODAL, {
    modal: { type: 'sidebar', size: 'medium' },
  })
  umbCromboloHooks.pickTemplate = async (host, args) =>
    umbOpenModal(host, token, {
      data: { ...args, mayAllow: await mayChangeTypes(host) },
    }).catch(() => undefined)
}
