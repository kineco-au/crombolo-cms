/**
 * The tree beside forms and workflows (story 289): their folders and their items,
 * with making, renaming and moving, or a word saying why they cannot be changed.
 * Forms' root opens every submission; a folder is a real folder of files.
 */
import { css, html, nothing, repeat } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { activeItem } from './content-strip-items.js'
import { definitionTree, readOnlyWords } from './definition-tree-model.js'
import { formsTree, moveForm, sendFormFolder } from './forms-client.js'
import { listWorkflows, moveWorkflow, sendWorkflowFolder } from './workflow-client.js'

const here = () => {
  const base = new URL(document.baseURI).pathname
  return location.pathname.startsWith(base) ? location.pathname.slice(base.length) : ''
}

/** A form's screens, in Structure for those who have it, else in the Forms section. */
const formsAt = (view) =>
  here().startsWith('section/settings')
    ? `section/settings/forms${view === 'entries' ? '/entries' : ''}`
    : `section/forms/view/${view}`

const KINDS = {
  Forms: {
    label: 'Forms',
    get root() {
      return formsAt('entries')
    },
    rootLabel: 'Forms',
    open: (item) => `${formsAt('forms')}?form=${encodeURIComponent(item.key)}`,
    create: (folder) => `${formsAt('forms')}?new=${encodeURIComponent(folder)}`,
    load: formsTree,
    folder: sendFormFolder,
    move: moveForm,
  },
  Workflows: {
    label: 'Workflows',
    root: 'section/forms/view/workflows',
    rootLabel: 'Workflows',
    open: (item) => `section/forms/view/workflows?workflow=${encodeURIComponent(item.alias)}`,
    create: (folder) => `section/forms/view/workflows?new=${encodeURIComponent(folder)}`,
    load: async () => {
      const list = await listWorkflows()
      return {
        items: list.items ?? [],
        folders: list.folders ?? [],
        readOnlyBecause: list.readOnlyBecause,
      }
    },
    folder: sendWorkflowFolder,
    move: moveWorkflow,
  },
}

const url = (path) =>
  new URL(path, document.baseURI).pathname + new URL(path, document.baseURI).search

export default class CromboloDefinitionTreeElement extends UmbLitElement {
  static properties = {
    /** The tree to show; without it, whichever the address belongs to. */
    kind: { type: String },
    _kind: { state: true },
    _tree: { state: true },
    _because: { state: true },
    _asking: { state: true },
    _problem: { state: true },
  }

