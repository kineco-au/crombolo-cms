/**
 * The "Search & sharing" view on a page whose type includes those fields: how
 * the page will look in search results, and where each value comes from.
 *
 * The values come from the server, which works them out with the same code the
 * page's head uses, so the preview cannot disagree with what is served. It
 * reads the last saved version, so an editor sees a change once it is saved.
 *
 * An administrator may set where each value comes from (story 317), for this
 * page, in its own field, or for every page of its type.
 */
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UMB_PROPERTY_DATASET_CONTEXT } from '@umbraco-cms/backoffice/property'
import { UmbVariantId } from '@umbraco-cms/backoffice/variant'
import { readPreview, saveTypeValues } from './client.js'
import './value-input.js'

const SOURCES = {
  page: 'From this page',
  type: "This type's setting",
  metadata: 'From the page design',
  template: 'From the page design',
  site: 'Site setting',
  name: 'Page name',
  none: 'Not configured',
}

/** Each value, the page's own field for it, and what it is called. */
const FIELDS = {
  title: { label: 'Title', alias: 'seoTitle' },
  description: { label: 'Description', alias: 'seoDescription' },
  image: { label: 'Sharing image', alias: 'seoImage' },
  canonical: { label: 'Preferred address', alias: 'seoCanonical' },
}

export default class CromboloSeoDocumentViewElement extends UmbLitElement {
  static properties = {
    _preview: { state: true },
    _error: { state: true },
    _editing: { state: true },
    _draft: { state: true },
    _saving: { state: true },
    _problem: { state: true },
  }

  #unique = undefined
  #culture = null
  #workspace = undefined

