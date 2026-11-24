/**
 * The banner across the top of the back office while editing is paused (story 409):
 * why, and when saving is back. It sits above the view-as banner's room (story 314)
 * when both show, and takes itself away when the pause's time passes.
 */
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'
import { pausedLabel } from './maintenance-words.js'

export const BANNER_HEIGHT = 40

export default class CromboloMaintenanceBannerElement extends LitElement {
  static properties = { paused: { attribute: false } }

  constructor() {
    super()
    this.paused = null
  }

  render() {
    if (!this.paused) return nothing
    return html`<div role="status" aria-live="polite">${pausedLabel(this.paused)}</div>`
  }

  static styles = css`
    :host {
      position: fixed;
      left: 0;
      right: 0;
      top: var(--crombolo-maintenance-top, 0px);
      height: ${BANNER_HEIGHT}px;
      z-index: 10000;
      display: block;
    }
    div {
      box-sizing: border-box;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 var(--uui-size-space-4, 12px);
      background: var(--uui-color-danger, #d42054);
      color: var(--uui-color-danger-contrast, #fff);
      font-weight: bold;
    }
  `
}

customElements.define('crombolo-maintenance-banner', CromboloMaintenanceBannerElement)
