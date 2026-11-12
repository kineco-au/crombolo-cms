/**
 * Settings → E-mail (story 340): the provider the site sends through, its key
 * and the sender. Set by the site's configuration, it is shown read-only.
 * Administrators only; every change is audited.
 */

import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { umbConfirmModal } from '@umbraco-cms/backoffice/modal'
import { bodyOf, draftOf, fieldsFor, PROVIDERS, summaryOf } from './email-settings-words.js'

const base = () => {
  const href = document.querySelector('base')?.getAttribute('href') ?? '/umbraco/'
  return `${href.replace(/\/$/, '')}/crombolo/api/email`
}

/** The answer and its body; an outcome the server refused carries its message. */
async function call(path, method = 'GET', body) {
  const response = await fetch(`${base()}${path}`, {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.message ?? `E-mail settings answered ${response.status}.`)
  return json
}

export default class CromboloEmailSettingsElement extends UmbLitElement {
  static properties = {
    _view: { state: true },
    _draft: { state: true },
    _problem: { state: true },
    _done: { state: true },
    _busy: { state: true },
  }

  constructor() {
    super()
    this._view = undefined
    this._draft = draftOf(undefined)
    this._problem = ''
    this._done = ''
    this._busy = false
  }

  connectedCallback() {
    super.connectedCallback()
    this.#load()
  }

  async #load() {
    try {
      this._view = await call('/settings')
      this._draft = draftOf(this._view)
    } catch (error) {
      this._problem = error.message
      this._view ??= { source: 'none', status: {} }
    }
  }

  async #run(work, done) {
    this._busy = true
    this._problem = ''
    this._done = ''
    try {
      await work()
      await this.#load()
      this._done = done
    } catch (error) {
      this._problem = error.message
    } finally {
      this._busy = false
    }
  }

  #save() {
    return this.#run(() => call('/settings', 'PUT', bodyOf(this._draft)), 'Saved.')
  }

  #test() {
    return this.#run(() => call('/test', 'POST', {}), 'A test e-mail is on its way to you.')
  }

  async #clear() {
    await umbConfirmModal(this, {
      color: 'danger',
      headline: 'Remove the e-mail settings?',
      content:
        'Invitations, password resets, notifications and form e-mails stop until it is set up again.',
      confirmLabel: 'Remove',
    })
    await this.#run(() => call('/settings', 'DELETE'), 'Removed.')
  }

  #input(name, label, options = {}) {
    return html`<uui-form-layout-item>
      <uui-label slot="label" for=${name}>${label}</uui-label>
      <uui-input
        id=${name}
        label=${label}
        type=${options.type ?? 'text'}
        placeholder=${options.placeholder ?? ''}
        ?readonly=${options.readonly}
        .value=${this._draft[name] ?? ''}
        @input=${(event) => (this._draft = { ...this._draft, [name]: event.target.value })}></uui-input>
      ${options.hint ? html`<div slot="description">${options.hint}</div>` : nothing}
    </uui-form-layout-item>`
  }

  #form() {
    const view = this._view
    const locked = view.source === 'config' || view.source === 'off'
    if (view.source === 'off') return nothing
    const draft = this._draft
    const provider = PROVIDERS[draft.provider]
    const keyHint = locked
      ? undefined
      : !view.canKeepKeys
        ? "This site can't keep keys until whoever hosts it gives it a secret key."
        : view.keyKept
          ? 'A key is kept. Leave this empty to keep it.'
          : undefined
    return html`<div class="form">
      <uui-form-layout-item>
        <uui-label slot="label" for="provider">Provider</uui-label>
        <uui-select
          id="provider"
          label="Provider"
          ?disabled=${locked}
          .options=${Object.entries(PROVIDERS).map(([value, { label }]) => ({
            name: label,
            value,
            selected: draft.provider === value,
          }))}
          @change=${(event) => (this._draft = { ...this._draft, provider: event.target.value })}></uui-select>
      </uui-form-layout-item>
      ${this.#input('from', 'Send from', { placeholder: 'no-reply@example.com', readonly: locked })}
      ${this.#input('fromName', 'Sender name (optional)', { placeholder: 'Example', readonly: locked })}
      ${fieldsFor(draft.provider).map((field) =>
        this.#input(field.name, field.label, { placeholder: field.placeholder, readonly: locked }),
      )}
      ${
        locked
          ? nothing
          : this.#input('key', provider?.key ?? 'Key', {
              type: 'password',
              hint: keyHint,
              placeholder: view.keyKept ? '••••••••' : '',
            })
      }
      <div class="actions">
        ${
          locked
            ? nothing
            : html`<uui-button look="primary" label="Save" ?disabled=${this._busy} @click=${() => this.#save()}></uui-button>`
        }
        <uui-button
          look="secondary"
          label="Send me a test e-mail"
          ?disabled=${this._busy || !view.status?.available}
          @click=${() => this.#test()}></uui-button>
        ${
          view.source === 'settings'
            ? html`<uui-button
                look="secondary"
                color="danger"
                label="Remove"
                ?disabled=${this._busy}
                @click=${() => this.#clear()}></uui-button>`
            : nothing
        }
      </div>
    </div>`
  }

  render() {
    const view = this._view
    if (!view) return html`<uui-loader></uui-loader>`
    const locked = view.source === 'config' || view.source === 'off'
    const affects = view.status?.affects ?? []
    return html`<uui-box headline="E-mail">
      <p class=${view.status?.available ? 'summary' : 'summary warning'}>
        ${view.status?.available ? nothing : html`<uui-icon name="icon-alert"></uui-icon>`}
        ${summaryOf(view)}
      </p>
      ${
        affects.length > 0
          ? html`<p>Until it is, these are unavailable:</p>
              <ul class="affected">
                ${affects.map((feature) => html`<li>${feature}</li>`)}
              </ul>`
          : nothing
      }
      ${locked ? html`<p class="note">Whoever hosts the site changes it in the server's configuration.</p>` : nothing}
      ${this._problem ? html`<p class="problem" role="alert">${this._problem}</p>` : nothing}
      ${this._done ? html`<p class="done" role="status">${this._done}</p>` : nothing}
      ${this.#form()}
    </uui-box>`
  }

  static styles = css`
    :host {
      display: block;
      padding: var(--uui-size-layout-1);
      max-width: 72rem;
    }
    .summary {
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-2);
      margin-top: 0;
      font-weight: 600;
    }
    .warning uui-icon {
      color: var(--uui-color-warning-standalone);
    }
    .note {
      color: var(--uui-color-text-alt);
    }
    .affected {
      margin-top: 0;
    }
    .form {
      max-width: 40rem;
    }
    uui-input,
    uui-select {
      width: 100%;
    }
    .actions {
      display: flex;
      gap: var(--uui-size-space-2);
      margin-top: var(--uui-size-space-5);
    }
    .problem {
      color: var(--uui-color-danger);
    }
    .done {
      color: var(--uui-color-positive);
    }
  `
}

customElements.define('crombolo-email-settings', CromboloEmailSettingsElement)
