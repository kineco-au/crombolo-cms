/**
 * A search and sharing value's box (story 317): fixed text, `{alias}` for a
 * property of the page, suggested after `{`, and `{#key}` for a dictionary item,
 * suggested after `{#`. It sends `change`, with `value`, as `uui-input` does.
 */
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'
import '../form-word-input.js'
import { insertProperty, propertySuggestions } from './value-model.js'

export default class CromboloSeoValueInputElement extends LitElement {
  static properties = {
    label: { type: String },
    value: { type: String },
    /** The page type's properties: `{ alias, name }`. */
    properties: { attribute: false },
    _typing: { state: true },
  }

  constructor() {
    super()
    this.value = ''
    this.properties = []
    this._typing = ''
  }

  #choose(alias) {
    this.value = insertProperty(this.value, alias)
    this._typing = ''
    this.dispatchEvent(new Event('change', { bubbles: true }))
  }

  render() {
    const offered = propertySuggestions(this.properties ?? [], this._typing)
    return html`
      <crombolo-form-word-input
        label=${this.label}
        .value=${this.value ?? ''}
        @input=${(event) => {
          event.stopPropagation()
          this._typing = event.target.value ?? ''
        }}
        @change=${(event) => {
          event.stopPropagation()
          this.value = event.target.value ?? ''
          this._typing = ''
          this.dispatchEvent(new Event('change', { bubbles: true }))
        }}
      ></crombolo-form-word-input>
      ${
        offered.length > 0
          ? html`<ul role="listbox" aria-label="Properties of this page">
              ${offered.map(
                (property) => html`<li
                  role="option"
                  @mousedown=${(event) => {
                    event.preventDefault()
                    this.value = this._typing
                    this.#choose(property.alias)
                  }}
                >
                  <strong>${property.name}</strong> <code>{${property.alias}}</code>
                </li>`,
              )}
            </ul>`
          : nothing
      }
    `
  }

  static styles = css`
    :host {
      display: block;
      position: relative;
    }
    ul {
      position: absolute;
      z-index: 10;
      left: 0;
      right: 0;
      margin: 2px 0 0;
      padding: var(--uui-size-space-1) 0;
      list-style: none;
      background: var(--uui-color-surface);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      box-shadow: var(--uui-shadow-depth-2);
    }
    li {
      padding: var(--uui-size-space-2) var(--uui-size-space-4);
      cursor: pointer;
    }
    li:hover {
      background: var(--uui-color-surface-emphasis);
    }
    code {
      color: var(--uui-color-text-alt);
    }
  `
}

customElements.define('crombolo-seo-value-input', CromboloSeoValueInputElement)
