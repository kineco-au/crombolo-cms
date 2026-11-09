/**
 * The Installed view, in place of Umbraco's.
 *
 * A tab of the Bundles tool in Settings (story 238). Umbraco's view is built around package migrations — it lists installed
 * packages so that pending C# migrations can be run. Nothing carries those here
 * (`docs/bundles.md`), so the view would be a list of nothing with a button
 * that cannot apply.
 *
 * What it lists instead is the site's bundle dependencies, which is what
 * "installed" means here: what each one adds, whether its content has been
 * added to this site, and whether its server features are switched on.
 *
 * Two columns: the bundles on the left, filtered as you type; the one chosen
 * on the right, with its details and the button that uninstalls it.
 */
import { css, html, nothing, repeat } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { carriesTags } from './bundles-carries.js'
import {
  disableBundle,
  enableBundle,
  grantBundle,
  listInstalled,
  saveSettings,
  uninstallBundle,
} from './bundles-client.js'
import { signatureBlock, signatureStyles, signatureWords } from './bundles-signature.js'

/** Where each part of a bundle stands on this site, in the words of someone running it. */
function status(item) {
  const parts = []
  if (item.carries?.content)
    parts.push(
      item.contentApplied
        ? html`<span>Content added (${item.contentApplied})</span>`
        : html`<span>Content not added yet</span>`,
    )
  // Story 309: it runs on its grant. Story 311: and only once it has started.
  if (item.couldNotStart) parts.push(html`<span>Could not start</span>`)
  else if (item.status === 'waiting') parts.push(html`<span>Waiting for a grant</span>`)
  else if (item.status === 'not-granted') parts.push(html`<span>Not granted</span>`)
  else if (item.carries?.server)
    parts.push(
      !item.on
        ? html`<span>Server features turned off by ${item.disabledBy ?? 'an administrator'}</span>`
        : item.wired
          ? html`<span>Server features on</span>`
          : html`<span>Server features off until the site's configuration includes it</span>`,
    )
  return parts.length > 0 ? parts : html`<span>Ready</span>`
}

export default class CromboloBundlesInstalledElement extends UmbLitElement {
  static properties = {
    _items: { state: true },
    _loading: { state: true },
    _busy: { state: true },
    _notice: { state: true },
    _installs: { state: true },
    _restartPending: { state: true },
    _filter: { state: true },
    _selected: { state: true },
    _policy: { state: true },
    _actAs: { state: true },
    _edits: { state: true },
  }

  constructor() {
    super()
    this._items = []
    this._loading = true
    this._busy = ''
    this._notice = ''
    this._installs = true
    this._restartPending = false
    this._filter = ''
    this._actAs = 'installer'
    this._edits = {}
    // Settings links a bundle's cards here, naming it in `?bundle=`.
    this._selected = new URLSearchParams(window.location.search).get('bundle') ?? ''
  }

  connectedCallback() {
    super.connectedCallback()
    this.#load()
  }

