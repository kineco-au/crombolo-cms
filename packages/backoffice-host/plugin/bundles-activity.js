/**
 * What one extension did (story 327), opened from Installed: its counts by kind
 * at the top, then everything it did, newest first, filterable by kind and by
 * the person it acted for, with what its grant refused, and an export.
 */
import { css, html, nothing, repeat } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { activitySentence, countsLine, personWords } from './bundles-activity-words.js'
import { activityCsvUrl, activityPage, activitySummary } from './bundles-client.js'
import { downloadFile } from './download.js'

const KINDS = [
  ['', 'Everything'],
  ['write', 'Changes'],
  ['read', 'Reads'],
  ['request', 'Requests out'],
  ['rows', 'Its own data'],
  ['call', 'Calls'],
  ['screen', 'Screens'],
  ['refused', 'Refused'],
]

export class CromboloBundlesActivityElement extends UmbLitElement {
  static properties = {
    extension: { attribute: false },
    _summary: { state: true },
    _rows: { state: true },
    _next: { state: true },
    _kind: { state: true },
    _person: { state: true },
    _problem: { state: true },
  }

  constructor() {
    super()
    this._rows = []
    this._next = null
    this._kind = ''
    this._person = ''
    this._problem = ''
  }

  connectedCallback() {
    super.connectedCallback()
    this.#load()
  }

  get #filters() {
    return { kind: this._kind || undefined, person: this._person || undefined }
  }

  async #load() {
    try {
      this._summary = await activitySummary(this.extension.id)
      const page = await activityPage(this.extension.id, this.#filters)
      this._rows = page.items ?? []
      this._next = page.next ?? null
      this._problem = ''
    } catch (error) {
      this._problem = error instanceof Error ? error.message : String(error)
    }
  }

  async #more() {
    const page = await activityPage(this.extension.id, { ...this.#filters, before: this._next })
    this._rows = [...this._rows, ...(page.items ?? [])]
    this._next = page.next ?? null
  }

  async #export() {
    try {
      await downloadFile(
        activityCsvUrl(this.extension.id, this.#filters),
        `${this.extension.id}-activity.csv`,
      )
    } catch (error) {
      this._problem = error instanceof Error ? error.message : String(error)
    }
  }

  render() {
    const people = this._summary?.people ?? []
    return html`<uui-box headline=${`What ${this.extension.name} did`}>
      <p class="counts">
        ${countsLine(this._summary?.counts)}
        <span class="window">in the last ${this._summary?.days ?? 14} days</span>
      </p>
      <div class="filters">
        <uui-select
          label="Kind"
          .options=${KINDS.map(([value, name]) => ({ value, name, selected: value === this._kind }))}
          @change=${(event) => {
            this._kind = event.target.value
            this.#load()
          }}></uui-select>
        <uui-select
          label="Person"
          .options=${[
            { value: '', name: 'Anyone', selected: !this._person },
            { value: 'itself', name: 'Itself', selected: this._person === 'itself' },
            ...people.map((person) => ({
              value: person.key,
              name: person.name,
              selected: person.key === this._person,
            })),
          ]}
          @change=${(event) => {
            this._person = event.target.value
            this.#load()
          }}></uui-select>
        <uui-button look="secondary" label="Export" @click=${() => this.#export()}></uui-button>
      </div>
      ${this._problem ? html`<p class="problem">${this._problem}</p>` : nothing}
      ${
        this._rows.length === 0
          ? html`<p>Nothing recorded.</p>`
          : html`<uui-table>
              <uui-table-head>
                <uui-table-head-cell>When</uui-table-head-cell>
                <uui-table-head-cell>For</uui-table-head-cell>
                <uui-table-head-cell>What it did</uui-table-head-cell>
              </uui-table-head>
              ${repeat(
                this._rows,
                (row) => row.id,
                (row) => html`<uui-table-row class=${row.kind === 'refused' ? 'refused' : ''}>
                  <uui-table-cell>${new Date(row.occurredAt).toLocaleString()}</uui-table-cell>
                  <uui-table-cell>${personWords(row)}</uui-table-cell>
                  <uui-table-cell>${activitySentence(row)}</uui-table-cell>
                </uui-table-row>`,
              )}
            </uui-table>`
      }
      ${
        this._next !== null
          ? html`<uui-button look="secondary" label="Load more" @click=${() => this.#more()}></uui-button>`
          : nothing
      }
      <uui-button
        look="secondary"
        label="Back"
        @click=${() => this.dispatchEvent(new CustomEvent('close'))}></uui-button>
    </uui-box>`
  }

  static styles = css`
    .counts {
      font-weight: bold;
    }
    .window {
      font-weight: normal;
      color: var(--uui-color-text-alt);
      margin-left: var(--uui-size-space-2);
    }
    .filters {
      display: flex;
      gap: var(--uui-size-space-3);
      align-items: center;
      margin-bottom: var(--uui-size-space-4);
    }
    .refused {
      color: var(--uui-color-danger-standalone, var(--uui-color-danger));
    }
    .problem {
      color: var(--uui-color-danger-standalone, var(--uui-color-danger));
    }
  `
}

if (!customElements.get('crombolo-bundles-activity'))
  customElements.define('crombolo-bundles-activity', CromboloBundlesActivityElement)
