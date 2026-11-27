/**
 * A section that says something is wrong (`kind="error"`, the default), needs
 * attention (`kind="warning"`), or explains (`kind="info"`): a box with a coloured
 * edge, an icon and a headline, its content slotted below. Errors and warnings are
 * tinted; an info box is white, like the cards around it.
 *
 *   <crombolo-callout headline="Not saved"><ul>…</ul></crombolo-callout>
 */
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'

const ICON = { error: 'icon-alert', warning: 'icon-alert', info: 'icon-info' }

export class CromboloCalloutElement extends LitElement {
  static properties = {
    kind: { reflect: true },
    headline: {},
  }

  constructor() {
    super()
    this.kind = 'error'
    this.headline = ''
  }

  // The role is the host's, so what is slotted in is part of what it announces.
  updated() {
    this.setAttribute(
      'role',
      (ICON[this.kind] ? this.kind : 'error') === 'error' ? 'alert' : 'status',
    )
  }

  render() {
    const kind = ICON[this.kind] ? this.kind : 'error'
    return html`<div class="callout">
      <uui-icon name=${ICON[kind]}></uui-icon>
      <div class="body">
        ${this.headline ? html`<strong class="headline">${this.headline}</strong>` : nothing}
        <slot></slot>
      </div>
    </div>`
  }

  static styles = css`
    :host {
      display: block;
      --callout-edge: var(--uui-color-danger, #d42054);
      --callout-ink: var(--uui-color-danger-emphasis, #a3163f);
    }
    :host([kind='warning']) {
      --callout-edge: var(--uui-color-warning-standalone, #b98c00);
      --callout-ink: var(--uui-color-warning-contrast, #5c4600);
    }
    :host([kind='info']) {
      --callout-edge: var(--uui-color-default, #3544b1);
      --callout-ink: var(--uui-color-text, inherit);
      --callout-fill: var(--uui-color-surface, #fff);
    }
    :host([kind='info']) .callout {
      border-color: var(--uui-color-border, #d8d7d9);
      border-left-color: var(--callout-edge);
    }
    .callout {
      display: flex;
      gap: var(--uui-size-space-3, 9px);
      align-items: flex-start;
      padding: var(--uui-size-space-4, 12px) var(--uui-size-space-5, 18px);
      border: 1px solid color-mix(in srgb, var(--callout-edge) 35%, transparent);
      border-left: 4px solid var(--callout-edge);
      border-radius: var(--uui-border-radius, 3px);
      background: var(
        --callout-fill,
        color-mix(in srgb, var(--callout-edge) 8%, var(--uui-color-surface, #fff))
      );
      color: var(--uui-color-text, inherit);
    }
    uui-icon {
      flex: none;
      margin-top: 2px;
      color: var(--callout-edge);
      font-size: 18px;
    }
    .body {
      min-width: 0;
    }
    .headline {
      display: block;
      margin-bottom: var(--uui-size-space-1, 3px);
      color: var(--callout-ink);
    }
    ::slotted(*) {
      margin-top: 0;
    }
    ::slotted(:last-child) {
      margin-bottom: 0;
    }
    ::slotted(ul),
    ::slotted(ol) {
      padding-left: 1.2em;
    }
    ::slotted(details) {
      margin-top: var(--uui-size-space-3, 9px);
    }
  `
}

if (!customElements.get('crombolo-callout'))
  customElements.define('crombolo-callout', CromboloCalloutElement)
