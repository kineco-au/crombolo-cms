/**
 * Approvals' list (story 028): the requests pending, and those decided when asked
 * for, a page at a time. Each row opens the page's Workflow tab, where a request
 * is acted on. With no workflow set up and no request open, it says so instead.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { approvalsActive, requestList } from './workflow-client.js'
import { describeWhen } from './workflow-time.js'

const STATE = {
  waiting: ['warning', 'Waiting'],
  scheduled: ['positive', 'Approved, waiting for its time'],
  approved: ['positive', 'Approved'],
  'sent-back': ['danger', 'Sent back'],
  withdrawn: ['default', 'Withdrawn'],
  superseded: ['default', 'Replaced by a direct publish'],
}

/** The page's Workflow tab: the editor's route is `edit/<key>/<variant>/view/<tab>`. */
export const pageLink = (item) => {
  const base = (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(
    /\/$/,
    '',
  )
  return `${base}/section/content/workspace/document/edit/${item.nodeKey}/${encodeURIComponent(item.variant ?? 'invariant')}/view/workflow`
}

/**
 * Navigates within the backoffice, as Umbraco's own code does, so the page
 * opens on its Workflow tab without reloading the app. A modified click still
 * opens a new tab.
 */
function openInBackoffice(event, href) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  event.preventDefault()
  history.pushState(null, '', href)
}

/** Rows a page of the list holds. */
export const PAGE_SIZE = 25

/** What a list of requests is called, by what it includes. Pure. */
export const listHeadline = ({ pending, decided }) =>
  pending && decided ? 'Pending and decided' : decided ? 'Decided' : 'Pending'

class CromboloApprovalsListElement extends UmbLitElement {
  static properties = {
    _items: { state: true },
    _message: { state: true },
    _total: { state: true },
    _page: { state: true },
    _pending: { state: true },
    _decided: { state: true },
    _inactive: { state: true },
  }

  connectedCallback() {
    super.connectedCallback()
    this._page = 1
    this._pending = true
    this._decided = false
    this.#load()
  }

  async #load() {
    const include = { pending: this._pending, decided: this._decided }
    const [result, active] = await Promise.all([
      requestList(include, (this._page - 1) * PAGE_SIZE, PAGE_SIZE),
      approvalsActive(),
    ])
    this._inactive = active.ok && active.active !== true
    if (!result.ok) {
      this._message = result.message
      return
    }
    this._message = undefined
    this._items = result.items
    this._total = result.total
  }

  #include(name, checked) {
    this[name] = checked
    this._page = 1
    this._items = undefined
    this.#load()
  }

  #filters() {
    return html`<div class="filters" role="group" aria-label="Show">
      <uui-checkbox
        label="Pending"
        ?checked=${this._pending}
        @change=${(e) => this.#include('_pending', e.target.checked)}
      ></uui-checkbox>
      <uui-checkbox
        label="Decided"
        ?checked=${this._decided}
        @change=${(e) => this.#include('_decided', e.target.checked)}
      ></uui-checkbox>
    </div>`
  }

  #pages() {
    const total = Math.ceil((this._total ?? 0) / PAGE_SIZE)
    if (total <= 1) return nothing
    return html`<uui-pagination
      .current=${this._page}
      .total=${total}
      @change=${(e) => {
        this._page = e.target.current
        this.#load()
      }}
    ></uui-pagination>`
  }

  #table() {
    if (!this._items) return html`<uui-loader></uui-loader>`
    if (this._items.length === 0)
      return html`<p>${
        this._pending || this._decided
          ? `No request is ${listHeadline({ pending: this._pending, decided: this._decided }).toLowerCase()}.`
          : 'Choose pending or decided requests to see them.'
      }</p>`
    return html`<uui-table>
      <uui-table-head>
        <uui-table-head-cell>Page</uui-table-head-cell>
        <uui-table-head-cell>Workflow</uui-table-head-cell>
        <uui-table-head-cell>Asked for</uui-table-head-cell>
        <uui-table-head-cell>When</uui-table-head-cell>
        <uui-table-head-cell>Where it stands</uui-table-head-cell>
        <uui-table-head-cell>Sent</uui-table-head-cell>
      </uui-table-head>
      ${this._items.map((item) => {
        const [color, label] = STATE[item.state] ?? ['default', item.state]
        const waiting = item.stages.filter((s) => s.state === 'waiting').map((s) => s.alias)
        const href = pageLink(item)
        return html`<uui-table-row class="row" @click=${(e) => openInBackoffice(e, href)}>
          <uui-table-cell><a href=${href} @click=${(e) => openInBackoffice(e, href)}>${item.nodeName}</a></uui-table-cell>
          <uui-table-cell>${item.workflow.name}</uui-table-cell>
          <uui-table-cell>${item.action === 'unpublish' ? 'Taking it down' : 'Publishing'}</uui-table-cell>
          <uui-table-cell>${describeWhen(item.action, item.schedule) || 'On approval'}</uui-table-cell>
          <uui-table-cell>
            <uui-tag color=${color}>${label}</uui-tag>
            ${waiting.length > 0 ? html`<small>at ${waiting.join(', ')}</small>` : nothing}
          </uui-table-cell>
          <uui-table-cell>${new Date(item.requestedAt).toLocaleString()}</uui-table-cell>
        </uui-table-row>`
      })}
    </uui-table>`
  }

  render() {
    if (this._inactive)
      return html`<uui-box headline="Approvals">
        <p>No approval workflows have been set up yet, so nothing waits for approval. Workflows are set up in Structure.</p>
      </uui-box>`
    const headline = listHeadline({ pending: this._pending, decided: this._decided })
    return html`<uui-box headline=${headline}>
      ${this.#filters()}
      ${this._message ? html`<p role="alert">${this._message}</p>` : this.#table()}
      ${this.#pages()}
    </uui-box>`
  }

  static styles = css`
    :host { display: block; padding: var(--uui-size-layout-1); }
    small { margin-left: var(--uui-size-space-2); opacity: 0.8; }
    .filters { display: flex; gap: var(--uui-size-space-5); margin-bottom: var(--uui-size-space-4); }
    .row { cursor: pointer; }
    uui-pagination { display: block; margin-top: var(--uui-size-space-4); }
  `
}

customElements.define('crombolo-approvals-list', CromboloApprovalsListElement)
