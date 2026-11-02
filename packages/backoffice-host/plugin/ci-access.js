/**
 * CI access, a Settings tool for administrators (story 160): the CI jobs this
 * site trusts to pull and push without a person, each by the repository and
 * branch, tag or environment its provider's signed identity token names. There
 * is no secret to set up; a rule here is all a job needs.
 */
import { css, html, nothing, repeat } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { CI_PERMISSIONS, providerName, trustApi } from './ci-access-words.js'

const EMPTY = {
  name: '',
  issuer: '',
  repository: '',
  refKind: 'branch',
  refValue: '',
  permissions: [],
}

export default class CromboloCiAccessElement extends UmbLitElement {
  static properties = {
    _state: { state: true },
    _draft: { state: true },
    _problems: { state: true },
    _busy: { state: true },
  }

  constructor() {
    super()
    this._state = undefined
    this._draft = undefined
    this._problems = []
    this._busy = false
  }

  connectedCallback() {
    super.connectedCallback()
    this.#load()
  }

  async #load() {
    try {
      this._state = await trustApi('GET')
    } catch (error) {
      this._state = { error: error.message }
    }
  }

  async #act(method, path, body) {
    this._busy = true
    this._problems = []
    try {
      await trustApi(method, path, body)
      this._draft = undefined
      await this.#load()
    } catch (error) {
      this._problems = error.items ?? [error.message]
    } finally {
      this._busy = false
    }
  }

  #set(field, value) {
    this._draft = { ...this._draft, [field]: value }
  }

  #toggle(verb, on) {
    const permissions = new Set(this._draft.permissions)
    if (on) permissions.add(verb)
    else permissions.delete(verb)
    this.#set('permissions', [...permissions])
  }

  #form() {
    const draft = this._draft
    const issuers = this._state.issuers ?? []
    return html`<uui-box headline="Trust a CI job">
      <div class="form">
        <uui-label for="ci-name">Name</uui-label>
        <uui-input id="ci-name" label="Name" .value=${draft.name} @input=${(e) => this.#set('name', e.target.value)}></uui-input>
        <uui-label for="ci-provider">Provider</uui-label>
        <uui-select
          id="ci-provider"
          label="Provider"
          .options=${issuers.map((issuer) => ({ name: providerName(issuer), value: issuer, selected: issuer === draft.issuer }))}
          @change=${(e) => this.#set('issuer', e.target.value)}
        ></uui-select>
        <uui-label for="ci-repository">Repository</uui-label>
        <uui-input
          id="ci-repository"
          label="Repository"
          placeholder="owner/name, or group/project"
          .value=${draft.repository}
          @input=${(e) => this.#set('repository', e.target.value)}
        ></uui-input>
        <uui-label for="ci-ref">Runs on</uui-label>
        <div class="ref">
          <uui-select
            label="Runs on"
            .options=${[
              { name: 'Branch', value: 'branch', selected: draft.refKind === 'branch' },
              { name: 'Tag', value: 'tag', selected: draft.refKind === 'tag' },
              {
                name: 'Environment',
                value: 'environment',
                selected: draft.refKind === 'environment',
              },
            ]}
            @change=${(e) => this.#set('refKind', e.target.value)}
          ></uui-select>
          <uui-input id="ci-ref" label="Its name" placeholder="main" .value=${draft.refValue} @input=${(e) => this.#set('refValue', e.target.value)}></uui-input>
        </div>
        <span class="label">May</span>
        <div class="may">
          ${CI_PERMISSIONS.map(
            (p) => html`<uui-toggle
              label=${p.label}
              .checked=${draft.permissions.includes(p.verb)}
              @change=${(e) => this.#toggle(p.verb, e.target.checked)}
            ></uui-toggle>
            <small>${p.explain}</small>`,
          )}
        </div>
      </div>
      ${
        this._problems.length > 0
          ? html`<ul class="problems" role="alert">${this._problems.map((p) => html`<li>${p}</li>`)}</ul>`
          : nothing
      }
      <div class="actions">
        <uui-button look="secondary" label="Cancel" @click=${() => {
          this._draft = undefined
          this._problems = []
        }}></uui-button>
        <uui-button
          look="primary"
          label="Trust this job"
          .state=${this._busy ? 'waiting' : undefined}
          @click=${() => this.#act('POST', '', draft)}
        ></uui-button>
      </div>
    </uui-box>`
  }

  render() {
    const state = this._state
    if (!state) return html`<uui-loader></uui-loader>`
    if (state.error)
      return html`<uui-box headline="CI access"><p role="alert">${state.error}</p></uui-box>`
    return html`
      ${
        state.remoteEnabled
          ? nothing
          : html`<p class="notice" role="status">
              This site does not take pulls or pushes yet, so these rules do nothing until it does.
            </p>`
      }
      ${this._draft ? this.#form() : nothing}
      <uui-box headline="Trusted CI jobs">
        <uui-button
          slot="header-actions"
          look="primary"
          label="Trust a CI job"
          ?disabled=${Boolean(this._draft)}
          @click=${() => {
            this._draft = { ...EMPTY, issuer: state.issuers?.[0] ?? '' }
          }}
        ></uui-button>
        <p class="intro">
          A job proves where it runs with its provider's signed identity, so there is no password or
          key to keep. It may only do what its rule says.
        </p>
        ${
          state.items.length === 0
            ? html`<p>No CI job is trusted yet.</p>`
            : html`<uui-table>
                <uui-table-head>
                  <uui-table-head-cell>Name</uui-table-head-cell>
                  <uui-table-head-cell>Runs from</uui-table-head-cell>
                  <uui-table-head-cell>May</uui-table-head-cell>
                  <uui-table-head-cell>Last used</uui-table-head-cell>
                  <uui-table-head-cell></uui-table-head-cell>
                </uui-table-head>
                ${repeat(
                  state.items,
                  (rule) => rule.key,
                  (rule) => html`<uui-table-row class=${rule.disabled ? 'disabled' : ''}>
                    <uui-table-cell>${rule.name}${rule.disabled ? html` <uui-tag look="secondary">Disabled</uui-tag>` : nothing}</uui-table-cell>
                    <uui-table-cell>${providerName(rule.issuer)} ${rule.repository}, ${rule.refKind} ${rule.refValue}</uui-table-cell>
                    <uui-table-cell>${rule.permissions.map((verb) => CI_PERMISSIONS.find((p) => p.verb === verb)?.label ?? verb).join(', ')}</uui-table-cell>
                    <uui-table-cell>${rule.lastUsedDate ? new Date(rule.lastUsedDate).toLocaleString() : 'Never'}</uui-table-cell>
                    <uui-table-cell class="row-actions">
                      <uui-button
                        look="secondary"
                        label=${rule.disabled ? 'Enable' : 'Disable'}
                        @click=${() => this.#act('POST', `/${rule.key}/${rule.disabled ? 'enable' : 'disable'}`)}
                      ></uui-button>
                      <uui-button
                        look="secondary"
                        color="danger"
                        label="Delete"
                        @click=${() => this.#act('DELETE', `/${rule.key}`)}
                      ></uui-button>
                    </uui-table-cell>
                  </uui-table-row>`,
                )}
              </uui-table>`
        }
      </uui-box>
    `
  }

  static styles = css`
    :host {
      display: block;
      padding: var(--uui-size-layout-1);
      max-width: 72rem;
    }
    uui-box + uui-box {
      margin-top: var(--uui-size-layout-1);
    }
    .notice {
      padding: var(--uui-size-space-4) var(--uui-size-space-5);
      border-left: 4px solid var(--uui-color-warning);
      background: color-mix(in srgb, var(--uui-color-warning) 12%, var(--uui-color-surface));
    }
    .intro {
      margin-top: 0;
      color: var(--uui-color-text-alt);
    }
    .form {
      display: grid;
      grid-template-columns: 10rem 1fr;
      gap: var(--uui-size-space-4);
      align-items: center;
    }
    .ref {
      display: flex;
      gap: var(--uui-size-space-3);
    }
    .may {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--uui-size-space-2) var(--uui-size-space-4);
      align-items: center;
    }
    .may small {
      color: var(--uui-color-text-alt);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--uui-size-space-3);
      margin-top: var(--uui-size-space-5);
    }
    .problems {
      color: var(--uui-color-danger);
    }
    .row-actions {
      display: flex;
      gap: var(--uui-size-space-2);
      justify-content: flex-end;
    }
    uui-table-row.disabled {
      opacity: 0.6;
    }
  `
}

customElements.define('crombolo-ci-access', CromboloCiAccessElement)
