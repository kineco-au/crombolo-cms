/**
 * The sidebar at Workspaces: Shared, set apart, then every workspace the person can see,
 * each name on its colour, a green dot by the one this tab is in, and the ones merged
 * lately below. A filter shows the person's own (Mine: theirs, or shared with them) or
 * All they can see, Mine at first, the choice kept in this browser; a box finds them by
 * any part of their name, and they are shown ten at a time, Shared always first. Each has
 * a switch that moves this tab into it, off for the one the tab is in and for one the
 * person may only look at. Choosing a row shows that
 * workspace beside the list; the tab moves only when asked there.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import {
  chooseWorkspace,
  colourOf,
  filtered,
  inkOn,
  named,
  pageOf,
  workspaceRows,
  workspacesApi,
} from './workspace-client.js'
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
    _query: { state: true },
    _page: { state: true },
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
    this._query = ''
    this._page = 1
  }

  #setFilter(filter) {
    this._filter = filter
    this._page = 1
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

  /** Moves this tab into a workspace, or Shared, and shows the screen there again. */
  #switchTo(row) {
    if (row.key === 'shared')
      chooseWorkspace(this.#mine.required ? { key: 'shared', name: 'Shared' } : null)
    else chooseWorkspace({ key: row.key, name: row.name })
    location.reload()
  }

  #row(row) {
    const workspace = this.#workspaces.find((w) => w.key === row.key)
    const mayEnter = row.key === 'shared' || workspace?.member === true
    const why = row.here
      ? 'This tab is in it'
      : mayEnter
        ? `Switch to ${row.name}`
        : 'You may look at it, not work in it'
    return html`<div class="row" aria-current=${row.key === this._chosen ? 'true' : 'false'}>
      <button type="button" class="pick" @click=${() => showWorkspace(row.key)}>
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
      <button
        type="button"
        class="switch"
        aria-label=${`Switch to ${row.name}`}
        title=${why}
        ?disabled=${row.here || !mayEnter}
        @click=${() => this.#switchTo(row)}
      >
        <uui-icon name="icon-enter"></uui-icon>
      </button>
    </div>`
  }

  render() {
    if (!this._ready || !this.#mine.enabled) return nothing
    const current = here(this.#mine)
    const [shared, ...rows] = workspaceRows({
      current,
      workspaces: named(filtered(this.#workspaces, this._filter), this._query),
    })
    const shown = pageOf(rows, this._page)
    return html`<nav aria-label="Workspaces">
      <div class="head">
        <span>Workspaces</span>
        <uui-button compact look="outline" label="New workspace" title="New workspace" @click=${() => newWorkspace()}>
          <uui-icon name="icon-add"></uui-icon>
        </uui-button>
      </div>
      ${this.#row(shared)}
      <hr class="apart" />
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
      <input
        class="find"
        type="search"
        placeholder="Find a workspace"
        aria-label="Find a workspace by name"
        .value=${this._query}
        @input=${(event) => {
          this._query = event.currentTarget.value
          this._page = 1
        }}
      />
      ${
        shown.total === 0
          ? html`<p class="none">${this._query.trim() ? 'No workspace has that in its name.' : 'None yet.'}</p>`
          : shown.items.map((row) => this.#row(row))
      }
      ${
        shown.pages > 1
          ? html`<div class="pager" aria-label="Pages">
              <button
                type="button"
                aria-label="Previous page"
                ?disabled=${shown.page === 1}
                @click=${() => {
                  this._page = shown.page - 1
                }}
              >‹</button>
              <span>${shown.from}–${shown.to} of ${shown.total}</span>
              <button
                type="button"
                aria-label="Next page"
                ?disabled=${shown.page === shown.pages}
                @click=${() => {
                  this._page = shown.page + 1
                }}
              >›</button>
            </div>`
          : nothing
      }
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
    .find {
      margin: 0 var(--uui-size-space-3) var(--uui-size-space-3);
      padding: var(--uui-size-space-2) var(--uui-size-space-3);
      border: 1px solid var(--uui-color-border-standalone, var(--uui-color-border));
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface);
      color: var(--uui-color-text);
      font: inherit;
    }
    .none {
      margin: 0 var(--uui-size-space-3);
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
    }
    .pager {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: var(--uui-size-space-3) var(--uui-size-space-3) 0;
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
    }
    .pager button {
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface);
      color: var(--uui-color-text);
      font: inherit;
      line-height: 1;
      padding: 4px 10px;
      cursor: pointer;
    }
    .pager button:disabled {
      opacity: 0.4;
      cursor: default;
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
    .row:has(> .pick) {
      gap: var(--uui-size-space-1);
      padding: 0 var(--uui-size-space-1) 0 0;
      cursor: default;
    }
    .pick {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-3);
      padding: var(--uui-size-space-3);
      border: none;
      background: none;
      font: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .switch {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: 1px solid transparent;
      border-radius: var(--uui-border-radius);
      background: none;
      color: var(--uui-color-interactive, var(--uui-color-text));
      cursor: pointer;
    }
    .switch:hover:not(:disabled) {
      border-color: var(--uui-color-border);
      background: var(--uui-color-surface);
    }
    .switch:disabled {
      opacity: 0.35;
      cursor: default;
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
