/**
 * Settings → Trusted signers (story 316): the keys and builds this site trusts
 * to sign the site bundles it applies, as GitHub lists SSH keys. This site's own
 * key is at the top, to copy to the sites that take its bundles. Administrators
 * only; every change is audited.
 */

import { UMB_CURRENT_USER_CONTEXT } from '@umbraco-cms/backoffice/current-user'
import { css, html, nothing, repeat } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { umbConfirmModal } from '@umbraco-cms/backoffice/modal'
import { switchedOffWords } from './trusted-signers-words.js'

const base = () => {
  const href = document.querySelector('base')?.getAttribute('href') ?? '/umbraco/'
  return `${href.replace(/\/$/, '')}/crombolo/api/bundles/signers`
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
  if (!response.ok)
    throw new Error(json.message ?? `The list could not be changed (${response.status}).`)
  return json
}

const KINDS = {
  user: 'User key',
  site: 'Site key',
  source: 'Build in CI',
}

const EMPTY = { kind: 'user', name: '', publicKey: '', source: '' }

const when = (iso) => (iso ? new Date(iso).toLocaleDateString() : '')

export default class CromboloTrustedSignersElement extends UmbLitElement {
  static properties = {
    _items: { state: true },
    _draft: { state: true },
    _renaming: { state: true },
    _problem: { state: true },
    _notice: { state: true },
    _busy: { state: true },
    _copied: { state: true },
    _mine: { state: true },
    _me: { state: true },
  }

  constructor() {
    super()
    this._items = undefined
    this._draft = { ...EMPTY }
    this._renaming = undefined
    this._problem = ''
    this._busy = false
    this._copied = false
    /** "Add my key" chosen: the form shows the steps to make one. */
    this._mine = false
    this._me = ''
    this.consumeContext(UMB_CURRENT_USER_CONTEXT, (user) => {
      this.observe(user?.currentUser, (current) => {
        this._me = current?.name ?? ''
      })
    })
  }

