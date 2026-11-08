/**
 * Entries: every form's, under the Forms root of the tree, or one form's, as a tab
 * on that form when `form` is given (story 289).
 *
 * What a person actually does here: read what was submitted, approve or reject
 * it, delete it, and take the lot away as CSV.
 *
 * A sensitive field arrives already redacted — the server withholds it rather
 * than the UI hiding it — so this shows that it is withheld rather than
 * pretending the answer was blank.
 */
import { css, html, nothing, repeat } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { entriesLibraryOptions } from './form-picker-options.js'
import {
  deleteEntry,
  downloadEntriesCsv,
  listEntries,
  listForms,
  listLibraryForms,
  setEntryState,
} from './forms-client.js'

/** The filter's value for every form together. */
const ALL = ''

export default class CromboloFormsEntriesElement extends UmbLitElement {
  static properties = {
    form: { attribute: false },
    _forms: { state: true },
    _selected: { state: true },
    _libraryForms: { state: true },
    _library: { state: true },
    _entries: { state: true },
    _total: { state: true },
    _state: { state: true },
    _language: { state: true },
    _languages: { state: true },
    _search: { state: true },
    _includeSpam: { state: true },
    _notice: { state: true },
  }

  constructor() {
    super()
    this._forms = undefined
    this._selected = ''
    this._libraryForms = []
    this._library = ''
    this._entries = []
    this._total = 0
    this._state = ''
    this._language = ''
    this._languages = []
    this._search = ''
    this._includeSpam = false
    this._notice = ''
  }

  connectedCallback() {
    super.connectedCallback()
    // Only for the filter and the names on entries: a failure leaves both out.
    listLibraryForms().then(
      (items) => {
        this._libraryForms = items
      },
      () => {},
    )
    listForms().then(
      (forms) => {
        this._forms = forms
        this._selected = this.form ?? ALL
        if (forms.length > 0) this.#load()
      },
      (error) => {
        this._forms = []
        this._notice = error.message
      },
    )
  }