  #follow = () => {
    const kind = this.kind ?? (activeItem(here()) === 'Workflows' ? 'Workflows' : 'Forms')
    if (kind === this._kind) return
    this._kind = kind
    this.#load()
  }

  #reload = () => this.#load()

  connectedCallback() {
    super.connectedCallback()
    this.#follow()
    window.addEventListener('changestate', this.#follow)
    window.addEventListener('popstate', this.#follow)
    window.addEventListener('crombolo:definitions-changed', this.#reload)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('changestate', this.#follow)
    window.removeEventListener('popstate', this.#follow)
    window.removeEventListener('crombolo:definitions-changed', this.#reload)
  }

  get #config() {
    return KINDS[this._kind]
  }

  async #load() {
    const { items, folders, readOnlyBecause } = await this.#config.load()
    this._tree = definitionTree(items, folders)
    this._folders = folders
    this._because = readOnlyBecause
  }

  get #editable() {
    return !this._because
  }

  /** A folder change, and what stopped it, if anything did. */
  async #send(change) {
    this._problem = undefined
    const result = await change()
    if (result.ok === false) this._problem = result.message ?? 'That could not be done.'
    this._asking = undefined
    await this.#load()
  }

  #submit(event) {
    event.preventDefault()
    const name = new FormData(event.target).get('name')?.toString().trim()
    if (!name) return
    const { verb, path } = this._asking
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    if (verb === 'new') {
      const target = path ? `${path}/${name}` : name
      this.#send(() => this.#config.folder('POST', { path: target }))
    } else {
      const to = parent ? `${parent}/${name}` : name
      this.#send(() => this.#config.folder('PUT', { from: path, to }))
    }
  }

  #asking() {
    if (!this._asking) return nothing
    return html`<form class="ask" @submit=${(event) => this.#submit(event)}>
      <input
        name="name"
        aria-label="Folder name"
        placeholder="Folder name"
        .value=${this._asking.verb === 'rename' ? this._asking.path.split('/').pop() : ''}
        autofocus
      />
      <button type="submit">${this._asking.verb === 'rename' ? 'Rename' : 'Add'}</button>
      <button type="button" @click=${() => {
        this._asking = undefined
      }}>Cancel</button>
    </form>`
  }

  #folderActions(path) {
    if (!this.#editable) return nothing
    return html`<span class="actions">
      <a href=${url(this.#config.create(path))} title="New in this folder" aria-label="New in this folder">+</a>
      <button
        type="button"
        title="New folder"
        aria-label="New folder"
        @click=${() => {
          this._asking = { verb: 'new', path }
        }}
      >▸</button>
      ${
        path
          ? html`<button
                type="button"
                title="Rename"
                aria-label="Rename"
                @click=${() => {
                  this._asking = { verb: 'rename', path }
                }}
              >✎</button>
              <button
                type="button"
                title="Delete"
                aria-label="Delete"
                @click=${() => this.#send(() => this.#config.folder('DELETE', { path }))}
              >×</button>`
          : nothing
      }
    </span>`
  }

  #move(item) {
    if (!this.#editable || (this._folders ?? []).length === 0) return nothing
    return html`<select
      aria-label="Move to a folder"
      title="Move to a folder"
      @change=${(event) => this.#send(() => this.#config.move(item.alias, event.target.value))}
    >
      <option value="" ?selected=${!item.folder}>Top</option>
      ${this._folders.map(
        (folder) =>
          html`<option value=${folder} ?selected=${folder === item.folder}>${folder}</option>`,
      )}
    </select>`
  }

  #items(node) {
    return html`<ul>
      ${repeat(
        node.folders,
        (folder) => folder.path,
        (folder) => html`<li>
          <details open>
            <summary><span>${folder.name}</span>${this.#folderActions(folder.path)}</summary>
            ${this.#items(folder)}
          </details>
        </li>`,
      )}
      ${repeat(
        node.items,
        (item) => item.alias,
        (item) => html`<li class="item">
          <a href=${url(this.#config.open(item))}>${item.name}</a>${this.#move(item)}
        </li>`,
      )}
    </ul>`
  }

  render() {
    if (!this._tree) return html`<uui-loader></uui-loader>`
    const words = readOnlyWords(this.#config.label, this._because)
    return html`<div class="root">
        <a href=${url(this.#config.root)}>${this.#config.rootLabel}</a>
        ${this.#folderActions('')}
      </div>
      ${this.#asking()}
      ${this._problem ? html`<p class="problem" role="alert">${this._problem}</p>` : nothing}
      ${words ? html`<p class="note" role="status">${words}</p>` : nothing}
      ${this.#items(this._tree)}`
  }

  static styles = css`
    :host {
      display: block;
      padding: var(--uui-size-space-3) var(--uui-size-space-4);
    }
    a {
      color: var(--uui-color-text);
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .root {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 700;
      padding-bottom: var(--uui-size-space-2);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0 0 0 var(--uui-size-space-4);
    }
    :host > ul {
      padding-left: 0;
    }
    li {
      padding: var(--uui-size-space-1) 0;
    }
    .item {
      display: flex;
      justify-content: space-between;
      gap: var(--uui-size-space-2);
    }
    summary {
      display: flex;
      justify-content: space-between;
      cursor: pointer;
      list-style-position: inside;
    }
    .actions {
      display: inline-flex;
      gap: var(--uui-size-space-1);
    }
    .actions button,
    .actions a {
      background: none;
      border: 0;
      padding: 0 var(--uui-size-space-1);
      cursor: pointer;
      color: var(--uui-color-text-alt);
      font: inherit;
    }
    select {
      max-width: 5rem;
      font: inherit;
      font-size: var(--uui-type-small-size);
      color: var(--uui-color-text-alt);
      background: none;
      border: 0;
    }
    .ask {
      display: flex;
      flex-wrap: wrap;
      gap: var(--uui-size-space-2);
      padding-bottom: var(--uui-size-space-2);
    }
    .ask input {
      flex: 1 1 100%;
      font: inherit;
    }
    .note,
    .problem {
      margin: 0 0 var(--uui-size-space-3);
      font-size: var(--uui-type-small-size);
      line-height: 1.5;
      color: var(--uui-color-text-alt);
    }
    .problem {
      color: var(--uui-color-danger);
    }
  `
}

customElements.define('crombolo-definition-tree', CromboloDefinitionTreeElement)
