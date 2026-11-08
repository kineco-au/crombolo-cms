/**
 * A form text that can name a dictionary item (stories 294, 297): typing `{#`,
 * or `#` at the start, offers the items, and a `{#key}` shows as a chip. It sends
 * `change`, with `value`, as `uui-input` does.
 */
import { css, html, LitElement } from '@umbraco-cms/backoffice/external/lit'
import './dictionary-words.js'

export default class CromboloFormWordInputElement extends LitElement {
  static properties = {
    label: { type: String },
    placeholder: { type: String },
    value: { type: String },
    readonly: { type: Boolean },
    words: { attribute: false },
  }

  constructor() {
    super()
    this.value = ''
    this.words = []
  }

  #changed() {
    this.dispatchEvent(new Event('change', { bubbles: true }))
  }

  render() {
    return html`<crombolo-dictionary-words
      .value=${this.value ?? ''}
      .words=${this.words}
      ?readonly=${this.readonly}
      @input=${(event) => event.stopPropagation()}
      @crombolo-word-choose=${(event) => {
        event.stopPropagation()
        this.value = event.detail.value
        this.#changed()
      }}
    >
      <uui-input
        label=${this.label}
        placeholder=${this.placeholder ?? ''}
        .value=${this.value ?? ''}
        ?readonly=${this.readonly}
        @input=${(event) => {
          this.value = event.target.value ?? ''
          // Each keystroke, for a host that follows the text (an alias from a caption).
          this.dispatchEvent(new Event('input', { bubbles: true }))
        }}
        @change=${(event) => {
          event.stopPropagation()
          this.#changed()
        }}
      ></uui-input>
    </crombolo-dictionary-words>`
  }

  static styles = css`
    :host {
      display: block;
    }
    uui-input {
      width: 100%;
    }
  `
}

customElements.define('crombolo-form-word-input', CromboloFormWordInputElement)
