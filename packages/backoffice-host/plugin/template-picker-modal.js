/**
 * The panel a page's template is chosen in (`template-picker.js`): every
 * component on disk in a tree of its folders, the first level open, with a
 * search that narrows it by name. One the content type does not allow says so,
 * and someone with Structure allows it beside it, which makes it a template
 * first when nothing names it yet; it is then picked like the rest.
 */
import { DocumentTypeService } from '@umbraco-cms/backoffice/external/backend-api'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbModalBaseElement } from '@umbraco-cms/backoffice/modal'
import { componentName, filterTree, templateTree, withAllowed } from './template-picker-model.js'

const base = () =>
  `${(document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')}/crombolo/api/templates`

async function components() {
  const response = await fetch(base(), { credentials: 'include' })
  if (!response.ok) throw new Error(`templates responded ${response.status}`)
  return (await response.json()).items
}

/** The template a component is, made when nothing names it yet. */
async function templateOf(alias) {
  const response = await fetch(base(), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ alias }),
  })
  if (!response.ok) throw new Error(`templates responded ${response.status}`)
  return (await response.json()).id
}

/** Adds a template to a content type's allowed templates; the list of ids after. */
async function allowTemplate(documentTypeUnique, templateId) {
  const { data: type } = await DocumentTypeService.getDocumentTypeById({
    path: { id: documentTypeUnique },
  })
  const { id: _id, ...body } = type
  const allowedTemplates = withAllowed(type.allowedTemplates, templateId)
  await DocumentTypeService.putDocumentTypeById({
    path: { id: documentTypeUnique },
    body: { ...body, allowedTemplates },
  })
  return allowedTemplates.map((t) => t.id)
}

export default class CromboloTemplatePickerModalElement extends UmbModalBaseElement {
  static properties = {
    _templates: { state: true },
    _allowedIds: { state: true },
    _query: { state: true },
    _toggled: { state: true },
    _busy: { state: true },
    _problem: { state: true },
  }

  constructor() {
    super()
    this._query = ''
    /** Folders opened or closed by hand, against the first level being open. */
    this._toggled = new Set()
  }

  async connectedCallback() {
    super.connectedCallback()
    this._allowedIds = this.data?.allowedTemplateIds ?? []
    try {
      this._templates = (await components()).map((c) => ({
        id: c.id,
        alias: c.alias,
        name: componentName(c.alias),
        ...(c.extension ? { extension: c.extension } : {}),
      }))
    } catch {
      this._problem = 'The templates could not be listed.'
      this._templates = []
    }
  }

