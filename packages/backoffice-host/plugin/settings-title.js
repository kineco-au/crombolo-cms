/**
 * The title every Settings tool opens with, under its breadcrumb: its name and what
 * it is for, on the page itself rather than a white band, so it does not read as part
 * of the white header above.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'

export class CromboloSettingsTitleElement extends UmbLitElement {
  static properties = { heading: { type: String }, description: { type: String } }

  constructor() {
    super()
    this.heading = ''
    this.description = ''
  }

  render() {
    return html`<h2>${this.heading}</h2>
      ${this.description ? html`<p>${this.description}</p>` : nothing}`
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-1);
      box-sizing: border-box;
      padding: var(--uui-size-space-1) var(--uui-size-layout-1) var(--uui-size-space-5);
    }
    h2 {
      margin: 0;
      font-size: 28px;
      font-weight: 900;
      letter-spacing: -0.02em;
      line-height: 1.15;
      color: var(--uui-color-text);
    }
    p {
      margin: 0;
      font-size: 15px;
      color: var(--uui-color-text-alt);
    }
  `
}

customElements.define('crombolo-settings-title', CromboloSettingsTitleElement)
