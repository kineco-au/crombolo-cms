/**
 * The Marketplace view, in place of Umbraco's.
 *
 * A tab of the Bundles tool in Settings (story 238), where Umbraco's Packages
 * section had its Marketplace. What it replaces is an iframe of marketplace.umbraco.com, which cannot work
 * here twice over: npm refuses to be framed (`x-frame-options: SAMEORIGIN`), and
 * an Umbraco package does not install into this CMS anyway.
 *
 * What it shows instead is the npm registry, searched for the keyword a crombolo
 * bundle publishes, and filtered to the ones whose manifest is a valid bundle.
 * Installing runs `bun add` on the server, then adds the content the bundle
 * carries unless the site or the person installing declines it. A bundle that
 * asks for permissions installs only once someone grants each one, as it
 * asks, in its card, which the server insists on too (stories 222, 308).
 */
import { css, html, nothing, repeat } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { carriesTags } from './bundles-carries.js'
import { bundleSignature, installBundle, searchMarketplace } from './bundles-client.js'
import { levelBlock, levelStyles } from './bundles-level.js'
import { configSnippet, grantChoice, unvouchedLine } from './bundles-level-words.js'
import { signatureBlock, signatureStyles, signatureWords } from './bundles-signature.js'

export default class CromboloBundlesMarketplaceElement extends UmbLitElement {
  static properties = {
    _items: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _busy: { state: true },
    _notice: { state: true },
    _keyword: { state: true },
    _url: { state: true },
    _appliesContent: { state: true },
    _declined: { state: true },
    _installs: { state: true },
    _elsewhere: { state: true },
    _consenting: { state: true },
    _trusted: { state: true },
    _asks: { state: true },
    _layout: { state: true },
    _layoutChoice: { state: true },
    _reviewing: { state: true },
    _signatures: { state: true },
  }

  constructor() {
    super()
    this._items = []
    this._loading = true
    this._error = ''
    this._busy = ''
    this._notice = ''
    this._keyword = 'crombolo-extension'
    this._url = ''
    this._query = ''
    this._appliesContent = true
    this._declined = new Set()
    this._installs = true
    this._elsewhere = null
    this._consenting = ''
    this._trusted = false
    this._asks = []
    this._reviewing = ''
    this._signatures = new Map()
  }

  connectedCallback() {
    super.connectedCallback()
    this.#load()
  }

