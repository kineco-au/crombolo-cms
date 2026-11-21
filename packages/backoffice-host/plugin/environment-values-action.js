/**
 * "Values per environment" on a property's actions (story 387): a dialog with the
 * shared value, read only here as the field edits it, and a row per environment to set
 * or clear, the current one marked. Saved as an edit of the page; it is published with
 * the page. Registered by `environment-values.js`.
 */
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document'
import { UMB_PROPERTY_CONTEXT } from '@umbraco-cms/backoffice/property'
import { UmbPropertyActionBase } from '@umbraco-cms/backoffice/property-action'
import {
  asText,
  NOT_SECRET,
  readEnvironments,
  readPageValues,
  rowsFor,
  saveValue,
} from './environment-values.js'

const text = (tag, content, attrs = {}) => {
  const el = document.createElement(tag)
  el.textContent = content
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

export class CromboloEnvironmentValuesAction extends UmbPropertyActionBase {
  async execute() {
    const property = await this.getContext(UMB_PROPERTY_CONTEXT)
    const workspace = await this.getContext(UMB_DOCUMENT_WORKSPACE_CONTEXT)
    const alias = property?.getAlias?.()
    const key = workspace?.getUnique?.()
    if (!alias || !key) return
    const [environments, items] = await Promise.all([readEnvironments(), readPageValues(key, true)])
    const item = items.find((i) => i.alias === alias)
    if (!item) return
    const dialog = document.createElement('dialog')
    dialog.className = 'crombolo-environment-values'
    dialog.append(text('h3', `${item.name}: values per environment`))
    dialog.append(text('p', NOT_SECRET))
    dialog.append(text('p', `Shared: ${asText(item.shared) || '(empty)'}`))
    const status = text('p', '')
    for (const row of rowsFor(item, environments)) {
      const label = row.unused
        ? `${row.environment} (no longer one of this site's environments)`
        : row.current
          ? `${row.environment} (this one)`
          : row.environment
      const line = document.createElement('div')
      line.append(text('label', label))
      const input = document.createElement('input')
      input.value = asText(row.value)
      input.placeholder = 'Uses the shared value'
      input.disabled = environments.readOnly
      const save = text('button', row.unused ? 'Remove' : 'Save', { type: 'button' })
      save.disabled = environments.readOnly
      save.addEventListener('click', async () => {
        try {
          await saveValue(key, item, row.environment, row.unused ? '' : input.value)
          status.textContent = `Saved for ${row.environment}. Publish the page for it to show there.`
        } catch (error) {
          status.textContent = String(error.message ?? error)
        }
      })
      line.append(input, save)
      dialog.append(line)
    }
    if (environments.readOnly)
      dialog.append(text('p', 'These values arrive here by a change from where they are made.'))
    dialog.append(status)
    const close = text('button', 'Close', { type: 'button' })
    close.addEventListener('click', () => dialog.close())
    dialog.addEventListener('close', () => dialog.remove())
    dialog.append(close)
    document.body.append(dialog)
    dialog.showModal()
  }
}

export default CromboloEnvironmentValuesAction

export { CromboloEnvironmentValuesAction as api }
