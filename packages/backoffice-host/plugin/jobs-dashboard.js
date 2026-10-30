/**
 * The Background jobs dashboard in Settings (story 187): the site's and its
 * bundles' jobs, newest first, filtered by state, each with how far it got and
 * why it failed, and a failed one run again by hand.
 */
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'

const PAGE_SIZE = 50

const STATES = [
  ['', 'Everything'],
  ['queued', 'Waiting'],
  ['running', 'Running'],
  ['failed', 'Failed'],
  ['succeeded', 'Done'],
]

const STATE_LABELS = { queued: 'Waiting', running: 'Running', failed: 'Failed', succeeded: 'Done' }

function apiBase() {
  const base = document.querySelector('base')?.getAttribute('href') ?? '/umbraco/'
  return `${base.replace(/\/$/, '')}/crombolo/api/jobs`
}

async function call(path, init, params) {
  const query = params ? `?${new URLSearchParams(params)}` : ''
  const response = await fetch(`${apiBase()}${path}${query}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
    ...init,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok && response.status !== 409)
    throw new Error(`The background jobs could not be read (${response.status}).`)
  return body
}

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—')
const owner = (job) => (job.owner === 'site' ? 'The site' : job.owner)

function progressOf(job) {
  const p = job.progress
  if (!p) return '—'
  const count = p.total ? `${p.done} of ${p.total}` : `${p.done}`
  return p.note ? `${count}: ${p.note}` : count
}

export default class CromboloJobsDashboardElement extends LitElement {
  static properties = {
    _items: { state: true },
    _total: { state: true },
    _state: { state: true },
    _skip: { state: true },
    _loading: { state: true },
    _notice: { state: true },
    _busy: { state: true },
    _waiting: { state: true },
  }

  constructor() {
    super()
    this._items = []
    this._total = 0
    this._state = ''
    this._skip = 0
    this._loading = true
    this._notice = ''
    this._busy = ''
    this._waiting = false
  }

  connectedCallback() {
    super.connectedCallback()
    this.#load()
  }

  async #load() {
    this._loading = true
    try {
      const params = { skip: String(this._skip), take: String(PAGE_SIZE) }
      if (this._state) params.state = this._state
      const result = await call('', undefined, params)
      this._items = result.items ?? []
      this._total = result.total ?? 0
      this._waiting = Boolean(result.waitingSince)
    } catch (error) {
      this._notice = error instanceof Error ? error.message : String(error)
    } finally {
      this._loading = false
    }
  }

  async #retry(job) {
    this._busy = job.id
    try {
      const outcome = await call(`/${job.id}/retry`, { method: 'POST' })
      this._notice = outcome.message ?? ''
      await this.#load()
    } catch (error) {
      this._notice = error instanceof Error ? error.message : String(error)
    } finally {
      this._busy = ''
    }
  }

  #filter(state) {
    this._state = state
    this._skip = 0
    this.#load()
  }

  #page(by) {
    this._skip = Math.max(0, this._skip + by)
    this.#load()
  }

  render() {
    return html`
      <p class="intro">
        Work the site and its bundles run in the background: imports, exports, scheduled tasks.
        A job that fails is tried again a few times, then waits here to be run again.
      </p>
      ${
        this._waiting
          ? html`<div class="waiting" role="alert">
              Background work is waiting: nothing is running it. Queued jobs, scheduled
              publishing and notifications will go out once the site's background worker is
              running again.
            </div>`
          : nothing
      }
      ${this._notice ? html`<div class="notice" role="status">${this._notice}</div>` : nothing}
      <div class="filters">
        <uui-select
          label="State"
          .options=${STATES.map(([value, name]) => ({ value, name, selected: value === this._state }))}
          @change=${(event) => this.#filter(event.target.value)}></uui-select>
      </div>
      ${
        this._loading
          ? html`<uui-loader></uui-loader>`
          : this._items.length === 0
            ? html`<uui-box><p>No background jobs${this._state ? ' in this state' : ''}.</p></uui-box>`
            : html`<uui-table aria-label="Background jobs">
                <uui-table-head>
                  <uui-table-head-cell>Job</uui-table-head-cell>
                  <uui-table-head-cell>From</uui-table-head-cell>
                  <uui-table-head-cell>State</uui-table-head-cell>
                  <uui-table-head-cell>Progress</uui-table-head-cell>
                  <uui-table-head-cell>Queued</uui-table-head-cell>
                  <uui-table-head-cell></uui-table-head-cell>
                </uui-table-head>
                ${this._items.map(
                  (job) => html`<uui-table-row>
                    <uui-table-cell>
                      <strong>${job.name}</strong>
                      ${job.error ? html`<div class="error">${job.error}</div>` : nothing}
                    </uui-table-cell>
                    <uui-table-cell>${owner(job)}</uui-table-cell>
                    <uui-table-cell>
                      ${STATE_LABELS[job.state] ?? job.state}
                      <div class="meta">tried ${job.attempts} of ${job.maxAttempts}</div>
                    </uui-table-cell>
                    <uui-table-cell>${progressOf(job)}</uui-table-cell>
                    <uui-table-cell>
                      ${when(job.createdAt)}
                      ${job.queuedBy ? html`<div class="meta">by ${job.queuedBy}</div>` : nothing}
                    </uui-table-cell>
                    <uui-table-cell>
                      ${
                        job.state === 'failed'
                          ? html`<uui-button
                              look="secondary"
                              label="Run again"
                              .state=${this._busy === job.id ? 'waiting' : undefined}
                              @click=${() => this.#retry(job)}></uui-button>`
                          : nothing
                      }
                    </uui-table-cell>
                  </uui-table-row>`,
                )}
              </uui-table>
              <div class="pages">
                <uui-button
                  label="Newer"
                  ?disabled=${this._skip === 0}
                  @click=${() => this.#page(-PAGE_SIZE)}></uui-button>
                <span>${this._skip + 1}–${Math.min(this._skip + PAGE_SIZE, this._total)} of ${this._total}</span>
                <uui-button
                  label="Older"
                  ?disabled=${this._skip + PAGE_SIZE >= this._total}
                  @click=${() => this.#page(PAGE_SIZE)}></uui-button>
              </div>`
      }
    `
  }

  static styles = css`
    :host {
      display: block;
      padding: var(--uui-size-layout-1);
    }
    .intro {
      margin-top: 0;
      color: var(--uui-color-text-alt);
    }
    .filters {
      margin-bottom: var(--uui-size-space-4);
    }
    .notice {
      margin-bottom: var(--uui-size-space-4);
    }
    .waiting {
      margin-bottom: var(--uui-size-space-4);
      padding: var(--uui-size-space-4);
      border-left: 4px solid var(--uui-color-warning);
      background: var(--uui-color-warning-standalone, var(--uui-color-surface-alt));
      color: var(--uui-color-warning-contrast, inherit);
    }
    .error {
      color: var(--uui-color-danger);
      font-size: 0.9em;
      white-space: pre-wrap;
    }
    .meta {
      color: var(--uui-color-text-alt);
      font-size: 0.85em;
    }
    .pages {
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-4);
      margin-top: var(--uui-size-space-4);
    }
  `
}

customElements.define('crombolo-jobs-dashboard', CromboloJobsDashboardElement)
