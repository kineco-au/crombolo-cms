/**
 * Service accounts, a Settings tool for administrators (story 433): the list, and one
 * account's screen by `?account=<key>`, its groups, client ids and what it is used for.
 * A secret is shown once, when made; taking away what something uses asks first.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { ask } from './ask.js'
import {
  accountsApi,
  HEADLINE,
  INTRO,
  lastUsedLine,
  NONE,
  OLD_STOPS,
  oldSecretLine,
  SHOWN_ONCE,
  stopQuestion,
  usedForLine,
} from './service-accounts-words.js'

const selected = () => new URL(location.href).searchParams.get('account')

export default class CromboloServiceAccountsElement extends UmbLitElement {
  static properties = {
    _list: { state: true },
    _account: { state: true },
    _draft: { state: true },
    _secret: { state: true },
    _error: { state: true },
    _busy: { state: true },
    _stops: { state: true },
  }

  constructor() {
    super()
    this._stops = 'day'
    this._onPop = () => this.#load()
  }

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener('popstate', this._onPop)
    this.#load()
  }

  disconnectedCallback() {
    window.removeEventListener('popstate', this._onPop)
    super.disconnectedCallback()
  }

  async #load() {
    this._error = undefined
    try {
      this._list = await accountsApi('GET')
      const key = selected()
      this._account = key ? await accountsApi('GET', `/${key}`) : undefined
      this._draft = this._account
        ? { name: this._account.name, groupKeys: this._account.groups.map((g) => g.key) }
        : this._draft
    } catch (error) {
      this._error = error.message
    }
  }

  #open(key) {
    const url = new URL(location.href)
    if (key) url.searchParams.set('account', key)
    else url.searchParams.delete('account')
    history.pushState(null, '', url)
    this._secret = undefined
    this._draft = undefined
    this.#load()
  }

  async #do(work) {
    this._busy = true
    this._error = undefined
    try {
      return await work()
    } catch (error) {
      this._error = error.message
    } finally {
      this._busy = false
    }
  }

  async #create() {
    const made = await this.#do(() => accountsApi('POST', '', this._draft))
    if (made) this.#open(made.key)
  }

  async #save() {
    if (await this.#do(() => accountsApi('PUT', `/${this._account.key}`, this._draft)))
      await this.#load()
  }

  async #stop(action, label, uses, method, path) {
    if (!(await ask(this, { ...stopQuestion(action, label, uses), confirmLabel: action })))
      return undefined
    return this.#do(() => accountsApi(method, `${path}?confirm=true`))
  }

  async #setEnabled(enabled) {
    const account = this._account
    const done = enabled
      ? await this.#do(() => accountsApi('POST', `/${account.key}/enable`))
      : await this.#stop(
          'Disable',
          account.name,
          account.usedFor,
          'POST',
          `/${account.key}/disable`,
        )
    if (done) await this.#load()
  }

  async #delete() {
    const account = this._account
    if (await this.#stop('Delete', account.name, account.usedFor, 'DELETE', `/${account.key}`))
      this.#open(undefined)
  }

  async #addClient() {
    const made = await this.#do(() => accountsApi('POST', `/${this._account.key}/clients`))
    if (made) {
      this._secret = made
      await this.#load()
    }
  }

  async #replace(client) {
    const made = await this.#do(() =>
      accountsApi(
        'POST',
        `/${this._account.key}/clients/${encodeURIComponent(client.clientId)}/secret`,
        { oldStops: this._stops },
      ),
    )
    if (made) {
      this._secret = made
      await this.#load()
    }
  }

  async #removeClient(client) {
    const path = `/${this._account.key}/clients/${encodeURIComponent(client.clientId)}`
    if (await this.#stop('Remove', client.clientId, client.usedFor, 'DELETE', path)) {
      this._secret = undefined
      await this.#load()
    }
  }

  #groupPicker() {
    const chosen = new Set(this._draft?.groupKeys ?? [])
    return html`<fieldset>
      <legend>Groups: what it may do</legend>
      ${(this._list?.groups ?? []).map(
        (group) => html`<uui-checkbox
          label=${group.name}
          ?checked=${chosen.has(group.key)}
          @change=${(e) => {
            const keys = new Set(this._draft.groupKeys)
            if (e.target.checked) keys.add(group.key)
            else keys.delete(group.key)
            this._draft = { ...this._draft, groupKeys: [...keys] }
          }}></uui-checkbox>`,
      )}
    </fieldset>`
  }

  #nameInput() {
    return html`<uui-label for="sa-name">Name</uui-label>
      <uui-input
        id="sa-name"
        label="Name"
        .value=${this._draft?.name ?? ''}
        @input=${(e) => {
          this._draft = { ...this._draft, name: e.target.value }
        }}></uui-input>`
  }

  #renderSecret() {
    if (!this._secret) return nothing
    return html`<div class="made">
      <strong>${SHOWN_ONCE}</strong>
      <span>Client id: <code>${this._secret.clientId}</code></span>
      <span>Secret: <code>${this._secret.secret}</code></span>
      <uui-button
        look="secondary"
        label="Copy the secret"
        @click=${() => navigator.clipboard?.writeText(this._secret.secret)}></uui-button>
    </div>`
  }

  #renderAccount() {
    const account = this._account
    return html`<uui-box headline=${account.name}>
      <uui-button slot="header-actions" look="secondary" label="All service accounts" @click=${() => this.#open(undefined)}></uui-button>
      <p><strong>Used for:</strong> ${usedForLine(account.usedFor)}</p>
      <p class="muted">${account.enabled ? 'Enabled' : 'Disabled'} · ${lastUsedLine(account.lastUsedAt)}</p>
      <div class="form">${this.#nameInput()}</div>
      ${this.#groupPicker()}
      <div class="actions">
        <uui-button look="primary" label="Save" ?disabled=${this._busy || !this._draft?.name?.trim()} @click=${() => this.#save()}></uui-button>
        <uui-button look="secondary" label=${account.enabled ? 'Disable' : 'Enable'} ?disabled=${this._busy} @click=${() => this.#setEnabled(!account.enabled)}></uui-button>
        <uui-button look="secondary" color="danger" label="Delete" ?disabled=${this._busy} @click=${() => this.#delete()}></uui-button>
      </div>
    </uui-box>
    <uui-box headline="Client ids and secrets">
      ${this.#renderSecret()}
      ${
        account.clients.length === 0
          ? html`<p>It has no client id, so nothing can sign in as it.</p>`
          : html`<ul>
              ${account.clients.map(
                (client) => html`<li>
                  <div>
                    <code>${client.clientId}</code>
                    <small>Added ${new Date(client.addedAt).toLocaleDateString()} · ${lastUsedLine(client.lastUsedAt)}</small>
                    <small>${usedForLine(client.usedFor)}</small>
                    ${client.oldSecretUntil ? html`<small>${oldSecretLine(client.oldSecretUntil)}</small>` : nothing}
                  </div>
                  <div class="actions">
                    <uui-button look="secondary" label="Replace the secret" ?disabled=${this._busy} @click=${() => this.#replace(client)}></uui-button>
                    <uui-button look="secondary" color="danger" label="Remove" ?disabled=${this._busy} @click=${() => this.#removeClient(client)}></uui-button>
                  </div>
                </li>`,
              )}
            </ul>
            <div class="form">
              <uui-label for="sa-stops">When a secret is replaced, the old one stops</uui-label>
              <uui-select
                id="sa-stops"
                label="When the old secret stops"
                .options=${OLD_STOPS.map((o) => ({ name: o.label, value: o.value, selected: o.value === this._stops }))}
                @change=${(e) => {
                  this._stops = e.target.value
                }}></uui-select>
            </div>`
      }
      <uui-button look="primary" label="Add a client id" ?disabled=${this._busy} @click=${() => this.#addClient()}></uui-button>
    </uui-box>
    <uui-box headline="Activity">
      ${
        account.activity.length === 0
          ? html`<p>Nothing yet.</p>`
          : html`<ul>
              ${account.activity.map(
                (entry) => html`<li>
                  <div>
                    <span>${entry.detail ?? entry.action}</span>
                    <small>${new Date(entry.at).toLocaleString()}${entry.by ? ` · ${entry.by}` : ''}</small>
                  </div>
                </li>`,
              )}
            </ul>`
      }
    </uui-box>`
  }

  #renderList() {
    const items = this._list?.items ?? []
    return html`<uui-box headline=${HEADLINE}>
      <p class="muted">${INTRO}</p>
      ${
        this._draft
          ? html`<div class="new">
              <div class="form">${this.#nameInput()}</div>
              ${this.#groupPicker()}
              <div class="actions">
                <uui-button look="primary" label="Create" ?disabled=${this._busy || !this._draft.name?.trim()} @click=${() => this.#create()}></uui-button>
                <uui-button look="secondary" label="Cancel" @click=${() => {
                  this._draft = undefined
                }}></uui-button>
              </div>
            </div>`
          : html`<uui-button look="primary" label="New service account" @click=${() => {
              this._draft = { name: '', groupKeys: [] }
            }}></uui-button>`
      }
      ${
        items.length === 0
          ? html`<p>${NONE}</p>`
          : html`<ul>
              ${items.map(
                (account) => html`<li>
                  <div>
                    <button class="link" type="button" @click=${() => this.#open(account.key)}><strong>${account.name}</strong></button>
                    <small>${account.groups.map((g) => g.name).join(', ') || 'No groups'} · ${account.clients.length} client id${account.clients.length === 1 ? '' : 's'} · ${lastUsedLine(account.lastUsedAt)}${account.enabled ? '' : ' · Disabled'}</small>
                    <small>${usedForLine(account.usedFor)}</small>
                  </div>
                </li>`,
              )}
            </ul>`
      }
    </uui-box>`
  }

  render() {
    return html`${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
    ${this._account ? this.#renderAccount() : this._list ? this.#renderList() : nothing}`
  }

  static styles = css`
    :host {
      display: block;
      padding: var(--uui-size-layout-1);
    }
    uui-box + uui-box {
      margin-top: var(--uui-size-space-5);
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
    .actions {
      display: flex;
      flex-direction: row;
      gap: var(--uui-size-space-3);
      flex-wrap: wrap;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-2);
      margin: var(--uui-size-space-4) 0;
      max-width: 32rem;
    }
    fieldset {
      border: none;
      padding: 0;
      margin: 0 0 var(--uui-size-space-4);
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-2);
    }
    button.link {
      all: unset;
      cursor: pointer;
      color: var(--uui-color-interactive);
    }
    button.link:hover,
    button.link:focus-visible {
      text-decoration: underline;
    }
    .new {
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

customElements.define('crombolo-service-accounts', CromboloServiceAccountsElement)
