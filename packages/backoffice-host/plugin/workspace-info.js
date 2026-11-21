/**
 * A page's Info, in workspaces (story 384): in a workspace, each field it changed set
 * against Shared's; and wherever it is opened, that another workspace has changed it
 * too, and whose, before it becomes a conflict at the merge. Never what they changed.
 */
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { currentWorkspace, workspacesApi } from './workspace-client.js'

const shown = (value) =>
  value === null || value === undefined
    ? '(empty)'
    : typeof value === 'string'
      ? value
      : JSON.stringify(value)

export default class CromboloWorkspaceInfoElement extends UmbLitElement {
  static properties = { _fields: { state: true }, _others: { state: true } }

  #key

  constructor() {
    super()
    this._fields = []
    this._others = []
    this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (context) => {
      this.observe(context?.unique, (unique) => {
        if (!unique || unique === this.#key) return
        this.#key = unique
        this.#load()
      })
    })
  }

  async #load() {
    const current = currentWorkspace()
    const touched = await workspacesApi.touched(this.#key).catch(() => ({ items: [] }))
    this._others = touched.items ?? []
    if (current?.key && current.key !== 'shared') {
      const diff = await workspacesApi.diff(current.key).catch(() => ({ pages: [] }))
      this._fields = (diff.pages ?? []).find((p) => p.key === this.#key)?.fields ?? []
    }
  }

  render() {
    if (this._fields.length === 0 && this._others.length === 0) return nothing
    return html`<umb-workspace-info-app-layout headline="Workspaces">
      <div class="body">
        ${this._others.map(
          (o) =>
            html`<p>Also changed in a workspace by ${o.owner}${o.workspace ? ` ("${o.workspace.name}")` : ''}.</p>`,
        )}
        ${
          this._fields.length > 0
            ? html`<table>
              <thead><tr><th>Field</th><th>Shared</th><th>Here</th></tr></thead>
              <tbody>
                ${this._fields.map(
                  (f) => html`<tr>
                    <td>${f.field.split('|')[0].replace(/^@name/, 'Name')}</td>
                    <td>${shown(f.theirs)}</td>
                    <td>${shown(f.mine)}</td>
                  </tr>`,
                )}
              </tbody>
            </table>`
            : nothing
        }
      </div>
    </umb-workspace-info-app-layout>`
  }

  static styles = css`
    .body {
      padding: var(--uui-size-space-4) var(--uui-size-space-5);
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th,
    td {
      text-align: left;
      padding: var(--uui-size-space-1) var(--uui-size-space-2);
      border-bottom: 1px solid var(--uui-color-border);
      vertical-align: top;
    }
  `
}

customElements.define('crombolo-workspace-info', CromboloWorkspaceInfoElement)