  constructor() {
    super()
    this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (context) => {
      if (!context) return
      this.#workspace = context
      this.observe(context.unique, (unique) => {
        this.#unique = unique
        this.#load()
      })
    })
    this.consumeContext(UMB_PROPERTY_DATASET_CONTEXT, (dataset) => {
      this.#culture = dataset?.getVariantId?.()?.culture ?? null
      this.#load()
    })
  }

  async #load() {
    if (!this.#unique) return
    try {
      this._preview = await readPreview(this.#unique, this.#culture)
      this._error = undefined
    } catch (error) {
      this._error = error.message
    }
  }

  #row(field, item, render = (value) => value) {
    const canEdit = this._preview?.mapping?.canEdit
    return html`
      <tr>
        <th>${FIELDS[field].label}</th>
        <td>${item.value ? render(item.value) : '-'}</td>
        <td>
          ${
            item.source === 'none'
              ? html`<span class="unset"><uui-icon name="icon-alert"></uui-icon>Not configured</span>`
              : html`<uui-tag look="secondary">${SOURCES[item.source] ?? item.source}</uui-tag>`
          }
          ${
            item.over === 'type'
              ? html`<div class="note">The page design overrides this type's setting.</div>`
              : nothing
          }
        </td>
        ${
          canEdit
            ? html`<td class="action">
                <uui-button
                  look="secondary"
                  compact
                  label="Change where the ${FIELDS[field].label.toLowerCase()} comes from"
                  @click=${() => this.#edit(field)}
                >Change</uui-button>
              </td>`
            : nothing
        }
      </tr>
      ${this._editing === field ? this.#editor(field) : nothing}
    `
  }

  /** The variant a page's own field is set in: its culture's, when the field varies. */
  async #variantFor(alias) {
    const property = await this.#workspace?.structure?.getPropertyStructureByAlias?.(alias)
    return property?.variesByCulture && this.#culture
      ? UmbVariantId.CreateFromPartial({ culture: this.#culture })
      : UmbVariantId.CreateInvariant()
  }

  async #edit(field) {
    const { alias } = FIELDS[field]
    const typeValue = this._preview?.mapping?.type?.seo?.[field] ?? ''
    const own =
      field === 'image'
        ? ''
        : this.#workspace?.getPropertyValue?.(alias, await this.#variantFor(alias))
    this._draft = typeof own === 'string' && own.trim() ? own : typeValue
    this._problem = undefined
    this._editing = field
  }

  async #saveForPage(field) {
    const { alias } = FIELDS[field]
    this._saving = true
    try {
      await this.#workspace.setPropertyValue(
        alias,
        this._draft ?? '',
        await this.#variantFor(alias),
      )
      await this.#workspace.requestSave()
      this._editing = undefined
      await this.#load()
    } catch (error) {
      this._problem = error.message
    } finally {
      this._saving = false
    }
  }

  async #saveForType(field) {
    const type = this._preview.mapping.type
    this._saving = true
    try {
      await saveTypeValues(type.alias, { ...type.seo, [field]: this._draft ?? '' })
      this._editing = undefined
      await this.#load()
    } catch (error) {
      this._problem = error.message
    } finally {
      this._saving = false
    }
  }

  #editor(field) {
    const { mapping } = this._preview
    const type = mapping.type
    const span = mapping.canEdit ? 4 : 3
    const pages = `${type.pages} ${type.pages === 1 ? 'page' : 'pages'}`
    return html`
      <tr class="editing">
        <td colspan=${span}>
          ${
            field === 'image'
              ? html`<uui-select
                  label="Sharing image"
                  .options=${[
                    { name: 'None', value: '', selected: !this._draft },
                    ...mapping.properties
                      .filter((p) => p.mediaPicker)
                      .map((p) => ({
                        name: p.name,
                        value: p.alias,
                        selected: this._draft === p.alias,
                      })),
                  ]}
                  @change=${(event) => {
                    this._draft = event.target.value
                  }}
                ></uui-select>
                <p class="note">
                  The first image the chosen picker holds. A page's own sharing image is picked
                  in its Search &amp; sharing fields.
                </p>`
              : html`<crombolo-seo-value-input
                  label=${FIELDS[field].label}
                  .value=${this._draft ?? ''}
                  .properties=${mapping.properties.map(({ alias, name }) => ({ alias, name }))}
                  @change=${(event) => {
                    this._draft = event.target.value
                  }}
                ></crombolo-seo-value-input>
                <p class="note">
                  Type text, <code>{</code> for one of this page's values, or <code>{#</code> for a
                  dictionary word.
                </p>`
          }
          ${this._problem ? html`<p class="warning">${this._problem}</p>` : nothing}
          <div class="choices">
            ${
              field === 'image'
                ? nothing
                : html`<uui-button
                    look="primary"
                    label="This page only"
                    ?disabled=${this._saving}
                    @click=${() => this.#saveForPage(field)}
                  ></uui-button>`
            }
            ${
              type.editable
                ? html`<uui-button
                    look=${field === 'image' ? 'primary' : 'secondary'}
                    label="Every ${type.name} page (${pages})"
                    ?disabled=${this._saving}
                    @click=${() => this.#saveForType(field)}
                  ></uui-button>`
                : nothing
            }
            <uui-button
              look="default"
              label="Cancel"
              @click=${() => {
                this._editing = undefined
              }}
            ></uui-button>
          </div>
          ${
            type.editable
              ? nothing
              : html`<p class="note">
                  Every ${type.name} page's setting is kept with the site's files here, so it
                  changes with a deploy.
                </p>`
          }
        </td>
      </tr>
    `
  }

  render() {
    if (this._error) return html`<uui-box><p>${this._error}</p></uui-box>`
    const preview = this._preview
    if (!preview) return html`<uui-loader></uui-loader>`
    const { meta, snippet } = preview
    return html`
      <uui-box headline="In search results">
        <div class="snippet">
          ${snippet.name ? html`<div class="field"><span class="label">Name:</span> ${snippet.name}</div>` : nothing}
          <div class="field url">
            <span class="label">URL:</span> ${snippet.url || 'This page has no address yet'}
          </div>
          ${snippet.description ? html`<div class="description">${snippet.description}</div>` : nothing}
        </div>
        ${
          meta.noindex.value
            ? html`<p class="warning">
                ${
                  meta.noindex.source === 'site'
                    ? 'The whole site is hidden from search engines in Settings.'
                    : 'This page asks search engines to leave it out of their results.'
                }
              </p>`
            : nothing
        }
        ${
          preview.differs === 'unpublished'
            ? html`<p class="note">This page is not published yet, so search engines do not see it.</p>`
            : preview.differs === 'changed'
              ? html`<p class="note">Includes saved changes that are not published yet.</p>`
              : nothing
        }
        <h4>Searchable property values</h4>
        <table>
          ${this.#row('title', meta.title)}
          ${this.#row('description', meta.description)}
          ${this.#row('image', meta.image, (src) => html`<img src=${src} alt="" />`)}
          ${this.#row('canonical', meta.canonical)}
        </table>
      </uui-box>
    `
  }

  static styles = css`
    /* A value nothing sets: a warning, so it is put right. */
    .unset {
      display: inline-flex;
      align-items: center;
      gap: var(--uui-size-space-1);
      color: var(--uui-color-warning-standalone, var(--uui-color-warning-emphasis));
      font-weight: 600;
    }
    :host {
      display: block;
      padding: var(--uui-size-layout-1);
    }
    uui-box + uui-box {
      margin-top: var(--uui-size-layout-1);
    }
    .snippet {
      max-width: 600px;
      font-family: arial, sans-serif;
    }
    /* The page's name and address, each on a line with its label. */
    .snippet .field {
      font-size: 14px;
      overflow-wrap: anywhere;
    }
    .snippet .field .label {
      display: inline-block;
      min-width: 3.5em;
      color: var(--uui-color-text-alt);
      font-weight: 600;
    }
    .snippet .url {
      color: var(--uui-color-text-alt);
      font-size: 14px;
      overflow-wrap: anywhere;
    }
    .snippet .description {
      color: var(--uui-color-text);
      font-size: 14px;
    }
    .warning {
      color: var(--uui-color-danger);
    }
    h4 {
      margin: var(--uui-size-layout-1) 0 var(--uui-size-space-3);
      padding-top: var(--uui-size-space-5);
      border-top: 1px solid var(--uui-color-divider);
    }
    .note {
      color: var(--uui-color-text-alt);
      font-size: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      text-align: left;
      padding: var(--uui-size-space-3);
      border-bottom: 1px solid var(--uui-color-divider);
      vertical-align: top;
    }
    th {
      width: 12em;
    }
    img {
      max-width: 240px;
      max-height: 140px;
    }
    td.action {
      width: 1%;
      white-space: nowrap;
    }
    tr.editing td {
      background: var(--uui-color-surface-alt);
    }
    .choices {
      display: flex;
      flex-wrap: wrap;
      gap: var(--uui-size-space-2);
      margin-top: var(--uui-size-space-3);
    }
  `
}

customElements.define('crombolo-seo-document-view', CromboloSeoDocumentViewElement)