  async #load() {
    this._loading = true
    this._error = ''
    try {
      const result = await searchMarketplace(this._query)
      this._items = result.items ?? []
      this._keyword = result.keyword ?? this._keyword
      this._url = result.url ?? ''
      this._appliesContent = result.appliesContent !== false
      this._installs = result.installs !== false
      this._elsewhere = result.installsElsewhere ?? null
      this._mayGrant = result.mayGrant ?? {}
      // Story 324: installing is an administrator's, as granting is.
      this._isAdmin = this._mayGrant.limited === 'yes'
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error)
    } finally {
      this._loading = false
    }
  }

  /** The host's own place for installs, when it gave one. */
  #elsewhereLink() {
    const url = this._elsewhere?.url
    return url ? html`<a href=${url} target="_blank" rel="noopener">Add extensions</a>` : ''
  }

  #search(event) {
    this._query = event.target.value ?? ''
    this.#load()
  }

  /**
   * Where the version was built is checked first and shown (story 060), so the
   * person sees signed or not, and whether this site would take it, before
   * anything is installed.
   */
  async #requestInstall(item) {
    this._busy = item.name
    this._notice = ''
    try {
      const checked = await bundleSignature(item.name, item.version)
      if (!checked.ok) {
        this._notice = checked.message ?? ''
        return
      }
      this._signatures = new Map(this._signatures).set(item.name, checked)
      this._reviewing = item.name
    } catch (error) {
      this._notice = error instanceof Error ? error.message : String(error)
    } finally {
      this._busy = ''
    }
  }

  #signature(item) {
    const checked = this._signatures.get(item.name)
    if (!checked) return nothing
    return signatureBlock(signatureWords(checked.provenance, checked.refused, checked.policy))
  }

  /** The signature, and the install it leads to unless this site would refuse it. */
  #review(item) {
    const checked = this._signatures.get(item.name)
    const refused =
      Boolean(checked?.refused) ||
      checked?.provenance?.state === 'invalid' ||
      checked?.provenance?.state === 'unchecked'
    return html`
      ${this.#signature(item)}
      <div class="actions">
        ${
          refused
            ? nothing
            : html`<uui-button
                look="primary"
                label="Install"
                .state=${this._busy === item.name ? 'waiting' : undefined}
                @click=${() => this.#install(item, false)}></uui-button>`
        }
        <uui-button
          look="secondary"
          label="Cancel"
          @click=${() => {
            this._reviewing = ''
          }}></uui-button>
      </div>
    `
  }

  #askConsent(item, outcome) {
    this._consenting = item.name
    this._trusted = false
    this._asks = outcome.permissions ?? []
    // Story 324: how far it reaches, and the four groups, before anything else.
    this._level = outcome.level ?? 'limited'
    this._groups = outcome.groups ?? {}
    this._id = outcome.id ?? item.name
    // Story 312: the site layout its page templates sit in, its suggestion first.
    this._layout = outcome.layout
    this._layoutChoice = outcome.layout?.suggested ?? ''
  }

  #cancelConsent() {
    this._consenting = ''
    this._trusted = false
    this._asks = []
  }

  async #install(item, granting) {
    this._busy = item.name
    this._notice = ''
    try {
      const outcome = await installBundle(
        item.name,
        item.version,
        !this._declined.has(item.name),
        granting ? this._asks.map((ask) => ask.permission) : [],
        granting && this._layout && this._layoutChoice
          ? { [this._layout.key]: this._layoutChoice }
          : undefined,
      )
      // It asks for permissions, or a version asks for more than was granted:
      // the server says what, with the reasons, and the card asks.
      if (outcome.needsGrant) {
        if (granting) this._notice = outcome.message ?? ''
        this.#askConsent(item, outcome)
        return
      }
      this._consenting = ''
      this._reviewing = ''
      // The dependency line is what there is to commit, so it is shown rather
      // than described: the install lives in this node's node_modules until it
      // is in the site's repository.
      const installed = outcome.dependency
        ? `${outcome.message} — "${outcome.dependency.name}": "${outcome.dependency.range}"`
        : (outcome.message ?? '')
      this._notice = outcome.content ? `${installed} ${outcome.content.message}` : installed
      if (outcome.ok) await this.#load()
    } catch (error) {
      this._notice = error instanceof Error ? error.message : String(error)
    } finally {
      this._busy = ''
    }
  }

  #toggleContent(item, event) {
    const declined = new Set(this._declined)
    if (event.target.checked) declined.delete(item.name)
    else declined.add(item.name)
    this._declined = declined
  }

  #contentChoice(item) {
    if (!item.carries?.content || item.installedVersion || !this._installs) return nothing
    if (!this._appliesContent)
      return html`<p class="meta">Its content is added separately on this site.</p>`
    return html`
      <uui-toggle
        label="Add its content when installing"
        .checked=${!this._declined.has(item.name)}
        @change=${(event) => this.#toggleContent(item, event)}></uui-toggle>
    `
  }

  /** How far it reaches at a glance, the four groups, the detail on asking, and the grant (story 324). */
  #consent(item) {
    const checked = this._signatures.get(item.name)
    const state = checked?.provenance?.state
    const choice = grantChoice(this._level, this._mayGrant, state)
    return html`
      <div class="consent" role="group" aria-label="What it asks for">
        ${levelBlock({
          level: this._level,
          groups: this._groups,
          permissions: this._asks,
          unvouched: unvouchedLine(this._level, state),
        })}
        ${this.#signature(item)}
        ${
          this._layout
            ? html`<uui-select
                label=${this._layout.label}
                .options=${[
                  { name: 'None: a page of its own', value: '', selected: !this._layoutChoice },
                  ...this._layout.values.map((layout) => ({
                    name: layout,
                    value: layout,
                    selected: layout === this._layoutChoice,
                  })),
                ]}
                @change=${(event) => {
                  this._layoutChoice = event.target.value
                }}></uui-select>`
            : nothing
        }
        <p class="meta">
          <span>Published by ${item.publisher ?? 'an unnamed publisher'}</span>
          <a href=${item.links.npm} target="_blank" rel="noopener">npm</a>
          ${
            item.links.repository
              ? html`<a href=${item.links.repository} target="_blank" rel="noopener">source</a>`
              : nothing
          }
        </p>
        ${
          choice.grant
            ? html`<uui-checkbox
                  label="I trust this publisher, and grant what it asks for"
                  .checked=${this._trusted}
                  @change=${(event) => {
                    this._trusted = event.target.checked
                  }}></uui-checkbox>
                <div class="actions">
                  <uui-button
                    look="primary"
                    color=${this._level === 'limited' ? 'positive' : 'warning'}
                    label="Grant and install"
                    ?disabled=${!this._trusted}
                    .state=${this._busy === item.name ? 'waiting' : undefined}
                    @click=${() => this.#install(item, true)}></uui-button>
                  <uui-button look="secondary" label="Cancel" @click=${this.#cancelConsent}></uui-button>
                </div>`
            : html`<p class="note">
                  ${
                    choice.snippet
                      ? 'This site turns on Unrestricted extensions only in its configuration. Your developers add this to crombolo.config.ts:'
                      : choice.sentence
                  }
                </p>
                ${
                  choice.snippet
                    ? html`<pre class="snippet">${configSnippet(
                        this._id,
                        this._asks.map((ask) => ask.permission),
                        this._asks.flatMap((ask) => ask.origins ?? []),
                      )}</pre>`
                    : nothing
                }
                <div class="actions">
                  <uui-button look="secondary" label="Cancel" @click=${this.#cancelConsent}></uui-button>
                </div>`
        }
      </div>
    `
  }

  #empty() {
    return html`
      <uui-box headline="No extensions published yet">
        <p>Nothing on npm carries the <code>${this._keyword}</code> keyword yet.</p>
      </uui-box>
    `
  }

  render() {
    if (this._loading && this._items.length === 0)
      return html`<div id="loader"><uui-loader></uui-loader></div>`

    return html`
      <div id="head">
        <uui-input
          type="search"
          label="Search extensions"
          placeholder="Search npm for extensions"
          @change=${this.#search}></uui-input>
        ${
          this._url
            ? html`<a href=${this._url} target="_blank" rel="noopener">Browse on npm</a>`
            : nothing
        }
      </div>
      ${this._error ? html`<uui-box headline="The registry could not be reached"><p>${this._error}</p></uui-box>` : nothing}
      ${this._notice ? html`<div id="notice">${this._notice}</div>` : nothing}
      ${
        this._installs
          ? nothing
          : this._elsewhere
            ? html`<div id="notice">${this._elsewhere.message} ${this.#elsewhereLink()}</div>`
            : html`<div id="notice">Extensions are added to this site by a deploy, so that every server has them: add one to the site's <code>package.json</code> and deploy it.</div>`
      }
      ${
        this._items.length === 0 && !this._error
          ? this.#empty()
          : html`
            <div id="list">
              ${repeat(
                this._items,
                (item) => item.name,
                (item) => html`
                  <uui-box>
                    <div slot="headline">${item.name} <small>${item.version}</small></div>
                    <p>${item.description || 'No description.'}</p>
                    <p class="carries">${carriesTags(item.carries)}</p>
                    <p class="meta">
                      ${item.publisher ? html`<span>by ${item.publisher}</span>` : nothing}
                      <a href=${item.links.npm} target="_blank" rel="noopener">npm</a>
                      ${
                        item.links.repository
                          ? html`<a href=${item.links.repository} target="_blank" rel="noopener">source</a>`
                          : nothing
                      }
                    </p>
                    ${this.#contentChoice(item)}
                    ${
                      item.installedVersion
                        ? html`<uui-tag look="positive">Installed ${item.installedVersion}</uui-tag>`
                        : !this._installs
                          ? this._elsewhere
                            ? html`<p class="meta">${this.#elsewhereLink() || this._elsewhere.message}</p>`
                            : html`<p class="meta">Add it to the site with <code>bun add ${item.name}</code>, then deploy.</p>`
                          : !this._isAdmin
                            ? html`<p class="meta">An administrator can install this.</p>`
                            : this._consenting === item.name
                              ? this.#consent(item)
                              : this._reviewing === item.name
                                ? this.#review(item)
                                : html`
                          <uui-button
                            look="primary"
                            label="Install"
                            .state=${this._busy === item.name ? 'waiting' : undefined}
                            @click=${() => this.#requestInstall(item)}></uui-button>
                        `
                    }
                  </uui-box>
                `,
              )}
            </div>
          `
      }
    `
  }

  static styles = [
    signatureStyles,
    levelStyles,
    css`
    :host {
      display: block;
      padding: var(--uui-size-layout-1, 24px);
    }
    #loader {
      display: flex;
      justify-content: center;
      padding: var(--uui-size-layout-3, 48px);
    }
    #head {
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-4, 12px);
      margin-bottom: var(--uui-size-space-5, 18px);
    }
    #head uui-input {
      flex: 1;
    }
    #notice {
      margin-bottom: var(--uui-size-space-4, 12px);
      padding: var(--uui-size-space-4, 12px);
      border-left: 3px solid var(--uui-color-positive, #2bc37c);
      background: var(--uui-color-surface-alt, #f3f3f5);
    }
    #list {
      display: grid;
      gap: var(--uui-size-space-5, 18px);
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    }
    p {
      max-width: 60ch;
      line-height: 1.5;
    }
    .meta {
      display: flex;
      gap: var(--uui-size-space-4, 12px);
      font-size: 0.9em;
      opacity: 0.8;
    }
    small {
      opacity: 0.7;
      font-weight: normal;
    }
    .carries {
      display: flex;
      gap: var(--uui-size-space-2, 6px);
    }
    uui-toggle {
      display: block;
      margin-bottom: var(--uui-size-space-4, 12px);
    }
    .consent {
      padding: var(--uui-size-space-4, 12px);
      border-left: 3px solid var(--uui-color-warning, #f0ac00);
      background: var(--uui-color-surface-alt, #f3f3f5);
    }
    .consent .reason {
      display: block;
      color: var(--uui-color-text-alt);
    }
    .consent .asks {
      margin: 0 0 var(--uui-size-space-3, 9px);
      padding-left: 1.25em;
    }
    .consent .actions,
    .actions {
      display: flex;
      gap: var(--uui-size-space-3, 9px);
      margin-top: var(--uui-size-space-4, 12px);
    }
  `,
  ]
}

customElements.define('crombolo-bundles-marketplace', CromboloBundlesMarketplaceElement)
