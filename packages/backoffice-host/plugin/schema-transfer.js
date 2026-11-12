/**
 * Settings → Schema (story 342): the site's types and definitions downloaded
 * as TOML, and schema files uploaded to wait for approval on the Changes
 * dashboard. Administrators only.
 */

import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { downloadFile } from './download.js'
import { exportUrl, fetchPending, uploadSchema } from './schema-transfer-client.js'
import { ACCEPT, describeImport } from './schema-transfer-words.js'

const changesPath = () =>
  `${(document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')}/section/settings/dashboard/changes`

export default class CromboloSchemaTransferElement extends UmbLitElement {
  static properties = {
    _state: { state: true },
    _problem: { state: true },
    _problems: { state: true },
    _busy: { state: true },
  }

  constructor() {
    super()
    this._state = undefined
    this._problem = ''
    this._problems = []
    this._busy = false
  }

  connectedCallback() {
    super.connectedCallback()
    this.#load()
  }

  async #load() {
    const result = await fetchPending()
    if (result.ok) this._state = { pending: result.pending, writable: result.writable }
    else {
      this._problem = result.message
      this._state ??= { pending: null, writable: false }
    }
  }

  async #export() {
    this._problem = ''
    try {
      await downloadFile(exportUrl(), 'schema.zip')
    } catch (error) {
      this._problem = error.message
    }
  }

  async #upload(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    this._busy = true
    this._problem = ''
    this._problems = []
    try {
      const result = await uploadSchema(file)
      if (!result.ok) {
        this._problem = result.message
        this._problems = result.problems ?? []
      }
      await this.#load()
    } finally {
      this._busy = false
    }
  }

  #pending() {
    const pending = this._state?.pending
    if (!pending) return nothing
    return html`<div class="pending" role="status">
      <uui-icon name=${pending.blocked ? 'icon-alert' : 'icon-time'}></uui-icon>
      <div>
        <strong>${pending.fileName}</strong> is waiting for approval: ${describeImport(pending)}.
        ${
          pending.blocked
            ? html`Something stops it from being applied.`
            : html`Nothing changes until it is applied.`
        }
        <a href=${changesPath()}>Review it on the Changes dashboard</a>
      </div>
    </div>`
  }

  render() {
    const state = this._state
    if (!state) return html`<uui-loader></uui-loader>`
    return html`
      <uui-box headline="Export">
        <p>
          Download this site's document, media and member types, data types, languages, forms,
          approval workflows, user groups and webhooks, as the files the site keeps them in.
        </p>
        <uui-button look="primary" label="Download the schema" @click=${() => this.#export()}></uui-button>
      </uui-box>
      <uui-box headline="Import">
        ${
          state.writable
            ? html`<p>
                  Upload a schema downloaded from another site, as a zip or a single file. It is
                  checked against this site and waits on the Changes dashboard until an administrator
                  applies it.
                </p>
                ${this.#pending()}
                <label class="upload">
                  <uui-button
                    look="secondary"
                    label=${state.pending ? 'Upload instead' : 'Upload a schema'}
                    ?disabled=${this._busy}
                    @click=${() => this.renderRoot.querySelector('input[type=file]')?.click()}
                  ></uui-button>
                  <input type="file" accept=${ACCEPT} hidden @change=${(event) => this.#upload(event)} />
                </label>
                ${state.pending ? html`<p class="note">A new upload replaces the one waiting.</p>` : nothing}`
            : html`<p class="note">
                This site's schema changes only when the site is deployed, so it can't be imported here.
              </p>`
        }
        ${this._busy ? html`<uui-loader-bar></uui-loader-bar>` : nothing}
        ${this._problem ? html`<p class="problem" role="alert">${this._problem}</p>` : nothing}
        ${
          this._problems.length > 0
            ? html`<ul class="problems">${this._problems.map((p) => html`<li>${p}</li>`)}</ul>`
            : nothing
        }
      </uui-box>
    `
  }

  static styles = css`
    :host {
      display: grid;
      gap: var(--uui-size-layout-1);
      padding: var(--uui-size-layout-1);
      max-width: 72rem;
    }
    .pending {
      display: flex;
      gap: var(--uui-size-space-3);
      align-items: flex-start;
      padding: var(--uui-size-space-4);
      margin-bottom: var(--uui-size-space-4);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface-alt);
    }
    .note {
      color: var(--uui-color-text-alt);
    }
    .problem {
      color: var(--uui-color-danger);
    }
    .problems {
      margin: 0;
      font-family: var(--uui-font-monospace, monospace);
      font-size: var(--uui-type-small-size);
    }
  `
}

customElements.define('crombolo-schema-transfer', CromboloSchemaTransferElement)
