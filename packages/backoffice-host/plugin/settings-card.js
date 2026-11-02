/**
 * One card on the Settings landing page (story 234): a link headed by its title
 * on a dark band, with what it opens beneath.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'

export class CromboloSettingsCardElement extends UmbLitElement {
  static properties = { href: {}, heading: {}, description: {} }

  render() {
    return html`<a href=${this.href}>
      <strong>${this.heading}</strong>
      ${this.description ? html`<span>${this.description}</span>` : nothing}
    </a>`
  }

  static styles = css`
    :host {
      display: block;
    }
    a {
      display: flex;
      flex-direction: column;
      height: 100%;
      box-sizing: border-box;
      overflow: hidden;
      background: var(--uui-color-surface);
      border: 1px solid var(--uui-color-border);
      border-radius: 12px;
      box-shadow: var(--crombolo-card-shadow, none);
      color: var(--uui-color-text);
      text-decoration: none;
    }
    a:hover,
    a:focus-visible {
      border-color: var(--uui-color-interactive-emphasis);
    }
    a:focus-visible {
      outline: 2px solid var(--uui-color-focus);
      outline-offset: 2px;
    }
    strong {
      padding: var(--uui-size-space-4) var(--uui-size-space-5);
      background: var(--crombolo-card-header-background, var(--uui-color-header-surface));
      color: var(--crombolo-card-header-text, var(--uui-color-header-contrast-emphasis));
      font-weight: 700;
    }
    span {
      padding: var(--uui-size-space-4) var(--uui-size-space-5) var(--uui-size-space-5);
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
    }
  `
}

customElements.define('crombolo-settings-card', CromboloSettingsCardElement)