  async #load() {
    this._notice = ''
    try {
      const query = {
        state: this._state,
        language: this._language,
        library: this._library,
        search: this._search,
        includeSpam: this._includeSpam ? 'true' : '',
        take: 200,
      }
      const forms = this._selected === ALL ? this._forms : [{ key: this._selected }]
      const pages = await Promise.all(forms.map((form) => listEntries(form.key, query)))
      this._languages = [...new Set(pages.flatMap((page) => page.languages ?? []))]
      this._entries = pages
        .flatMap((page, index) =>
          (page.items ?? []).map((entry) => ({ ...entry, formName: forms[index].name })),
        )
        .sort((a, b) => new Date(b.createDate) - new Date(a.createDate))
      this._total = pages.reduce((total, page) => total + (page.total ?? 0), 0)
    } catch (error) {
      this._entries = []
      this._notice = error.message
    }
  }

  async #setState(entry, state) {
    try {
      const result = await setEntryState(entry.id, state)
      if (!result.ok) this._notice = 'That entry could not be changed.'
      await this.#load()
    } catch (error) {
      this._notice = error.message
    }
  }

  async #remove(entry) {
    if (!confirm('Delete this entry? It cannot be undone.')) return
    try {
      await deleteEntry(entry.id)
      await this.#load()
    } catch (error) {
      this._notice = error.message
    }
  }

  #libraryFilter() {
    const options = entriesLibraryOptions(this._libraryForms, this._selected, this._library)
    if (options.length === 0) return nothing
    return html`<uui-select
      label="Library form"
      .options=${options}
      @change=${(event) => {
        this._library = event.target.value
        this.#load()
      }}
    ></uui-select>`
  }

  #libraryName(key) {
    return this._libraryForms.find((item) => item.key === key)?.name ?? 'A deleted Library form'
  }

  render() {
    if (this._forms === undefined) return html`<uui-loader></uui-loader>`
    if (this._forms.length === 0)
      return html`<uui-box headline="Entries"><p>There are no forms yet.</p></uui-box>`

    return html`
      <uui-box headline="Entries">
        <div class="filters">
          ${
            this.form
              ? nothing
              : html`<uui-select
                  label="Form"
                  .options=${[{ name: 'All forms', key: ALL }, ...this._forms].map((form) => ({
                    name: form.name,
                    value: form.key,
                    selected: form.key === this._selected,
                  }))}
                  @change=${(event) => {
                    this._selected = event.target.value
                    this._library = ''
                    this.#load()
                  }}
                ></uui-select>`
          }
          ${this.#libraryFilter()}
          <uui-select
            label="State"
            .options=${[
              ['', 'Any state'],
              ['submitted', 'Submitted'],
              ['approved', 'Approved'],
              ['rejected', 'Rejected'],
            ].map(([value, name]) => ({ name, value, selected: value === (this._state ?? '') }))}
            @change=${(event) => {
              this._state = event.target.value
              this.#load()
            }}
          ></uui-select>
          ${
            this._languages.length > 1
              ? html`<uui-select
                  label="Language"
                  .options=${[['', 'Any language'], ...this._languages.map((l) => [l, l])].map(
                    ([value, name]) => ({ name, value, selected: value === this._language }),
                  )}
                  @change=${(event) => {
                    this._language = event.target.value
                    this.#load()
                  }}
                ></uui-select>`
              : nothing
          }
          <uui-input
            label="Search the answers"
            placeholder="Search the answers"
            .value=${this._search}
            @change=${(event) => {
              this._search = event.target.value
              this.#load()
            }}
          ></uui-input>
          <uui-toggle
            label="Include spam"
            .checked=${this._includeSpam}
            @change=${(event) => {
              this._includeSpam = event.target.checked
              this.#load()
            }}
          ></uui-toggle>
          ${
            this._selected === ALL
              ? nothing
              : html`<uui-button
                  class="csv"
                  look="secondary"
                  label="Export CSV"
                  @click=${async () => {
                    try {
                      await downloadEntriesCsv(this._selected)
                    } catch (error) {
                      this._notice = error.message
                    }
                  }}
                ></uui-button>`
          }
        </div>

        ${this._notice ? html`<p class="notice" role="alert">${this._notice}</p>` : nothing}
        <p>${this._total} entr${this._total === 1 ? 'y' : 'ies'}.</p>

        ${
          this._entries.length === 0
            ? html`<p>Nothing to show.</p>`
            : repeat(
                this._entries,
                (entry) => entry.id,
                (entry) => html`
                  <div class="entry">
                    <div class="meta">
                      <strong>${new Date(entry.createDate).toLocaleString()}</strong>
                      ${this._selected === ALL ? html`<span class="form">${entry.formName}</span>` : nothing}
                      <span class="state">${entry.state}</span>
                      ${
                        this._languages.length > 1 && entry.culture
                          ? html`<span class="language">${entry.culture}</span>`
                          : nothing
                      }
                      ${entry.spam ? html`<span class="spam">spam</span>` : nothing}
                      ${
                        entry.libraryKey
                          ? html`<span class="library">${this.#libraryName(entry.libraryKey)}</span>`
                          : nothing
                      }
                    </div>
                    <dl>
                      ${entry.values.map(
                        (value) => html`
                          <dt>${value.fieldAlias}</dt>
                          <dd>
                            ${
                              value.redacted
                                ? html`<em>withheld — needs sensitive-data access</em>`
                                : (value.labels ?? value.values).join(', ') ||
                                  html`<em>not answered</em>`
                            }
                          </dd>
                        `,
                      )}
                    </dl>
                    <div class="actions">
                      <uui-button look="secondary" label="Approve" @click=${() => this.#setState(entry, 'approved')}></uui-button>
                      <uui-button look="secondary" label="Reject" @click=${() => this.#setState(entry, 'rejected')}></uui-button>
                      <uui-button look="secondary" color="danger" label="Delete" @click=${() => this.#remove(entry)}></uui-button>
                    </div>
                  </div>
                `,
              )
        }
      </uui-box>
    `
  }

  static styles = css`
    :host {
      display: block;
      padding: var(--uui-size-layout-1, 24px);
    }
    .filters {
      display: flex;
      gap: var(--uui-size-space-4, 12px);
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: var(--uui-size-layout-1, 24px);
    }
    .entry {
      border-top: 1px solid var(--uui-color-border, #e5e5e5);
      padding: var(--uui-size-space-4, 12px) 0;
    }
    .meta {
      display: flex;
      gap: var(--uui-size-space-4, 12px);
      align-items: baseline;
    }
    .state,
    .library,
    .spam {
      font-size: var(--uui-type-small-size, 0.8rem);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .spam {
      color: var(--uui-color-danger, #d42054);
    }
    dl {
      display: grid;
      grid-template-columns: minmax(8rem, 14rem) 1fr;
      gap: var(--uui-size-space-2, 6px) var(--uui-size-space-4, 12px);
      margin: var(--uui-size-space-4, 12px) 0;
    }
    dt {
      color: var(--uui-color-text-alt, #666);
    }
    dd {
      margin: 0;
    }
    .actions {
      display: flex;
      gap: var(--uui-size-space-4, 12px);
    }
    .notice {
      color: var(--uui-color-danger, #d42054);
    }
    .csv {
      margin-left: auto;
    }
  `
}

customElements.define('crombolo-forms-entries', CromboloFormsEntriesElement)
