/**
 * A form text that can name a dictionary item (story 294): typing `#` offers the
 * items, and what one reads as shows underneath. It sends `change`, with `value`,
 * as `uui-input` does. The list is a popover so a table cell doesn't clip it.
 */
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'
import { suggestions, wordLine } from './form-word-input-model.js'

export default class CromboloFormWordInputElement extends LitElement {
  static properties = {
    label: { type: String },
    placeholder: { type: String },
    value: { type: String },
    readonly: { type: Boolean },
    words: { attribute: false },
    _open: { state: true },
    _active: { state: true },
  }

  constructor() {
    super()
    this.value = ''
    this.words = []
    this._open = false
    this._active = 0
  }

  get #found() {
    return this.readonly ? { rows: [], more: false } : suggestions(this.words ?? [], this.value)
  }

  #choose(word) {
    this.value = `#${word.name}`
    this._open = false
    this.#changed()
  }

  #changed() {
    this.dispatchEvent(new Event('change', { bubbles: true }))
  }

  #onInput(event) {
    event.stopPropagation()
    this.value = event.target.value ?? ''
    this._active = 0
    this._open = this.#found.rows.length > 0
  }

  #onKeydown(event) {
    const { rows } = this.#found
    if (!this._open || rows.length === 0) return
    if (event.key === 'Escape') {
      event.stopPropagation()
      this._open = false
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : rows.length - 1
      this._active = (this._active + step) % rows.length
    } else if (event.key === 'Enter') {
      event.preventDefault()
      this.#choose(rows[this._active] ?? rows[0])
    }
  }

  updated() {
    const list = this.renderRoot.querySelector('[popover]')
    if (!list) return
    const box = this.renderRoot.querySelector('uui-input').getBoundingClientRect()
    list.style.top = `${box.bottom + 2}px`
    list.style.left = `${box.left}px`
    list.style.minWidth = `${box.width}px`
    list.showPopover()
  }

  render() {
    const { rows, more } = this.#found
    const line = wordLine(this.words, this.value)
    const open = this._open && rows.length > 0
    return html`<uui-input
        label=${this.label}
        placeholder=${this.placeholder ?? ''}
        .value=${this.value ?? ''}
        ?readonly=${this.readonly}
        @input=${this.#onInput}
        @keydown=${this.#onKeydown}
        @change=${(event) => {
          event.stopPropagation()
          this.#changed()
        }}
        @blur=${() => {
          this._open = false
        }}
      ></uui-input>
      ${line ? html`<p class="word">${line}</p>` : nothing}
      <span class="status" role="status"
        >${open ? `${rows.length} dictionary items. Use the arrow keys to choose one.` : ''}</span
      >
      ${
        open
          ? html`<div popover="manual" role="listbox" aria-label="Dictionary items">
              ${rows.map(
                (word, index) => html`<div
                  role="option"
                  aria-selected=${index === this._active ? 'true' : 'false'}
                  @pointerdown=${(event) => {
                    event.preventDefault()
                    this.#choose(word)
                  }}
                >
                  <strong>${word.name}</strong> <span>${word.text}</span>
                </div>`,
              )}
              ${more ? html`<p class="more">Keep typing to narrow this down.</p>` : nothing}
            </div>`
          : nothing
      }`
  }

  static styles = css`
    :host {
      display: block;
    }
    uui-input {
      width: 100%;
    }
    .word {
      margin: var(--uui-size-space-1) 0 0;
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
    }
    .status {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    [popover] {
      position: fixed;
      inset: auto;
      margin: 0;
      padding: var(--uui-size-space-1);
      max-width: 28rem;
      background: var(--uui-color-surface);
      color: var(--uui-color-text);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      box-shadow: var(--uui-shadow-depth-3);
    }
    [role='option'] {
      padding: var(--uui-size-space-2) var(--uui-size-space-3);
      border-radius: var(--uui-border-radius);
      cursor: pointer;
    }
    [role='option'] span {
      color: var(--uui-color-text-alt);
    }
    [role='option'][aria-selected='true'],
    [role='option']:hover {
      background: var(--uui-color-surface-emphasis);
    }
    .more {
      margin: var(--uui-size-space-1) var(--uui-size-space-3);
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
    }
  `
}

customElements.define('crombolo-form-word-input', CromboloFormWordInputElement)
