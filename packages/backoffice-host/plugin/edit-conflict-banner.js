/**
 * Shown in a page's editor when a save was refused because someone else changed
 * the page after it was opened (story 172). The editor's changes stay where
 * they are; the latest version opens in a new tab to compare and copy across.
 */
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document'
import { UmbElementMixin } from '@umbraco-cms/backoffice/element-api'
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'
import { tracker } from './edit-conflicts.js'

export default class CromboloEditConflictElement extends UmbElementMixin(LitElement) {
  static properties = { _conflict: { state: true } }

  constructor() {
    super()
    this._key = undefined
    this._conflict = false
    this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (context) => {
      if (!context) return
      this.observe(context.unique, (unique) => {
        this._key = unique ? String(unique).toLowerCase() : undefined
        this.#refresh()
      })
    })
  }

  connectedCallback() {
    super.connectedCallback()
    this._unsubscribe = tracker.subscribe(() => this.#refresh())
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this._unsubscribe?.()
  }

  #refresh() {
    this._conflict = this._key ? tracker.hasConflict(this._key) : false
  }

  #openLatest() {
    window.open(window.location.href, '_blank', 'noopener')
  }

  render() {
    if (!this._conflict) return nothing
    return html`<div class="conflict" role="alert">
      <uui-icon name="icon-alert"></uui-icon>
      <span>Someone else changed this page after you opened it. Your changes are still here.</span>
      <uui-button look="outline" color="warning" compact @click=${() => this.#openLatest()}>
        Open the latest version in a new tab
      </uui-button>
    </div>`
  }

  static styles = css`
    :host { display: flex; align-items: center; }
    .conflict {
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-3);
      color: var(--uui-color-warning-standalone);
    }
  `
}

customElements.define('crombolo-edit-conflict', CromboloEditConflictElement)
