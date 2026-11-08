/**
 * A `{#key}` as a chip (story 297): the item's words in the default language, and
 * an × that removes it. Clicking the words opens an overlay with the item's words
 * in each language, which someone with Translation can change.
 */
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'
import {
  dictionaryWord,
  dictionaryWords,
  saveDictionaryWord,
  WORDS_CHANGED,
} from './dictionary-words-client.js'

export class CromboloDictionaryChipElement extends LitElement {
  static properties = {
    /** The item's name. */
    name: { type: String },
    readonly: { type: Boolean },
    _text: { state: true },
    _item: { state: true },
    _language: { state: true },
    _draft: { state: true },
    _saving: { state: true },
    _problem: { state: true },
  }

  #refresh = () => this.#loadText()

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener(WORDS_CHANGED, this.#refresh)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener(WORDS_CHANGED, this.#refresh)
  }

  willUpdate(changed) {
    if (changed.has('name')) this.#loadText()
  }

  async #loadText() {
    const name = (this.name ?? '').toLowerCase()
    const word = (await dictionaryWords()).find((w) => w.name.toLowerCase() === name)
    this._text = word?.text || word?.name || this.name
  }

  async #open() {
    this._problem = undefined
    this._item = undefined
    this.renderRoot.querySelector('dialog')?.showModal()
    const answer = await dictionaryWord(this.name)
    if (!answer.ok) {
      this._problem = answer.body.message ?? 'This dictionary item could not be read.'
      return
    }
    this._item = answer.body
    this._draft = Object.fromEntries(answer.body.languages.map((l) => [l.isoCode, l.text]))
    this._language = answer.body.languages[0]?.isoCode
  }

  #close() {
    this.renderRoot.querySelector('dialog')?.close()
  }

  async #save() {
    this._saving = true
    const answer = await saveDictionaryWord(this.name, this._draft)
    this._saving = false
    if (!answer.ok) {
      this._problem = answer.body.message ?? 'The words could not be saved.'
      return
    }
    this.#close()
  }

  #remove(event) {
    event.stopPropagation()
    this.dispatchEvent(new CustomEvent('remove', { bubbles: true, composed: true }))
  }

  #overlay() {
    const item = this._item
    if (this._problem && !item) return html`<p role="alert">${this._problem}</p>`
    if (!item) return html`<uui-loader></uui-loader>`
    const language = item.languages.find((l) => l.isoCode === this._language) ?? item.languages[0]
    return html`<uui-tab-group>
        ${item.languages.map(
          (l) =>
            html`<uui-tab
              label=${l.name}
              ?active=${l.isoCode === language?.isoCode}
              @click=${() => {
                this._language = l.isoCode
              }}
              >${l.name}${l.isDefault ? ' (default)' : ''}</uui-tab
            >`,
        )}
      </uui-tab-group>
      ${
        language
          ? html`<uui-textarea
              label=${`Words in ${language.name}`}
              .value=${this._draft?.[language.isoCode] ?? ''}
              ?readonly=${!item.mayChange}
              @input=${(event) => {
                this._draft = { ...this._draft, [language.isoCode]: event.target.value }
              }}
            ></uui-textarea>`
          : html`<p>This site has no languages.</p>`
      }
      ${
        item.mayChange
          ? nothing
          : html`<p class="note" role="status">
              You can see these words. Changing the dictionary needs access to Translation.
            </p>`
      }
      ${this._problem ? html`<p role="alert">${this._problem}</p>` : nothing}`
  }

  render() {
    const label = this._text ?? this.name
    return html`<span class="chip">
        <button type="button" class="words" title=${`From the dictionary: ${this.name}`} @click=${this.#open}>
          <umb-icon name="icon-book-alt"></umb-icon>${label}
        </button>
        ${
          this.readonly
            ? nothing
            : html`<button type="button" class="remove" aria-label=${`Remove ${this.name}`} @click=${this.#remove}>
                ×
              </button>`
        }
      </span>
      <dialog aria-label=${`Dictionary item ${this.name}`} @close=${() => {
        this._item = undefined
      }}>
        <h3>${this.name}</h3>
        ${this.#overlay()}
        <div class="actions">
          <uui-button look="secondary" label="Close" @click=${this.#close}>Close</uui-button>
          ${
            this._item?.mayChange
              ? html`<uui-button
                  look="primary"
                  color="positive"
                  label="Save"
                  .state=${this._saving ? 'waiting' : undefined}
                  @click=${this.#save}
                  >Save</uui-button
                >`
              : nothing
          }
        </div>
      </dialog>`
  }

  static styles = css`
    :host {
      display: inline-block;
      max-width: 100%;
    }
    .chip {
      display: inline-flex;
      align-items: stretch;
      max-width: 100%;
      border: 1px solid var(--uui-color-selected);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface-alt);
      color: var(--uui-color-text);
      font: inherit;
    }
    button {
      font: inherit;
      color: inherit;
      background: none;
      border: 0;
      cursor: pointer;
    }
    .words {
      display: inline-flex;
      align-items: center;
      gap: var(--uui-size-space-2);
      padding: var(--uui-size-space-2) var(--uui-size-space-3);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .words:hover,
    .remove:hover {
      background: var(--uui-color-surface-emphasis);
    }
    .remove {
      padding: 0 var(--uui-size-space-3);
      border-left: 1px solid var(--uui-color-border);
      font-size: 1.1em;
    }
    dialog {
      width: min(36rem, calc(100vw - 2rem));
      padding: var(--uui-size-space-5);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface);
      color: var(--uui-color-text);
      box-shadow: var(--uui-shadow-depth-5);
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.35);
    }
    h3 {
      margin: 0 0 var(--uui-size-space-4);
    }
    uui-textarea {
      width: 100%;
      margin-top: var(--uui-size-space-4);
    }
    .note {
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--uui-size-space-3);
      margin-top: var(--uui-size-space-5);
    }
  `
}

if (!customElements.get('crombolo-dictionary-chip'))
  customElements.define('crombolo-dictionary-chip', CromboloDictionaryChipElement)
