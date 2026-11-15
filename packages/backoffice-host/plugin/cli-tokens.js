/**
 * A person's command-line tokens (story 351), in their profile: listed, made
 * from a name and how long it lasts and shown once with a copy button, and
 * revoked. Making one is offered only to someone whose groups give it.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import {
  createButton,
  expiryChoices,
  HEADLINE,
  INTRO,
  NONE,
  revokeQuestion,
  SHOWN_ONCE,
  tokenLine,
} from './cli-tokens-words.js'

/** The plugin's API, under the back office wherever it is mounted. */
export const TOKENS_API = `${(document.querySelector('base')?.getAttribute('href') ?? '/crombolo/').replace(/\/$/, '')}/crombolo/api/cli-tokens`

export default class CromboloCliTokensElement extends UmbLitElement {
  static properties = {
    _state: { state: true },
    _error: { state: true },
    _name: { state: true },
    _days: { state: true },
    _made: { state: true },
  }

  constructor() {
    super()
    this._state = undefined
    this._error = ''
    this._name = ''
    this._days = undefined
    this._made = undefined
  }

  connectedCallback() {
    super.connectedCallback()
    this.#load()
  }

  async #load() {
    try {
      const response = await fetch(TOKENS_API, { credentials: 'include' })
      this._state = response.ok ? await response.json() : { enabled: false }
      this._days ??= this._state.defaultDays
    } catch {
      this._error = 'Could not load your tokens.'
    }
  }

  async #create() {
    this._error = ''
    const response = await fetch(TOKENS_API, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: this._name, days: Number(this._days) }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) this._error = body.message ?? 'The token could not be made.'
    else {
      this._made = body
      this._name = ''
    }
    await this.#load()
  }

  async #revoke(token) {
    if (!confirm(revokeQuestion(token.name))) return
    const response = await fetch(`${TOKENS_API}/${token.key}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!response.ok) this._error = 'That token could not be revoked.'
    if (this._made?.key === token.key) this._made = undefined
    await this.#load()
  }

  async #copy() {
    await navigator.clipboard?.writeText(this._made.token)
  }

  #renderNew() {
    if (!this._state.mayCreate) return nothing
    const button = createButton(this._name)
    return html`<div class="new">
      <uui-input
        label="Name"
        placeholder="What it is for"
        .value=${this._name}
        @input=${(e) => {
          this._name = e.target.value
        }}></uui-input>
      <uui-select
        label="Lasts"
        .options=${expiryChoices(this._state.maxDays).map((c) => ({
          name: c.label,
          value: String(c.days),
          selected: c.days === Number(this._days),
        }))}
        @change=${(e) => {
          this._days = e.target.value
        }}></uui-select>
      <uui-button
        look="primary"
        label=${button.label}
        ?disabled=${!button.enabled}
        @click=${() => this.#create()}></uui-button>
    </div>`
  }

  render() {
    if (!this._state?.enabled) return nothing
    const items = this._state.items ?? []
    return html`<uui-box headline=${HEADLINE}>
      <p class="muted">${INTRO}</p>
      ${this._error ? html`<p class="error">${this._error}</p>` : nothing}
      ${
        this._made
          ? html`<div class="made">
              <strong>${SHOWN_ONCE}</strong>
              <code>${this._made.token}</code>
              <uui-button look="secondary" label="Copy" @click=${() => this.#copy()}></uui-button>
            </div>`
          : nothing
      }
      ${this.#renderNew()}
      ${
        items.length === 0
          ? html`<p>${NONE}</p>`
          : html`<ul>
              ${items.map(
                (token) => html`<li>
                  <div>
                    <strong>${token.name}</strong>
                    <small>${tokenLine(token)}</small>
                  </div>
                  <uui-button look="secondary" color="danger" label="Revoke" @click=${() => this.#revoke(token)}></uui-button>
                </li>`,
              )}
            </ul>`
      }
    </uui-box>`
  }

  static styles = css`
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--uui-size-space-4);
      padding: var(--uui-size-space-3) 0;
      border-bottom: 1px solid var(--uui-color-divider);
    }
    li div {
      display: flex;
      flex-direction: column;
    }
    .new {
      display: flex;
      gap: var(--uui-size-space-3);
      align-items: center;
      margin-bottom: var(--uui-size-space-4);
    }
    .made {
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-2);
      padding: var(--uui-size-space-4);
      margin-bottom: var(--uui-size-space-4);
      border: 1px solid var(--uui-color-positive);
      border-radius: var(--uui-border-radius);
    }
    code {
      word-break: break-all;
    }
    small,
    .muted {
      color: var(--uui-color-text-alt);
    }
    .error {
      color: var(--uui-color-danger);
    }
  `
}

customElements.define('crombolo-cli-tokens', CromboloCliTokensElement)
