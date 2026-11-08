/**
 * A page's history, in a panel that slides in from the right (`page-history.js`):
 * every version of the page, newest first, with who saved it and when. Choosing
 * one shows, in the panel, what changed from the version before it.
 */
import {
  DocumentTypeService,
  DocumentVersionService,
  LanguageService,
  UserService,
} from '@umbraco-cms/backoffice/external/backend-api'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbModalBaseElement } from '@umbraco-cms/backoffice/modal'
import { changeCultures, changesIn, versionChanges } from './page-history-model.js'

const when = (iso) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Each property's name by alias, the type's own and its compositions'. */
async function propertyNames(documentTypeUnique) {
  const names = new Map()
  const seen = new Set()
  const read = async (id) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    const { data } = await DocumentTypeService.getDocumentTypeById({ path: { id } }).catch(
      () => ({}),
    )
    for (const property of data?.properties ?? []) names.set(property.alias, property.name)
    for (const composition of data?.compositions ?? []) await read(composition.documentType?.id)
  }
  await read(documentTypeUnique)
  return names
}

export default class CromboloPageHistoryModalElement extends UmbModalBaseElement {
  static properties = {
    _versions: { state: true },
    _users: { state: true },
    _open: { state: true },
    _changes: { state: true },
    _culture: { state: true },
    _pageCultures: { state: true },
    _problem: { state: true },
  }

  #names
  /** The site's languages, by ISO code, and which is the default. */
  #languages

  async connectedCallback() {
    super.connectedCallback()
    try {
      const { data } = await DocumentVersionService.getDocumentVersion({
        query: { documentId: this.data.unique, skip: 0, take: 200 },
      })
      this._versions = data?.items ?? []
      const ids = [...new Set(this._versions.map((v) => v.user?.id).filter(Boolean))]
      const users = ids.length
        ? ((await UserService.getItemUser({ query: { id: ids } }).catch(() => ({}))).data ?? [])
        : []
      this._users = new Map(users.map((u) => [u.id, u.name]))
    } catch {
      this._problem = 'The history of this page could not be read.'
      this._versions = []
    }
  }