  get #typeName() {
    return this.data?.documentTypeName || 'this content type'
  }

  #pick(template) {
    this.value = { unique: template.id, allowedTemplateIds: this._allowedIds }
    this._submitModal()
  }

  async #allow(template) {
    this._busy = template.alias
    this._problem = undefined
    try {
      const id = template.id ?? (await templateOf(template.alias))
      this._templates = this._templates.map((t) => (t.alias === template.alias ? { ...t, id } : t))
      this._allowedIds = await allowTemplate(this.data.documentTypeUnique, id)
    } catch {
      this._problem = `${template.name} could not be allowed for ${this.#typeName}.`
    } finally {
      this._busy = undefined
    }
  }

  #isOpen(folder, depth) {
    if (this._query.trim()) return true
    return (depth === 0) !== this._toggled.has(folder.path)
  }

  #toggle(folder) {
    const toggled = new Set(this._toggled)
    if (toggled.has(folder.path)) toggled.delete(folder.path)
    else toggled.add(folder.path)
    this._toggled = toggled
  }

  #folder(folder, depth) {
    const open = this.#isOpen(folder, depth)
    return html`<li role="treeitem" aria-expanded=${open ? 'true' : 'false'}>
      <button type="button" class="row folder" @click=${() => this.#toggle(folder)}>
        <uui-symbol-expand ?open=${open}></uui-symbol-expand>
        <umb-icon name="icon-folder"></umb-icon>${folder.name}
      </button>
      ${open ? this.#branch(folder, depth + 1) : nothing}
    </li>`
  }

  #branch(folder, depth) {
    return html`<ul role="group">
      ${folder.folders.map((child) => this.#folder(child, depth))}
      ${folder.items.map((template) => this.#item(template))}
    </ul>`
  }

  #item(template) {
    const current = template.id !== null && template.id === this.data?.selected
    if (template.allowed)
      return html`<li role="treeitem">
        <button
          type="button"
          class="row pick"
          title=${template.alias}
          aria-current=${current ? 'true' : 'false'}
          @click=${() => this.#pick(template)}
        >
          <span class="spacer"></span><umb-icon name="icon-document-html"></umb-icon>${template.name}
        </button>
      </li>`
    return html`<li role="treeitem" class="blocked">
      <span class="row name" title=${template.alias}
        ><span class="spacer"></span><umb-icon name="icon-document-html"></umb-icon>${template.name}</span
      >
      <span class="why">Not allowed for ${this.#typeName}</span>
      ${
        this.data?.mayAllow
          ? html`<uui-button
              compact
              look="secondary"
              label=${`Allow ${template.name} for ${this.#typeName}`}
              .state=${this._busy === template.alias ? 'waiting' : undefined}
              ?disabled=${this._busy !== undefined}
              @click=${() => this.#allow(template)}
              >Allow for ${this.#typeName}</uui-button
            >`
          : nothing
      }
    </li>`
  }

  #tree() {
    if (!this._templates) return html`<uui-loader></uui-loader>`
    const shown = filterTree(templateTree(this._templates, this._allowedIds), this._query)
    if (shown.folders.length === 0 && shown.items.length === 0)
      return html`<p class="note">No template has that name.</p>`
    return html`<ul role="tree" aria-label="Templates">
      ${shown.folders.map((folder) => this.#folder(folder, 0))}
      ${shown.items.map((template) => this.#item(template))}
    </ul>`
  }

  render() {
    const blocked = (this._templates ?? []).some(
      (t) =>
        t.id === null || !this._allowedIds.some((id) => id.toLowerCase() === t.id.toLowerCase()),
    )
    return html`<umb-body-layout headline="Choose a template">
      <uui-box>
        <uui-input
          class="search"
          label="Search templates"
          placeholder="Search by name"
          .value=${this._query}
          @input=${(e) => {
            this._query = e.target.value ?? ''
          }}
        >
          <umb-icon name="icon-search" slot="prepend"></umb-icon>
        </uui-input>
        ${this.#tree()}
        ${
          blocked && !this.data?.mayAllow
            ? html`<p class="note" role="status">
                Someone with access to Structure can allow more templates for ${this.#typeName}.
              </p>`
            : nothing
        }
        ${this._problem ? html`<p role="alert">${this._problem}</p>` : nothing}
      </uui-box>
      <uui-button slot="actions" label="Close" @click=${() => this._rejectModal()}>Close</uui-button>
    </umb-body-layout>`
  }

  static styles = css`
    .search {
      width: 100%;
      margin-bottom: var(--uui-size-space-4);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    ul ul {
      padding-left: var(--uui-size-space-5);
    }
    li.blocked {
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-3);
    }
    .row {
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-2);
      min-height: 2.2rem;
      padding: 0 var(--uui-size-space-3);
      border: 0;
      border-radius: var(--uui-border-radius);
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
    }
    button.row {
      width: 100%;
      cursor: pointer;
    }
    button.row:hover,
    .pick[aria-current='true'] {
      background: var(--uui-color-surface-emphasis);
    }
    .pick[aria-current='true'] {
      font-weight: 700;
    }
    .spacer {
      display: inline-block;
      width: 1em;
    }
    uui-symbol-expand {
      width: 1em;
    }
    .blocked .name {
      color: var(--uui-color-disabled-contrast);
    }
    .why,
    .note {
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
    }
    .why {
      flex: 1;
    }
  `
}

customElements.define('crombolo-template-picker-modal', CromboloTemplatePickerModalElement)

export { CromboloTemplatePickerModalElement as element }