  async #load() {
    this._loading = true
    try {
      const result = await listInstalled()
      this._items = result.items ?? []
      this._installs = result.installs !== false
      this._restartPending = Boolean(result.restartPending)
      this._policy = result.policy
      if (!this._items.some((item) => item.packageName === this._selected))
        this._selected = this._items[0]?.packageName ?? ''
    } catch (error) {
      this._notice = error instanceof Error ? error.message : String(error)
    } finally {
      this._loading = false
    }
  }

  async #uninstall(item) {
    this._busy = item.packageName
    try {
      const outcome = await uninstallBundle(item.packageName)
      this._notice = outcome.message ?? ''
      if (outcome.ok) await this.#load()
    } catch (error) {
      this._notice = error instanceof Error ? error.message : String(error)
    } finally {
      this._busy = ''
    }
  }

  /** Saves the settings changed in its form (story 310). */
  async #saveSettings(item) {
    this._busy = item.packageName
    try {
      const outcome = await saveSettings(item.id, this._edits)
      this._notice = outcome.message ?? ''
      if (outcome.ok) {
        this._edits = {}
        await this.#load()
      }
    } catch (error) {
      this._notice = error instanceof Error ? error.message : String(error)
    } finally {
      this._busy = ''
    }
  }

  #edit(key, value) {
    this._edits = { ...this._edits, [key]: value }
  }

  /** Its settings: the config's locked, the rest edited here (story 310). */
  #settings(item) {
    const settings = item.settings ?? []
    if (settings.length === 0) return nothing
    const field = (setting) => {
      const value = setting.key in this._edits ? this._edits[setting.key] : setting.value
      if (setting.type === 'boolean')
        return html`<uui-toggle
          label=${setting.label}
          ?disabled=${setting.locked}
          .checked=${value === true}
          @change=${(event) => this.#edit(setting.key, event.target.checked)}></uui-toggle>`
      if (setting.type === 'choice')
        return html`<uui-select
          label=${setting.label}
          ?disabled=${setting.locked}
          .options=${setting.values.map((choice) => ({ name: choice, value: choice, selected: choice === value }))}
          @change=${(event) => this.#edit(setting.key, event.target.value)}></uui-select>`
      return html`<uui-input
        label=${setting.label}
        type=${setting.secret ? 'password' : setting.type === 'number' ? 'number' : 'text'}
        ?disabled=${setting.locked}
        .value=${value ?? ''}
        @change=${(event) =>
          this.#edit(
            setting.key,
            setting.type === 'number' ? Number(event.target.value) : event.target.value,
          )}></uui-input>`
    }
    return html`
      <h4>Settings</h4>
      ${settings.map(
        (setting) => html`<div class="setting">
          <span>${setting.label}</span>
          ${field(setting)}
          ${setting.locked ? html`<span class="note">Set in the site's configuration.</span>` : nothing}
        </div>`,
      )}
      <uui-button
        look="primary"
        label="Save settings"
        ?disabled=${Object.keys(this._edits).length === 0}
        .state=${this._busy === item.packageName ? 'waiting' : undefined}
        @click=${() => this.#saveSettings(item)}></uui-button>
    `
  }

  /** Grants what its installed version asks for (story 309). */
  async #grant(item) {
    this._busy = item.packageName
    try {
      const outcome = await grantBundle(
        item.id,
        (item.permissions ?? []).map((ask) => ask.permission),
        item.asksActAs ? this._actAs : undefined,
      )
      this._notice = outcome.message ?? ''
      if (outcome.ok) await this.#load()
    } catch (error) {
      this._notice = error instanceof Error ? error.message : String(error)
    } finally {
      this._busy = ''
    }
  }

  /** Turns its server features off, or back on (story 225). */
  async #setEnabled(item, enabled) {
    this._busy = item.packageName
    try {
      const outcome = enabled ? await enableBundle(item.id) : await disableBundle(item.id)
      this._notice = outcome.message ?? ''
      if (outcome.ok) await this.#load()
    } catch (error) {
      this._notice = error instanceof Error ? error.message : String(error)
    } finally {
      this._busy = ''
    }
  }

  /** What it may do with the site, who approved it, and the button that turns it off or on. */
  #permissions(item) {
    const asks = item.permissions ?? []
    const approved = item.granted
      ? item.granted.by === "the site's code"
        ? `Developer installed, on ${new Date(item.granted.at).toLocaleDateString()}.`
        : `Approved by ${item.granted.by ?? 'an administrator'} on ${new Date(item.granted.at).toLocaleDateString()}.`
      : ''
    return html`
      <h4>What it may do</h4>
      ${
        asks.length === 0
          ? html`<p>Nothing beyond its own data: it asks for no access to the site's content, members or settings.</p>`
          : html`<ul class="asks">
              ${asks.map(
                (ask) =>
                  html`<li>
                    ${ask.allows}${ask.origins?.length ? html`: ${ask.origins.join(', ')}` : nothing}
                    ${ask.reason ? html`<span class="reason">${ask.reason}</span>` : nothing}
                  </li>`,
              )}
            </ul>`
      }
      ${
        item.schema3
          ? html`<p class="note">
              It asks for these without saying why: it was written before extensions gave a
              reason for each. A new install of a version like it is refused.
            </p>`
          : nothing
      }
      ${
        item.couldNotStart
          ? html`<p class="note">It is granted, but could not start: ${item.couldNotStart}</p>`
          : nothing
      }
      ${
        item.status === 'waiting' || item.status === 'not-granted'
          ? html`<p class="note">
                ${
                  item.status === 'waiting'
                    ? html`Waiting for a grant: it now asks for ${item.missing.join(', ')}, which was not granted.`
                    : 'Not granted: it does nothing until it is granted what it asks for.'
                }
              </p>
              ${
                item.asksActAs
                  ? html`<uui-select
                      label="Acts for"
                      .options=${[
                        { name: 'You', value: 'installer', selected: this._actAs === 'installer' },
                        {
                          name: 'Whoever uses it',
                          value: 'caller',
                          selected: this._actAs === 'caller',
                        },
                      ]}
                      @change=${(event) => {
                        this._actAs = event.target.value
                      }}></uui-select>`
                  : nothing
              }
              <uui-button
                look="primary"
                label="Grant"
                .state=${this._busy === item.packageName ? 'waiting' : undefined}
                @click=${() => this.#grant(item)}></uui-button>`
          : item.on
            ? html`${approved ? html`<p class="note">${approved}</p>` : nothing}
              <uui-button
                look="secondary"
                color="danger"
                label="Disable"
                .state=${this._busy === item.packageName ? 'waiting' : undefined}
                @click=${() => this.#setEnabled(item, false)}></uui-button>`
            : html`<p class="note">
                Turned off by ${item.disabledBy ?? 'an administrator'}: its pages, jobs and screens
                stay off, through updates, until it is enabled again.
              </p>
              <uui-button
                look="primary"
                label="Enable"
                .state=${this._busy === item.packageName ? 'waiting' : undefined}
                @click=${() => this.#setEnabled(item, true)}></uui-button>`
      }
    `
  }

  #pick(item) {
    this._selected = item.packageName
    this.requestUpdate()
  }

  get #shown() {
    const words = this._filter.trim().toLowerCase()
    if (!words) return this._items
    return this._items.filter((item) =>
      [item.name, item.packageName, item.description].some((text) =>
        text?.toLowerCase().includes(words),
      ),
    )
  }

  render() {
    if (this._loading) return html`<div id="loader"><uui-loader></uui-loader></div>`
    if (this._items.length === 0)
      return html`
        ${this._notice ? html`<div id="notice">${this._notice}</div>` : nothing}
        <uui-box headline="No bundles installed">
          <p>Install one from the Marketplace tab, and it appears here.</p>
        </uui-box>
      `
    const selected = this._items.find((item) => item.packageName === this._selected)
    const shown = this.#shown
    return html`
      ${this._notice ? html`<div id="notice">${this._notice}</div>` : nothing}
      ${
        this._restartPending
          ? html`<div id="restart">Installed changes take effect when the site restarts.</div>`
          : nothing
      }
      <div id="columns">
        <uui-box headline="Installed bundles" style="--uui-box-default-padding:0;">
          <div id="filter">
            <uui-input
              label="Filter"
              placeholder="Filter"
              .value=${this._filter}
              @input=${(event) => {
                this._filter = event.target.value
              }}>
              <uui-icon name="icon-search" slot="prepend"></uui-icon>
            </uui-input>
          </div>
          ${
            shown.length === 0
              ? html`<p class="empty">No bundle matches.</p>`
              : html`<uui-ref-list>
                  ${repeat(
                    shown,
                    (item) => item.packageName,
                    (item) => html`<uui-ref-node
                      name=${item.name}
                      detail=${`${item.packageName} ${item.version} · ${this.#words(item).label}`}
                      selectable
                      select-only
                      ?selected=${item.packageName === this._selected}
                      @selected=${() => this.#pick(item)}
                      @deselected=${() => this.#pick(item)}
                      @open=${() => this.#pick(item)}></uui-ref-node>`,
                  )}
                </uui-ref-list>`
          }
        </uui-box>
        ${selected ? this.#details(selected) : nothing}
      </div>
    `
  }

  /** Signed or not (story 060); an unsigned one under a site that wants signatures says so. */
  #words(item) {
    const unsignedRefused =
      item.provenance?.state === 'unsigned' && this._policy?.signatures === 'required'
    return signatureWords(item.provenance, unsignedRefused ? 'unsigned' : null, this._policy)
  }

  #details(item) {
    return html`<uui-box headline=${item.name}>
      ${item.description ? html`<p>${item.description}</p>` : nothing}
      <dl>
        <dt>npm package</dt>
        <dd><code>${item.packageName}</code></dd>
        <dt>Version</dt>
        <dd>${item.version}</dd>
        <dt>Adds</dt>
        <dd class="carries">${carriesTags(item.carries)}</dd>
        <dt>On this site</dt>
        <dd class="status">${status(item)}</dd>
        <dt>Works with</dt>
        <dd>Crombolo ${item.peerRange}</dd>
        <dt>Signature</dt>
        <dd>${signatureBlock(this.#words(item))}</dd>
      </dl>
      ${this.#permissions(item)}
      ${this.#settings(item)}
      ${
        this._installs
          ? html`<uui-button
              look="primary"
              color="danger"
              label="Uninstall"
              .state=${this._busy === item.packageName ? 'waiting' : undefined}
              @click=${() => this.#uninstall(item)}></uui-button>`
          : html`<p class="note">This site adds and removes bundles with a deploy, so every server has the same ones.</p>`
      }
    </uui-box>`
  }

  static styles = [
    signatureStyles,
    css`
    .asks {
      padding-left: 1.25em;
    }
    .setting {
      display: grid;
      gap: var(--uui-size-space-1);
      margin-bottom: var(--uui-size-space-3);
    }
    .asks .reason {
      display: block;
      color: var(--uui-color-text-alt);
    }
    :host {
      display: block;
      padding: var(--uui-size-layout-1, 24px);
    }
    #loader {
      display: flex;
      justify-content: center;
      padding: var(--uui-size-layout-3, 48px);
    }
    #notice {
      margin-bottom: var(--uui-size-space-4, 12px);
      padding: var(--uui-size-space-4, 12px);
      border-left: 3px solid var(--uui-color-positive, #2bc37c);
      background: var(--uui-color-surface-alt, #f3f3f5);
    }
    #restart {
      margin-bottom: var(--uui-size-space-4, 12px);
      padding: var(--uui-size-space-4, 12px);
      border-left: 3px solid var(--uui-color-warning, #f0ac00);
      background: var(--uui-color-surface-alt, #f3f3f5);
    }
    #columns {
      display: grid;
      grid-template-columns: minmax(240px, 1fr) 2fr;
      gap: var(--uui-size-layout-1, 24px);
      align-items: start;
    }
    @media (max-width: 800px) {
      #columns {
        grid-template-columns: 1fr;
      }
    }
    #filter {
      padding: var(--uui-size-space-4, 12px);
    }
    #filter uui-input {
      width: 100%;
    }
    .empty {
      padding: 0 var(--uui-size-space-4, 12px) var(--uui-size-space-4, 12px);
    }
    p {
      max-width: 60ch;
      line-height: 1.5;
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--uui-size-space-3, 9px) var(--uui-size-space-5, 18px);
      margin: 0 0 var(--uui-size-space-5, 18px);
    }
    dt {
      font-weight: 700;
    }
    dd {
      margin: 0;
    }
    .carries {
      display: flex;
      gap: var(--uui-size-space-2, 6px);
    }
    .status span {
      display: block;
    }
    .note {
      opacity: 0.8;
      font-size: 0.9em;
    }
  `,
  ]
}

customElements.define('crombolo-bundles-installed', CromboloBundlesInstalledElement)
