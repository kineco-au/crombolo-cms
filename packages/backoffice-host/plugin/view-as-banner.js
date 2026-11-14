/**
 * The banner across the top of the back office while an administrator views it
 * as user groups (story 314): which groups, until when, and Switch back. When
 * the hour is up the back office reloads as them again.
 */
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'
import { reloadBackOffice, stopViewAs } from './view-as.js'
import { msUntil, viewingLabel } from './view-as-words.js'

export default class CromboloViewAsBannerElement extends LitElement {
  static properties = {
    viewing: { attribute: false },
    _busy: { state: true },
    _message: { state: true },
  }

  constructor() {
    super()
    this.viewing = undefined
    this._busy = false
    this._message = ''
    this._timer = undefined
  }

  connectedCallback() {
    super.connectedCallback()
    // Past the hour, the server has already ended it; a reload shows that.
    if (this.viewing) this._timer = setTimeout(reloadBackOffice, msUntil(this.viewing.until) + 1000)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    clearTimeout(this._timer)
  }

  async #switchBack() {
    this._busy = true
    try {
      await stopViewAs()
      reloadBackOffice()
    } catch (error) {
      this._message = error.message
      this._busy = false
    }
  }

  render() {
    if (!this.viewing) return nothing
    return html`<div role="status">
      <span>${viewingLabel(this.viewing)}</span>
      ${this._message ? html`<span class="problem">${this._message}</span>` : nothing}
      <uui-button
        look="primary"
        color="default"
        compact
        label="Switch back"
        ?disabled=${this._busy}
        @click=${() => this.#switchBack()}
        >Switch back</uui-button
      >
    </div>`
  }

  static styles = css`
    :host {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: var(--crombolo-view-as-height, 40px);
      z-index: 10000;
      display: block;
    }
    div {
      box-sizing: border-box;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--uui-size-space-4, 12px);
      padding: 0 var(--uui-size-space-4, 12px);
      background: var(--uui-color-warning, #fbd142);
      color: var(--uui-color-warning-contrast, #000);
      font-weight: bold;
    }
    .problem {
      font-weight: normal;
    }
  `
}

customElements.define('crombolo-view-as-banner', CromboloViewAsBannerElement)
