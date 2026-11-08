/**
 * The tree of forms or of workflows (story 289), in Structure or beside them: their folders
 * and their items,
 * with making, renaming and moving, or a word saying why they cannot be changed.
 * Forms' root opens every submission; a folder is a real folder of files.
 */
import { css, html, nothing, repeat } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
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

/** The workflow designer, in Structure for those who have it, else beside forms. */
const workflowsAt = (query = '') =>
  `${here().startsWith('section/settings') ? 'section/settings/workflows' : 'section/forms/view/workflows'}${query}`

const KINDS = {
  Forms: {
    label: 'Forms',
    get root() {
      return formsAt('entries')
    },
    rootLabel: 'Forms',
    itemNoun: 'form',
    icon: 'icon-autofill',
    open: (item) => `${formsAt('forms')}?form=${encodeURIComponent(item.key)}`,
    create: (folder) => `${formsAt('forms')}?new=${encodeURIComponent(folder)}`,
    load: formsTree,
    folder: sendFormFolder,
    move: moveForm,
  },
  Workflows: {
    label: 'Workflows',
    get root() {
      return workflowsAt()
    },
    rootLabel: 'Workflows',
    itemNoun: 'workflow',
    icon: 'icon-mindmap',
    open: (item) => workflowsAt(`?workflow=${encodeURIComponent(item.alias)}`),
    create: (folder) => workflowsAt(`?new=${encodeURIComponent(folder)}`),
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
    /** The tree to show; without it, the menu item's, else whichever the address belongs to. */
    kind: { type: String },
    /** Set by the menu, as for any menu item: its `meta.kind` names the tree. */
    manifest: { attribute: false },
    _kind: { state: true },
    _tree: { state: true },
    _because: { state: true },
    _asking: { state: true },
    _problem: { state: true },
  }

  #follow = () => {
    const kind =
      this.kind ??
      this.manifest?.meta?.kind ??
      (/^section\/forms\/view\/workflows/.test(here()) ? 'Workflows' : 'Forms')
    if (kind === this._kind) return
    this._kind = kind
    this.#load()
  }

  #reload = () => this.#load()

  willUpdate(changed) {
    if (changed.has('manifest')) this.#follow()
  }

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
    const kind = this._kind
    const { items, folders, readOnlyBecause } = await this.#config.load()
    // A menu item names its tree after it is made: a load for the tree it had is dropped.
    if (kind !== this._kind) return
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

  /** Which folders are open, by path; the root is `''`. Everything starts open. */
  #closed = new Set()

  #toggle(path, open) {
    if (open) this.#closed.delete(path)
    else this.#closed.add(path)
    this.requestUpdate()
  }

  /** The popovers this render made: drawn after the tree, since a closed folder hides its children. */
  #popovers = []

  /**
   * A row's actions, as Umbraco's tree draws them: "…" for a popover of choices, then the
   * first choice as a button of its own when it is marked `quick`, e.g. "+" for a new item.
   */
  #menu(id, label, choices) {
    if (choices.length === 0) return nothing
    const pick = (run) => () => {
      this.renderRoot.querySelector(`#${id}`)?.hidePopover?.()
      run()
    }
    this.#popovers.push(html`<uui-popover-container id=${id} placement="bottom-start">
      <umb-popover-layout>
        ${choices.map(
          (choice) =>
            html`<uui-menu-item label=${choice.label} @click-label=${pick(choice.run)}>
              <umb-icon slot="icon" name=${choice.icon}></umb-icon>
            </uui-menu-item>`,
        )}
      </umb-popover-layout>
    </uui-popover-container>`)
    const [first] = choices
    return html`<uui-action-bar slot="actions">
      <uui-button compact label=${`Actions for ${label}`} popovertarget=${id}
        ><uui-symbol-more></uui-symbol-more
      ></uui-button>
      ${
        first.quick
          ? html`<uui-button compact label=${first.label} title=${first.label} @click=${first.run}
              ><umb-icon name=${first.icon}></umb-icon
            ></uui-button>`
          : nothing
      }
    </uui-action-bar>`
  }

  /** What a folder offers: a new item or folder in it, and, below the root, renaming or deleting it. */
  #folderChoices(path) {
    if (!this.#editable) return []
    const go = (to) => () => window.history.pushState(null, '', url(to))
    return [
      {
        label: `New ${this.#config.itemNoun}`,
        icon: 'icon-add',
        quick: true,
        run: go(this.#config.create(path)),
      },
      {
        label: 'New folder…',
        icon: 'icon-folder',
        run: () => {
          this._asking = { verb: 'new', path }
        },
      },
      ...(path
        ? [
            {
              label: 'Rename…',
              icon: 'icon-edit',
              run: () => {
                this._asking = { verb: 'rename', path }
              },
            },
            {
              label: 'Delete',
              icon: 'icon-trash',
              run: () => this.#send(() => this.#config.folder('DELETE', { path })),
            },
          ]
        : []),
    ]
  }

  /** What an item offers: moving it to another folder. */
  #itemChoices(item) {
    if (!this.#editable || (this._folders ?? []).length === 0) return []
    return ['', ...this._folders]
      .filter((folder) => folder !== (item.folder ?? ''))
      .map((folder) => ({
        label: folder ? `Move to ${folder}` : 'Move to the top',
        icon: 'icon-enter',
        run: () => this.#send(() => this.#config.move(item.alias, folder)),
      }))
  }

  #idFor(kind, key) {
    return `${kind}-${key.replace(/[^a-z0-9]/gi, '-')}`
  }

  #folder(node, label, href) {
    const children = node.folders.length + node.items.length > 0
    return html`<uui-menu-item
      label=${label}
      href=${href ?? nothing}
      .hasChildren=${children}
      .showChildren=${children && !this.#closed.has(node.path)}
      ?active=${href !== undefined && url(this.#config.root) === location.pathname}
      @show-children=${() => this.#toggle(node.path, true)}
      @hide-children=${() => this.#toggle(node.path, false)}
      @click-label=${href ? nothing : () => this.#toggle(node.path, this.#closed.has(node.path))}
    >
      <umb-icon slot="icon" name="icon-folder"></umb-icon>
      ${this.#menu(this.#idFor('folder', node.path || 'root'), label, this.#folderChoices(node.path))}
      ${repeat(
        node.folders,
        (folder) => folder.path,
        (folder) => this.#folder(folder, folder.name),
      )}
      ${repeat(
        node.items,
        (item) => item.alias,
        (item) => {
          const href = url(this.#config.open(item))
          return html`<uui-menu-item
            label=${item.name}
            href=${href}
            ?active=${`${location.pathname}${location.search}` === href}
          >
            <umb-icon slot="icon" name=${this.#config.icon}></umb-icon>
            ${this.#menu(this.#idFor('item', item.alias), item.name, this.#itemChoices(item))}
          </uui-menu-item>`
        },
      )}
    </uui-menu-item>`
  }

  render() {
    if (!this._tree) return html`<uui-loader></uui-loader>`
    const words = readOnlyWords(this.#config.label, this._because)
    this.#popovers = []
    const tree = this.#folder(this._tree, this.#config.rootLabel, url(this.#config.root))
    return html`${this.#asking()}
      ${this._problem ? html`<p class="problem" role="alert">${this._problem}</p>` : nothing}
      ${words ? html`<p class="note" role="status">${words}</p>` : nothing}
<uui-menu-item-list>${tree}</uui-menu-item-list>
      ${this.#popovers}`
  }

  static styles = css`
    :host {
      display: block;
    }
    .ask {
      display: flex;
      flex-wrap: wrap;
      gap: var(--uui-size-space-2);
      padding: var(--uui-size-space-2) var(--uui-size-space-4);
    }
    .ask input {
      flex: 1 1 100%;
      font: inherit;
    }
    .note,
    .problem {
      margin: 0;
      padding: var(--uui-size-space-2) var(--uui-size-space-4);
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
