/**
 * "Workflows", on a webhook's screen (story 441): the workflows whose approvals it hears.
 * None chosen hears every one. Its page types narrow it as they narrow a page's events.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UMB_WEBHOOK_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/webhook'

const base = () =>
  `${(document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')}/crombolo/api/webhooks`

export default class CromboloWebhookWorkflowsElement extends UmbLitElement {
  static properties = {
    _state: { state: true },
    _busy: { state: true },
    _message: { state: true },
  }

  #unique

  constructor() {
    super()
    this._busy = false
    this._message = ''
    this.consumeContext(UMB_WEBHOOK_WORKSPACE_CONTEXT, (context) => {
      this.observe(context?.unique, (unique) => {
        this.#unique = unique
        this.#load()
      })
    })
  }

  async #load() {
    if (!this.#unique) return
    const response = await fetch(`${base()}/${encodeURIComponent(this.#unique)}/workflows`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    })
    this._state = response.ok ? await response.json() : { missing: true }
  }

  async #choose(alias, on) {
    const chosen = new Set(this._state.chosen)
    if (on) chosen.add(alias)
    else chosen.delete(alias)
    this._busy = true
    this._message = ''
    try {
      const response = await fetch(`${base()}/${encodeURIComponent(this.#unique)}/workflows`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ workflows: [...chosen] }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) this._message = body.reason ?? 'That could not be saved. Try again.'
      else this._state = body
    } finally {
      this._busy = false
    }
  }

  render() {
    const state = this._state
    if (!state) return html`<uui-box><uui-loader></uui-loader></uui-box>`
    if (state.missing)
      return html`<uui-box><p>Save the webhook first, then choose its workflows.</p></uui-box>`
    return html`<uui-box headline="Workflows">
      <p class="fine">
        The approvals it hears. With none chosen it hears every workflow's; the page types it
        names narrow these too.
      </p>
      ${
        state.available.length === 0
          ? html`<p>This site has no workflows.</p>`
          : state.available.map(
              (w) => html`<uui-checkbox
                label=${w.name}
                ?disabled=${this._busy}
                ?checked=${state.chosen.includes(w.alias)}
                @change=${(e) => this.#choose(w.alias, e.target.checked)}
              >${w.name}</uui-checkbox>`,
            )
      }
      ${this._message ? html`<p class="problem" role="alert">${this._message}</p>` : nothing}
    </uui-box>`
  }

  static styles = css`
    uui-checkbox {
      display: block;
      margin: var(--uui-size-space-2) 0;
    }
    .fine {
      color: var(--uui-color-text-alt, #555);
    }
    .problem {
      color: var(--uui-color-danger, #b00);
    }
  `
}

customElements.define('crombolo-webhook-workflows', CromboloWebhookWorkflowsElement)
