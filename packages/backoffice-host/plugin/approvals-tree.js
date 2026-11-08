/**
 * The tree beside Approvals: one folder, Pending, of every request still waiting
 * for a decision or its time, those waiting on the reader first and marked so.
 * Each opens its page's Workflow tab, where it is acted on.
 */
import { css, html } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { pendingForTree } from './approvals-tree-model.js'
import { inFlight, waitingForMe } from './workflow-client.js'
import { pageLink } from './workflow-requests.js'

const PENDING = 'pending'

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
    const [pending, mine] = await Promise.all([
      inFlight().catch(() => undefined),
      waitingForMe().catch(() => undefined),
    ])
    this._items = pendingForTree(pending?.items, mine?.items)
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
    const items = this._items
    const open = items.length > 0 && !this._closed.has(PENDING)
    return html`${header}<uui-menu-item-list>
      <uui-menu-item
        label="Pending"
        .hasChildren=${items.length > 0}
        .showChildren=${open}
        @show-children=${() => this.#toggle(PENDING, true)}
        @hide-children=${() => this.#toggle(PENDING, false)}
        @click-label=${() => this.#toggle(PENDING, this._closed.has(PENDING))}
      >
        <umb-icon slot="icon" name="icon-folder"></umb-icon>
        ${items.map((request) => {
          const href = pageLink(request)
          const what = request.action === 'unpublish' ? 'taking it down' : 'publishing'
          return html`<uui-menu-item
            label=${request.nodeName}
            href=${href}
            ?active=${location.pathname === new URL(href, location.href).pathname}
            title=${`${request.mine ? 'Waiting for you. ' : ''}${request.workflow.name}: ${what}`}
          >
            <umb-icon
              slot="icon"
              name=${request.mine ? 'icon-inbox' : 'icon-document'}
              class=${request.mine ? 'mine' : ''}
            ></umb-icon>
          </uui-menu-item>`
        })}
      </uui-menu-item>
    </uui-menu-item-list>`
  }

  static styles = css`
    umb-icon.mine {
      color: var(--uui-color-warning-standalone, var(--uui-color-warning));
    }
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
