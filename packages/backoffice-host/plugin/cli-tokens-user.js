/**
 * Another person's command-line tokens (story 351), as a view on their user
 * screen: an administrator sees them and revokes any. Shown only while the
 * site takes tokens; the endpoint refuses anyone but an administrator.
 */

import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UMB_USER_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/user'
import { ask } from './ask.js'
import { TOKENS_API } from './cli-tokens.js'
import { HEADLINE, NONE, OTHERS_INTRO, revokeQuestion, tokenLine } from './cli-tokens-words.js'

export default class CromboloCliTokensUserElement extends UmbLitElement {
  static properties = { _state: { state: true }, _error: { state: true } }

  #user = undefined

  constructor() {
    super()
    this._state = undefined
    this._error = ''
    this.consumeContext(UMB_USER_WORKSPACE_CONTEXT, (context) => {
      if (!context) return
      this.observe(context.unique, (unique) => {
        this.#user = unique ?? undefined
        if (this.#user) this.#load()
      })
    })
  }

  async #load() {
    try {
      const response = await fetch(`${TOKENS_API}?user=${encodeURIComponent(this.#user)}`, {
        credentials: 'include',
      })
      const body = await response.json().catch(() => ({}))
      this._state = response.ok ? body : { enabled: true, items: [] }
      this._error = response.ok ? '' : (body.message ?? 'Could not load the tokens.')
    } catch {
      this._error = 'Could not load the tokens.'
    }
  }

  async #revoke(token) {
    if (!(await ask(this, { headline: revokeQuestion(token.name), confirmLabel: 'Revoke' }))) return
    const response = await fetch(`${TOKENS_API}/${token.key}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!response.ok) this._error = 'That token could not be revoked.'
    await this.#load()
  }

  render() {
    if (!this._state) return nothing
    if (!this._state.enabled)
      return html`<uui-box headline=${HEADLINE}><p>This site does not take command-line tokens.</p></uui-box>`
    const items = this._state.items ?? []
    return html`<uui-box headline=${HEADLINE}>
      <p class="muted">${OTHERS_INTRO}</p>
      ${this._error ? html`<p class="error">${this._error}</p>` : nothing}
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
    :host {
      display: block;
      padding: var(--uui-size-layout-1);
    }
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
    small,
    .muted {
      color: var(--uui-color-text-alt);
    }
    .error {
      color: var(--uui-color-danger);
    }
  `
}

customElements.define('crombolo-cli-tokens-user', CromboloCliTokensUserElement)
