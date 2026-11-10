/**
 * The title section every Settings tool opens with, under its breadcrumb: its
 * name and what it is for. As tall as Umbraco's own workspace headers, such as
 * Webhooks', which the section sets shorter (`--umb-header-layout-height`).
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
      justify-content: center;
      min-height: var(--umb-header-layout-height, 56px);
      box-sizing: border-box;
      padding: var(--uui-size-space-2) var(--uui-size-layout-1);
      background: var(--uui-color-surface);
      border-bottom: 1px solid var(--uui-color-border);
    }
    h2 {
      margin: 0;
      font-size: var(--uui-type-h5-size);
      line-height: 1.2;
    }
    p {
      margin: var(--uui-size-space-1) 0 0;
      color: var(--uui-color-text-alt);
    }
  `
}

customElements.define('crombolo-settings-title', CromboloSettingsTitleElement)