  #who(version) {
    return this._users?.get(version.user?.id) ?? 'Unknown user'
  }

  async #show(index) {
    const version = this._versions[index]
    const older = this._versions[index + 1]
    this._open = index
    this._changes = undefined
    try {
      this.#names ??= await propertyNames(this.data.documentTypeUnique)
      this.#languages ??= await LanguageService.getLanguage({ query: { skip: 0, take: 100 } })
        .then(({ data }) => data?.items ?? [])
        .catch(() => [])
      const read = async (v) =>
        v
          ? (await DocumentVersionService.getDocumentVersionById({ path: { id: v.id } })).data
          : undefined
      const [after, before] = await Promise.all([read(version), read(older)])
      this._changes = versionChanges(before, after, this.#names)
      this._pageCultures = (after?.variants ?? []).map((v) => v.culture).filter(Boolean)
      const fallback = this.#languages.find((l) => l.isDefault)?.isoCode
      this._culture = changeCultures(this._changes, fallback, this._pageCultures)[0]
    } catch {
      this._changes = []
      this._problem = 'This change could not be read.'
    }
  }

  #flags(version) {
    return html`${
      version.isCurrentPublishedVersion
        ? html`<uui-tag color="positive" look="secondary">Published</uui-tag>`
        : nothing
    }${version.isCurrentDraftVersion ? html`<uui-tag look="secondary">Current</uui-tag>` : nothing}`
  }

  #list() {
    if (!this._versions) return html`<uui-loader></uui-loader>`
    if (this._versions.length === 0) return html`<p>This page has no history yet.</p>`
    return html`<ul class="versions" aria-label="Changes to the page">
      ${this._versions.map(
        (version, index) => html`<li>
          <button type="button" @click=${() => this.#show(index)}>
            <span class="when">${when(version.versionDate)}</span>
            <span class="who">${this.#who(version)}</span>
            <span class="flags">${this.#flags(version)}</span>
          </button>
        </li>`,
      )}
    </ul>`
  }

  /** A chip for each language the changes are in, the default first; the one chosen shows its own. */
  #chips() {
    const fallback = this.#languages?.find((l) => l.isDefault)?.isoCode
    const cultures = this._changes
      ? changeCultures(this._changes, fallback, this._pageCultures ?? [])
      : []
    if (cultures.length === 0) return nothing
    const name = (iso) => this.#languages?.find((l) => l.isoCode === iso)?.name ?? iso
    return html`<div class="chips" role="radiogroup" aria-label="Language">
      ${cultures.map(
        (culture) => html`<button
          type="button"
          role="radio"
          class="chip"
          aria-checked=${culture === this._culture ? 'true' : 'false'}
          title=${name(culture)}
          @click=${() => {
            this._culture = culture
          }}
        >
          ${culture}
        </button>`,
      )}
    </div>`
  }

  #detail() {
    const version = this._versions[this._open]
    const first = this._open === this._versions.length - 1
    return html`<uui-button look="secondary" compact label="All changes" @click=${() => {
      this._open = undefined
      this._problem = undefined
    }}>← All changes</uui-button>
      <dl class="facts">
        <dt>When</dt><dd>${when(version.versionDate)}</dd>
        <dt>By</dt><dd>${this.#who(version)}</dd>
        ${
          version.isCurrentPublishedVersion || version.isCurrentDraftVersion
            ? html`<dt>Now</dt><dd>${this.#flags(version)}</dd>`
            : nothing
        }
      </dl>
      <h4>${first ? 'What the page was made with' : 'What changed from the version before'}</h4>
      ${this.#chips()}
      ${
        !this._changes
          ? html`<uui-loader></uui-loader>`
          : this._changes.length === 0
            ? html`<p>Nothing changed: the page was saved as it was.</p>`
            : changesIn(this._changes, this._culture).length === 0
              ? html`<p>Nothing changed in ${this._culture}.</p>`
              : html`<uui-table aria-label="Changed properties">
                <uui-table-head>
                  <uui-table-head-cell>Property</uui-table-head-cell>
                  <uui-table-head-cell>Before</uui-table-head-cell>
                  <uui-table-head-cell>After</uui-table-head-cell>
                </uui-table-head>
                ${changesIn(this._changes, this._culture).map(
                  (change) => html`<uui-table-row>
                    <uui-table-cell
                      >${change.label}${change.culture ? html`<small>${change.culture}</small>` : nothing}</uui-table-cell
                    >
                    <uui-table-cell class="before">${change.before}</uui-table-cell>
                    <uui-table-cell>${change.after}</uui-table-cell>
                  </uui-table-row>`,
                )}
              </uui-table>`
      }`
  }

  render() {
    return html`<umb-body-layout headline="Page history">
      <uui-box>
        ${this._problem ? html`<p role="alert">${this._problem}</p>` : nothing}
        ${this._open === undefined ? this.#list() : this.#detail()}
      </uui-box>
      <uui-button slot="actions" label="Close" @click=${() => this._rejectModal()}>Close</uui-button>
    </umb-body-layout>`
  }

  static styles = css`
    .versions {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .versions button {
      display: grid;
      /* The same columns in every row, whatever tags a row has, so they line up. */
      grid-template-columns: minmax(0, 13rem) minmax(0, 1fr) 11rem;
      align-items: center;
      gap: var(--uui-size-space-3);
      width: 100%;
      padding: var(--uui-size-space-3);
      border: 0;
      border-bottom: 1px solid var(--uui-color-divider);
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .versions button:hover {
      background: var(--uui-color-surface-emphasis);
    }
    .who {
      color: var(--uui-color-text-alt);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--uui-size-space-2);
      margin-bottom: var(--uui-size-space-4);
    }
    .chip {
      padding: var(--uui-size-space-1) var(--uui-size-space-4);
      border: 1px solid var(--uui-color-border-emphasis);
      border-radius: 999px;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .chip[aria-checked='true'] {
      border-color: var(--uui-color-selected);
      background: var(--uui-color-selected);
      color: var(--uui-color-selected-contrast);
    }
    .flags {
      justify-content: flex-end;
      display: inline-flex;
      gap: var(--uui-size-space-1);
    }
    .facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--uui-size-space-2) var(--uui-size-space-4);
      margin: var(--uui-size-space-4) 0;
    }
    dt {
      font-weight: 700;
    }
    dd {
      margin: 0;
    }
    small {
      display: block;
      color: var(--uui-color-text-alt);
    }
    .before {
      color: var(--uui-color-text-alt);
    }
  `
}

customElements.define('crombolo-page-history-modal', CromboloPageHistoryModalElement)

export { CromboloPageHistoryModalElement as element }
