/**
 * The sidebar at Workspaces: Shared, then every workspace the person can see, the one
 * this tab is in marked, and the ones merged lately below. Choosing a row shows that
 * workspace beside the list; the tab moves only when asked there.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { colourOf, workspaceRows, workspacesApi } from './workspace-client.js'
import { here, newWorkspace } from './workspace-switch.js'
import { chosenWorkspace, showWorkspace, watchWorkspaces } from './workspaces-state.js'

const day = (iso) => {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString()
}

export default class CromboloWorkspacesListElement extends UmbLitElement {
  static properties = {
    _ready: { state: true },
    _chosen: { state: true },
  }

  #mine = { enabled: false, required: false }
  #workspaces = []
  #merged = []
  #stop

  constructor() {
    super()
    this._ready = false
    this._chosen = chosenWorkspace()
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
      ${workspaceRows({ current, workspaces: this.#workspaces }).map(
        (row) =>
          html`<button
            type="button"
            class="row"
            aria-current=${row.key === this._chosen ? 'true' : 'false'}
            @click=${() => showWorkspace(row.key)}
          >
            <span class="dot" style=${`background:${row.key === 'shared' ? 'transparent' : colourOf(row.key)}`}></span>
            <span class="name">${row.name}</span>
            ${row.here ? html`<span class="here">You are here</span>` : html`<span class="note">${row.note}</span>`}
          </button>`,
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
    .here {
      padding: 1px var(--uui-size-space-3);
      border: 1px solid var(--uui-color-border);
      border-radius: 10px;
      background: var(--uui-color-surface);
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .note {
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
      font-weight: 400;
    }
  `
}

customElements.define('crombolo-workspaces-list', CromboloWorkspacesListElement)