  #addMine() {
    this._mine = true
    this._draft = { ...EMPTY, kind: 'user', name: this._me ? `${this._me}'s key` : '' }
    this.updateComplete.then(() =>
      this.renderRoot.querySelector('uui-box.add')?.scrollIntoView({ behavior: 'smooth' }),
    )
  }

  /** The steps to make a key of your own, shown when adding yours. */
  #steps() {
    const name = (this._me || 'my-key')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    return html`<ol class="steps">
      <li>
        On your own computer, in a site's folder, run
        <code>bunx crombolo keys create ${name}</code>. The private half stays on that computer.
      </li>
      <li>Copy the line it prints, which starts <code>crombolo-ed25519</code>.</li>
      <li>Paste it below, and add it.</li>
      <li>
        Sign a site bundle with it: <code>bunx crombolo site build . --out ../bundle --sign-with
        ${name}</code>.
      </li>
    </ol>`
  }

  connectedCallback() {
    super.connectedCallback()
    this.#load()
  }

  async #load() {
    try {
      this._items = (await call('')).items ?? []
    } catch (error) {
      this._problem = error.message
      this._items = []
    }
  }

  async #run(work) {
    this._busy = true
    this._problem = ''
    try {
      await work()
      await this.#load()
    } catch (error) {
      this._problem = error.message
    } finally {
      this._busy = false
    }
  }

  #add() {
    const draft = this._draft
    return this.#run(async () => {
      this._mine = false
      await call(
        '',
        'POST',
        draft.kind === 'source'
          ? { kind: 'source', name: draft.name, source: draft.source }
          : { kind: draft.kind, name: draft.name, publicKey: draft.publicKey },
      )
      this._draft = { ...EMPTY }
    })
  }

  #rename(item) {
    return this.#run(async () => {
      await call(`/${item.id}`, 'PUT', { name: this._renaming.name })
      this._renaming = undefined
    })
  }

  async #remove(item) {
    await umbConfirmModal(this, {
      color: 'danger',
      headline: `Stop trusting ${item.name}?`,
      content:
        'Site bundles it signed are refused from now on, including ones already made. An extension it vouched for that acts as you or runs unrestricted is switched off now. You can add it again later.',
      confirmLabel: 'Remove',
    })
    this._notice = ''
    await this.#run(async () => {
      const result = await call(`/${item.id}`, 'DELETE')
      this._notice = switchedOffWords(result.switchedOff)
    })
  }

  async #copy(line) {
    await navigator.clipboard?.writeText(line)
    this._copied = true
    setTimeout(() => {
      this._copied = false
    }, 2000)
  }

  #identity(item) {
    return item.source
      ? html`<code>${item.source}</code>`
      : html`<code class="fingerprint">${item.fingerprint}</code>`
  }

  #row(item) {
    const renaming = this._renaming?.id === item.id && item.id
    return html`<li class="signer">
      <div class="who">
        ${
          renaming
            ? html`<uui-input
                label="Name"
                .value=${this._renaming.name}
                @input=${(event) => (this._renaming = { ...this._renaming, name: event.target.value })}></uui-input>`
            : html`<strong>${item.name}</strong>`
        }
        <span class="kind">${KINDS[item.kind] ?? item.kind}</span>
        <div>${this.#identity(item)}</div>
        <div class="meta">
          ${
            item.own
              ? 'This site’s own key: always trusted here.'
              : item.locked
                ? 'Set in the site’s configuration.'
                : `Added ${item.addedBy ? `by ${item.addedBy} ` : ''}on ${when(item.addedAt)}.`
          }
          ${item.lastSignedAt ? ` Last signed something applied here on ${when(item.lastSignedAt)}.` : ''}
        </div>
      </div>
      <div class="actions">
        ${
          item.own
            ? html`<uui-button
                look="secondary"
                label=${this._copied ? 'Copied' : 'Copy its public key'}
                @click=${() => this.#copy(item.publicKey)}></uui-button>`
            : nothing
        }
        ${
          item.id && !item.locked
            ? renaming
              ? html`<uui-button look="primary" label="Save" ?disabled=${this._busy} @click=${() => this.#rename(item)}></uui-button>
                  <uui-button label="Cancel" @click=${() => (this._renaming = undefined)}></uui-button>`
              : html`<uui-button
                    look="secondary"
                    label="Rename"
                    @click=${() => (this._renaming = { id: item.id, name: item.name })}></uui-button>
                  <uui-button
                    look="secondary"
                    color="danger"
                    label="Remove"
                    @click=${() => this.#remove(item)}></uui-button>`
            : nothing
        }
      </div>
    </li>`
  }

  #form() {
    const draft = this._draft
    const set = (patch) => {
      this._draft = { ...this._draft, ...patch }
    }
    return html`<uui-box class="add" headline=${this._mine ? 'Add my key' : 'Add a trusted signer'}>
      <div class="form">
        ${this._mine ? this.#steps() : nothing}
        <uui-select
          label="What it is"
          .options=${Object.entries(KINDS).map(([value, name]) => ({
            name,
            value,
            selected: draft.kind === value,
          }))}
          @change=${(event) => set({ kind: event.target.value })}></uui-select>
        <uui-input
          label="Name"
          placeholder=${draft.kind === 'source' ? 'Our site’s releases' : 'Adam’s laptop'}
          .value=${draft.name}
          @input=${(event) => set({ name: event.target.value })}></uui-input>
        ${
          draft.kind === 'source'
            ? html`<uui-input
                label="Repository"
                placeholder="acme/site@v*"
                .value=${draft.source}
                @input=${(event) => set({ source: event.target.value })}></uui-input>
              <p class="hint">
                Bundles built and signed in GitHub Actions from this repository. Add @ and a tag
                pattern to take only its releases.
              </p>`
            : html`<uui-textarea
                label="Public key"
                placeholder="crombolo-ed25519 AAAA… name"
                .value=${draft.publicKey}
                @input=${(event) => set({ publicKey: event.target.value })}></uui-textarea>
              <p class="hint">
                ${
                  draft.kind === 'site'
                    ? 'Another site’s key, from the top of its own Trusted signers list.'
                    : 'A person’s or a CI job’s key, from `crombolo keys create`.'
                }
              </p>`
        }
        <uui-button
          look="primary"
          label="Add"
          ?disabled=${this._busy || !draft.name}
          @click=${() => this.#add()}></uui-button>
      </div>
    </uui-box>`
  }

  render() {
    if (!this._items) return html`<uui-loader></uui-loader>`
    return html`
      <uui-box headline="Trusted signers">
        <uui-button
          slot="header-actions"
          look="primary"
          label="Add my key"
          @click=${() => this.#addMine()}></uui-button>
        <p class="intro">
          A site bundle is applied here only when one of these signed it. In production that is
          required; elsewhere an unsigned one is applied, with a warning.
        </p>
        ${this._problem ? html`<p class="problem" role="alert">${this._problem}</p>` : nothing}
        ${this._notice ? html`<p class="notice" role="status">${this._notice}</p>` : nothing}
        <ul class="signers">
          ${repeat(
            this._items,
            (item) => item.id ?? item.fingerprint ?? item.source,
            (item) => this.#row(item),
          )}
        </ul>
      </uui-box>
      ${this.#form()}
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
    .intro,
    .hint,
    .meta {
      color: var(--uui-color-text-alt);
    }
    .intro {
      margin-top: 0;
    }
    .signers {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .signer {
      display: flex;
      justify-content: space-between;
      gap: var(--uui-size-space-5);
      padding: var(--uui-size-space-4) 0;
      border-top: 1px solid var(--uui-color-divider);
    }
    .kind {
      margin-left: var(--uui-size-space-3);
      color: var(--uui-color-text-alt);
    }
    .fingerprint {
      word-break: break-all;
    }
    .actions {
      display: flex;
      align-items: flex-start;
      gap: var(--uui-size-space-2);
      white-space: nowrap;
    }
    .form {
      display: grid;
      gap: var(--uui-size-space-4);
      max-width: 40rem;
    }
    .form uui-button {
      justify-self: start;
    }
    .problem {
      color: var(--uui-color-danger);
    }
    .notice {
      color: var(--uui-color-warning-standalone);
    }
    .steps {
      margin: 0;
      padding-left: var(--uui-size-space-6);
    }
    .steps li + li {
      margin-top: var(--uui-size-space-2);
    }
  `
}

customElements.define('crombolo-trusted-signers', CromboloTrustedSignersElement)
