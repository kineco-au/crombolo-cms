/**
 * The tree beside Approvals: a folder of the requests waiting for the reader, and
 * one of the latest decided. Each request opens its page's Workflow tab, where
 * it is acted on.
 */
import { css, html } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { finished, waitingForMe } from './workflow-client.js'
import { pageLink } from './workflow-requests.js'

/** How many of the decided the tree shows: the list has the rest. */
const DECIDED_SHOWN = 25

const FOLDERS = [
  { id: 'waiting', label: 'Waiting for me', load: () => waitingForMe() },
  { id: 'decided', label: 'Decided', load: () => finished(0, DECIDED_SHOWN) },
]

export default class CromboloApprovalsTreeElement extends UmbLitElement {
  static properties = {
    _items: { state: true },
    _closed: { state: true },
  }

  #follow = () => {
    if (location.pathname.includes('/section/workflow')) this.#load()
    else this.requestUpdate()
  }

  connectedCallback() {
    super.connectedCallback()
    this._closed = new Set()
    this.#load()
    window.addEventListener('changestate', this.#follow)
    window.addEventListener('popstate', this.#follow)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('changestate', this.#follow)
    window.removeEventListener('popstate', this.#follow)
  }

  async #load() {
    const answers = await Promise.all(FOLDERS.map((folder) => folder.load().catch(() => undefined)))
    this._items = Object.fromEntries(
      FOLDERS.map((folder, index) => [folder.id, answers[index]?.items ?? []]),
    )
  }

  #toggle(id, open) {
    const closed = new Set(this._closed)
    if (open) closed.delete(id)
    else closed.add(id)
    this._closed = closed
  }

  render() {
    // Headed as Umbraco's sidebar menus are, Structure's among them.
    const header = html`<h3>Approvals</h3>`
    if (!this._items) return html`${header}<uui-loader></uui-loader>`
    return html`${header}<uui-menu-item-list>
      ${FOLDERS.map((folder) => {
        const items = this._items[folder.id]
        return html`<uui-menu-item
          label=${folder.label}
          .hasChildren=${items.length > 0}
          .showChildren=${items.length > 0 && !this._closed.has(folder.id)}
          @show-children=${() => this.#toggle(folder.id, true)}
          @hide-children=${() => this.#toggle(folder.id, false)}
          @click-label=${() => this.#toggle(folder.id, this._closed.has(folder.id))}
        >
          <umb-icon slot="icon" name="icon-folder"></umb-icon>
          ${items.map((request) => {
            const href = pageLink(request)
            return html`<uui-menu-item
              label=${request.nodeName}
              href=${href}
              ?active=${location.pathname === new URL(href, location.href).pathname}
              title=${`${request.workflow.name}: ${request.action === 'unpublish' ? 'taking it down' : 'publishing'}`}
            >
              <umb-icon slot="icon" name="icon-document"></umb-icon>
            </uui-menu-item>`
          })}
        </uui-menu-item>`
      })}
    </uui-menu-item-list>`
  }

  static styles = css`
    h3 {
      display: flex;
      align-items: center;
      height: var(--umb-header-layout-height);
      margin: 0;
      padding: var(--uui-size-4) var(--uui-size-8);
      box-sizing: border-box;
      font-size: 14px;
    }
  `
}

customElements.define('crombolo-approvals-tree', CromboloApprovalsTreeElement)

export { CromboloApprovalsTreeElement as element }
