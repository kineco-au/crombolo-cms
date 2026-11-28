/**
 * The sidebar at Workspaces: Shared, set apart, then every workspace the person can see,
 * each name on its colour, a green dot by the one this tab is in, and the ones merged
 * lately below. A filter shows the person's own (Mine: theirs, or shared with them) or
 * All they can see, Mine at first, the choice kept in this browser. Choosing a row shows that
 * workspace beside the list; the tab moves only when asked there.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { colourOf, filtered, inkOn, workspaceRows, workspacesApi } from './workspace-client.js'
import { here, newWorkspace } from './workspace-switch.js'
import { chosenWorkspace, showWorkspace, watchWorkspaces } from './workspaces-state.js'

const FILTER_KEY = 'crombolo.workspaces.filter'

/** The list's filter as this browser last left it: Mine unless All was chosen. */
const readFilter = () => {
  try {
    return localStorage.getItem(FILTER_KEY) === 'all' ? 'all' : 'mine'
  } catch {
    return 'mine'
  }
}

const day = (iso) => {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString()
}

export default class CromboloWorkspacesListElement extends UmbLitElement {
  static properties = {
    _ready: { state: true },
    _chosen: { state: true },
    _filter: { state: true },
  }

  #mine = { enabled: false, required: false }
  #workspaces = []
  #merged = []
  #stop

  constructor() {
    super()
    this._ready = false
    this._chosen = chosenWorkspace()
    this._filter = readFilter()
  }

  #setFilter(filter) {
    this._filter = filter
    try {
      localStorage.setItem(FILTER_KEY, filter)
    } catch {}
  }

  async connectedCallback() {
    super.connectedCallback()
    this.#stop = watchWorkspaces(async (what) => {
      if (what === 'changed') await this.#list()
      this._chosen = chosenWorkspace()
      this.requestUpdate()
    })
    this.#mine = await workspacesApi.mine().catch(() => this.#mine)
    if (this.#mine.enabled) {
      await this.#list()
      if (chosenWorkspace() === undefined)
        showWorkspace(here(this.#mine)?.key ?? 'shared', 'info', true)
      this.#merged = await this.#mergedLately()
    }
    this._ready = true
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.#stop?.()
  }

  async #list() {
    this.#workspaces = (await workspacesApi.list().catch(() => ({ items: [] }))).items ?? []
  }

  async #mergedLately() {
    const base = (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(
      /\/$/,
      '',
    )
    const response = await fetch(`${base}/crombolo/api/changes?take=20`, {
      credentials: 'include',
    }).catch(() => undefined)
    const changes = response?.ok ? ((await response.json()).items ?? []) : []
    return changes.filter((c) => c.kind === 'merge').slice(0, 8)
  }

  render() {
    if (!this._ready || !this.#mine.enabled) return nothing
    const current = here(this.#mine)
    return html`<nav aria-label="Workspaces">
      <div class="head">
        <span>Workspaces</span>
        <uui-button compact look="outline" label="New workspace" title="New workspace" @click=${() => newWorkspace()}>
          <uui-icon name="icon-add"></uui-icon>
        </uui-button>
      </div>
      <div class="filter" role="group" aria-label="Which workspaces">
        ${[
          ['mine', 'Mine'],
          ['all', 'All'],
        ].map(
          ([value, label]) =>
            html`<button
              type="button"
              aria-pressed=${this._filter === value ? 'true' : 'false'}
              @click=${() => this.#setFilter(value)}
            >${label}</button>`,
        )}
      </div>
      ${workspaceRows({ current, workspaces: filtered(this.#workspaces, this._filter) }).map(
        (row) =>
          html`<button
            type="button"
            class="row"
            aria-current=${row.key === this._chosen ? 'true' : 'false'}
            @click=${() => showWorkspace(row.key)}
          >
            <span
              class=${row.here ? 'here' : 'there'}
              role=${row.here ? 'img' : nothing}
              aria-label=${row.here ? 'You are here' : nothing}
              title=${row.here ? 'You are here' : nothing}
            ></span>
            <span class="name">
              ${
                row.key === 'shared'
                  ? row.name
                  : html`<span
                      class="label"
                      style=${`background:${colourOf(row.key)};color:${inkOn(colourOf(row.key))}`}
                      >${row.name}</span
                    >`
              }
            </span>
            ${row.note ? html`<span class="note">${row.note}</span>` : nothing}
          </button>
          ${row.key === 'shared' ? html`<hr class="apart" />` : nothing}`,
      )}
      ${
        this.#merged.length > 0
          ? html`<div class="head merged"><span>Merged</span></div>
              ${this.#merged.map(
                (c) =>
                  html`<div class="row gone">
                    <span class="dot"></span>
                    <span class="name">${c.name ?? 'A workspace'}</span>
                    <span class="note">${day(c.startedAt)}</span>
                  </div>`,
              )}`
          : nothing
      }
    </nav>`
  }

  static styles = css`
    :host {
      display: block;
    }
    nav {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: var(--uui-size-space-5) var(--uui-size-space-3);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 var(--uui-size-space-3) var(--uui-size-space-3);
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .filter {
      display: inline-flex;
      align-self: start;
      margin: 0 var(--uui-size-space-3) var(--uui-size-space-3);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      overflow: hidden;
    }
    .filter button {
      border: none;
      margin: 0;
      padding: var(--uui-size-space-1) var(--uui-size-space-4);
      background: var(--uui-color-surface);
      color: var(--uui-color-text);
      font: inherit;
      font-size: var(--uui-type-small-size);
      cursor: pointer;
    }
    .filter button[aria-pressed='true'] {
      background: var(--uui-color-selected);
      color: var(--uui-color-selected-contrast);
    }
    .head.merged {
      margin-top: var(--uui-size-space-5);
    }
    .row {
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-3);
      padding: var(--uui-size-space-3);
      border: none;
      border-radius: var(--uui-border-radius);
      background: none;
      font: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .row:hover {
      background: var(--uui-color-surface-emphasis);
    }
    .row[aria-current='true'] {
      background: var(--crombolo-terracotta-tint, var(--uui-color-surface-alt));
      font-weight: 700;
    }
    .row.gone {
      cursor: default;
      color: var(--uui-color-text-alt);
    }
    .row.gone:hover {
      background: none;
    }
    .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dot {
      flex: none;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 1px solid var(--uui-color-border-emphasis, var(--uui-color-border));
      box-sizing: border-box;
    }
    .here,
    .there {
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .here {
      background: var(--uui-color-positive, #2e7d32);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--uui-color-positive, #2e7d32) 25%, transparent);
    }
    .label {
      display: inline-block;
      max-width: 100%;
      padding: 1px var(--uui-size-space-3);
      border-radius: var(--uui-border-radius);
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: middle;
    }
    .apart {
      width: 100%;
      margin: var(--uui-size-space-3) 0;
      border: none;
      border-top: 1px solid var(--uui-color-border);
    }
    .note {
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
      font-weight: 400;
    }
  `
}

customElements.define('crombolo-workspaces-list', CromboloWorkspacesListElement)
