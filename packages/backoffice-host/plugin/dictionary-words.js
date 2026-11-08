/**
 * Dictionary words in the back office (stories 294, 297). `crombolo-dictionary-words`
 * goes around a text box, the form editor's and the text boxes and text areas
 * of a page: a `{#key}` naming an item shows as a chip, and typing `{#`, or `#`
 * at the start, offers the items. It sends `crombolo-word-choose` with the new
 * value; the box it holds sends its own input as before. Without this module the
 * element is unknown, and the box shows as it always did.
 *
 * Its entry point also tells the fork what `{#key}` in a block's label reads as.
 */
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'
import './dictionary-chip.js'
import { dictionaryWords, WORDS_CHANGED } from './dictionary-words-client.js'
import { chipWord, suggestions, wordLine, wordValue } from './form-word-input-model.js'

export class CromboloDictionaryWordsElement extends LitElement {
  static properties = {
    value: { type: String },
    readonly: { type: Boolean },
    /** The items, when the host has them; else they are fetched. */
    words: { attribute: false },
    _loaded: { state: true },
    _open: { state: true },
    _active: { state: true },
  }

  #refresh = async () => {
    this._loaded = await dictionaryWords()
  }

  constructor() {
    super()
    this._open = false
    this._active = 0
    this.addEventListener('input', () => {
      this._active = 0
      this._open = true
    })
    this.addEventListener('keydown', (event) => this.#onKeydown(event))
    this.addEventListener('focusout', () => {
      this._open = false
    })
  }

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener(WORDS_CHANGED, this.#refresh)
    if (!this.words) this.#refresh()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener(WORDS_CHANGED, this.#refresh)
  }

  get #words() {
    return this.words ?? this._loaded
  }

  get #found() {
    return this.readonly || !this._open
      ? { rows: [], more: false }
      : suggestions(this.#words ?? [], this.value ?? '')
  }

  #choose(value) {
    this._open = false
    this.dispatchEvent(
      new CustomEvent('crombolo-word-choose', { detail: { value }, bubbles: true, composed: true }),
    )
  }

  #onKeydown(event) {
    const { rows } = this.#found
    if (rows.length === 0) return
    if (event.key === 'Escape') {
      event.stopPropagation()
      this._open = false
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : rows.length - 1
      this._active = (this._active + step) % rows.length
    } else if (event.key === 'Enter') {
      event.preventDefault()
      this.#choose(wordValue((rows[this._active] ?? rows[0]).name))
    }
  }

  updated() {
    const list = this.renderRoot.querySelector('[popover]')
    if (!list) return
    const box = this.getBoundingClientRect()
    list.style.top = `${box.bottom + 2}px`
    list.style.left = `${box.left}px`
    list.style.minWidth = `${box.width}px`
    list.showPopover()
  }

  render() {
    const words = this.#words
    const chip = chipWord(words, this.value)
    if (chip)
      return html`<crombolo-dictionary-chip
        .name=${chip.name}
        ?readonly=${this.readonly}
        @remove=${() => this.#choose('')}
      ></crombolo-dictionary-chip>`
    const { rows, more } = this.#found
    const line = wordLine(words, this.value)
    return html`<slot></slot>
      ${line ? html`<p class="word">${line}</p>` : nothing}
      <span class="status" role="status"
        >${rows.length > 0 ? `${rows.length} dictionary items. Use the arrow keys to choose one.` : ''}</span
      >
      ${
        rows.length > 0
          ? html`<div popover="manual" role="listbox" aria-label="Dictionary items">
              ${rows.map(
                (word, index) => html`<div
                  role="option"
                  aria-selected=${index === this._active ? 'true' : 'false'}
                  @pointerdown=${(event) => {
                    event.preventDefault()
                    this.#choose(wordValue(word.name))
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

if (!customElements.get('crombolo-dictionary-words'))
  customElements.define('crombolo-dictionary-words', CromboloDictionaryWordsElement)

/** A block label's `{#key}`: the item's words in the default language, or its name. */
export const onInit = async () => {
  const { umbCromboloHooks } = await import('@umbraco-cms/backoffice/extension-registry')
  umbCromboloHooks.dictionaryWord = async (name) => {
    const word = (await dictionaryWords()).find(
      (w) => w.name.toLowerCase() === String(name).toLowerCase(),
    )
    return word ? word.text || word.name : undefined
  }
}
