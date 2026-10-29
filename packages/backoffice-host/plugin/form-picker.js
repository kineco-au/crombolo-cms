/**
 * The Form Picker property editor.
 *
 * A form is a file in `schema/forms/`, so the list comes from the server rather
 * than from a tree of nodes: there is nothing in the database to browse. The
 * stored value is the form's key, which is what a render resolves back to the
 * definition.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { formPickerOptions, NO_FORM_VALUE } from './form-picker-options.js'
import { listForms, readForm } from './forms-client.js'

export default class CromboloFormPickerElement extends UmbLitElement {
  static properties = {
    value: { type: String },
    _items: { state: true },
    _failed: { state: true },
    _detail: { state: true },
  }

  constructor() {
    super()
    this.value = ''
    this._items = undefined
    this._failed = false
    this._detail = undefined
  }

  connectedCallback() {
    super.connectedCallback()
    listForms().then(
      (items) => {
        this._failed = false
        this._items = items
      },
      () => {
        this._failed = true
      },
    )
  }

  updated(changed) {
    if (changed.has('value') || changed.has('_items')) this.#loadFields()
  }

  async #loadFields() {
    const key = this.value
    this._detail = undefined
    if (!this._items?.some((form) => form.key === key)) return
    try {
      const detail = await readForm(key)
      if (this.value === key) this._detail = { key, definition: detail.definition }
    } catch {
      if (this.value === key) this._detail = { key, failed: true }
    }
  }

  /**
   * A plain `change` on the host, which is what `umb-property` listens for.
   *
   * `UmbPropertyValueChangeEvent` is deprecated upstream and is not exported by
   * the vendored client at all, so importing it would fail at runtime. The
   * inner select's own event is stopped so the host dispatches exactly one.
   */
  #pick(event) {
    event.stopPropagation()
    this.value = event.target.value === NO_FORM_VALUE ? undefined : event.target.value || undefined
    this.dispatchEvent(new Event('change'))
  }

  render() {
    if (this._failed) return html`<uui-box><p>The list of forms could not be loaded.</p></uui-box>`
    if (this._items === undefined) return html`<uui-loader></uui-loader>`
    if (this._items.length === 0 && !this.value)
      return html`
        <p class="empty">
          This site has no forms yet. Add one in the Forms section.
        </p>
      `
    return html`
      <uui-select
        .options=${formPickerOptions(this._items, this.value)}
        @change=${this.#pick}
        label="Form"
      ></uui-select>
      ${this.value ? html`<p class="detail">${this.#describe()}</p>` : nothing}
      ${
        this._items.some((form) => form.key === this.value)
          ? html`<details>
              <summary>View form fields</summary>
              ${this.#fields()}
            </details>`
          : nothing
      }
    `
  }

  #describe() {
    const form = this._items?.find((item) => item.key === this.value)
    if (!form) return 'The selected form is no longer available.'
    const fields = `${form.fieldCount} field${form.fieldCount === 1 ? '' : 's'}`
    const pages = `${form.pageCount} page${form.pageCount === 1 ? '' : 's'}`
    return `${fields} over ${pages}${form.storeEntries ? '' : '; entries are not stored'}`
  }

  #fields() {
    const detail = this._detail?.key === this.value ? this._detail : undefined
    if (!detail) return html`<p role="status">Loading form fields…</p>`
    if (detail.failed)
      return html`<p role="alert">The form fields could not be loaded.</p>
        <uui-button label="Try again" look="secondary" @click=${() => this.#loadFields()}></uui-button>`
    return detail.definition.pages.map(
      (page, index) => html`<section aria-label=${page.caption || `Page ${index + 1}`}>
        <h4>${page.caption || `Page ${index + 1}`}</h4>
        ${page.groups.map(
          (group) => html`<div>
            ${group.caption ? html`<h5>${group.caption}</h5>` : nothing}
            <ul class="fields">
              ${group.fields.map(
                (field) => html`<li>
                  <span>${field.caption || field.alias}</span>
                  ${field.mandatory ? html`<small class="required">Required</small>` : nothing}
                  ${field.helpText ? html`<p>${field.helpText}</p>` : nothing}
                  ${
                    field.values?.length
                      ? html`<ul>${field.values.map((choice) => html`<li>${choice}</li>`)}</ul>`
                      : nothing
                  }
                </li>`,
              )}
            </ul>
          </div>`,
        )}
      </section>`,
    )
  }

  static styles = css`
    :host {
      display: block;
    }
    .empty,
    .detail {
      color: var(--uui-color-text-alt, #666);
      font-size: var(--uui-type-small-size, 0.8rem);
      margin: var(--uui-size-space-2, 6px) 0 0;
    }
    details {
      margin-top: var(--uui-size-space-4, 12px);
    }
    summary {
      cursor: pointer;
    }
    .fields > li {
      margin-bottom: var(--uui-size-space-3, 9px);
    }
    .fields p {
      margin: 0;
      color: var(--uui-color-text-alt);
    }
    .required {
      margin-left: var(--uui-size-space-2, 6px);
      color: var(--uui-color-text-alt);
    }
  `
}

customElements.define('crombolo-form-picker', CromboloFormPickerElement)
