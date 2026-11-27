/**
 * The workspace switch at the end of the strip under Content (story 384): where this
 * tab is, Shared or a workspace with its colour beside its name, and a list to switch
 * from, see its changes, go to its merge and open it at its address. Switching reloads the
 * screen in that workspace. The controls before it (story 428) open a new one, and
 * merge, share and delete the one the tab is in. Every workspace is on the Workspaces
 * page.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { ask } from './ask.js'
import { pageDialog } from './dialog-styles.js'
import {
  chooseWorkspace,
  colourOf,
  controlsFor,
  currentWorkspace,
  menuFor,
  tabWorkspace,
  VISIBILITY,
  WORKSPACES_CHANGED,
  workspacesApi,
} from './workspace-client.js'
import { showWorkspace } from './workspaces-state.js'

export const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs))
    if (k === 'on') for (const [event, fn] of Object.entries(v)) node.addEventListener(event, fn)
    else if (v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : String(v))
  for (const child of children.flat())
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  return node
}

/** A dialog over the back office, closed with its own button. */
const dialog = (title, ...body) => pageDialog(title, body, 'crombolo-workspace-dialog')
/** One that makes something, dismissed with Cancel rather than Close. */
const asking = (title, ...body) => pageDialog(title, body, 'crombolo-workspace-dialog', 'Cancel')

const fieldLabel = (field) => field.split('|')[0].replace(/^@name/, 'Name')
const shown = (value) =>
  value === null || value === undefined
    ? '(empty)'
    : typeof value === 'string'
      ? value
      : JSON.stringify(value)

/**
 * Who can see a workspace, as two buttons of which one is pressed. `change` is told the
 * choice; `disabled` shows it without offering it.
 */
export function visibilityToggle(chosen, change = () => {}, disabled = false) {
  const group = el('span', { role: 'group', 'aria-label': 'Who can see this workspace' })
  group.style.cssText =
    'display:inline-flex;border:1px solid var(--uui-color-border);border-radius:var(--uui-border-radius);overflow:hidden;'
  const paint = () => {
    for (const button of group.children) {
      const on = button.value === group.dataset.value
      button.setAttribute('aria-pressed', on ? 'true' : 'false')
      button.style.cssText = `font:inherit;border:none;margin:0;padding:var(--uui-size-space-2) var(--uui-size-space-4);cursor:${disabled ? 'default' : 'pointer'};background:${on ? 'var(--uui-color-selected)' : 'var(--uui-color-surface)'};color:${on ? 'var(--uui-color-selected-contrast)' : 'var(--uui-color-text)'};`
    }
  }
  group.dataset.value = chosen === 'editors' ? 'editors' : 'members'
  for (const { value, label } of VISIBILITY)
    group.append(
      el(
        'button',
        {
          type: 'button',
          value,
          disabled,
          on: {
            click: () => {
              if (group.dataset.value === value) return
              group.dataset.value = value
              paint()
              change(value)
            },
          },
        },
        label,
      ),
    )
  paint()
  return group
}

/** The workspace a tab is in: the one chosen, or with one required, the person's own. */
export const here = (mine) => tabWorkspace(mine)

/** Switching reloads the screen in that workspace; none is Shared. */
const enter = (workspace) => {
  chooseWorkspace(workspace)
  location.reload()
}

/** The dialog a new workspace is named and described in; opened, the tab enters it. */
export function newWorkspace() {
  const name = el('input', { name: 'name', placeholder: 'What it is called', required: true })
  const description = el('textarea', {
    name: 'description',
    rows: 3,
    maxlength: 1000,
    placeholder: 'What it is for',
  })
  const visible = visibilityToggle('members')
  const status = el('p')
  const box = asking(
    'New workspace',
    el('label', {}, el('span', {}, 'Name'), name),
    el('label', {}, el('span', {}, 'Description'), description),
    el('label', {}, el('span', {}, 'Who can see this workspace'), visible),
    status,
    el(
      'button',
      {
        type: 'button',
        slot: 'actions',
        'data-primary': true,
        on: {
          click: async () => {
            try {
              const opened = await workspacesApi.open(name.value.trim(), {
                description: description.value.trim(),
                visibility: visible.dataset.value,
              })
              box.close()
              enter(opened)
            } catch (error) {
              status.textContent = error.message
            }
          },
        },
      },
      'Create',
    ),
  )
  name.focus()
}

/** Who a workspace is shared with, and who sees it. */
export async function sharePanel(current, view) {
  const list = el('ul')
  const email = el('input', { type: 'email', placeholder: 'their email' })
  const status = el('p')
  const fill = async () => {
    const { items } = await workspacesApi.members(current.key)
    list.replaceChildren(
      ...items.map((m) =>
        el(
          'li',
          {},
          `${m.name} <${m.email}>${m.owner ? ' (owner)' : ''} `,
          m.owner
            ? ''
            : el(
                'button',
                {
                  type: 'button',
                  on: {
                    click: async () => {
                      await workspacesApi.unshare(current.key, m.key)
                      await fill()
                    },
                  },
                },
                'Remove',
              ),
        ),
      ),
    )
  }
  const savePrivacy = (visibility) =>
    workspacesApi.privacy(current.key, { visibility }).then(
      () => (status.textContent = 'Saved.'),
      (e) => (status.textContent = e.message),
    )
  const visible = visibilityToggle(view?.visibility, savePrivacy)
  dialog(
    `Share ${current.name}`,
    list,
    el('label', {}, el('span', {}, 'Add'), email),
    el(
      'button',
      {
        type: 'button',
        'data-primary': true,
        on: {
          click: async () => {
            try {
              await workspacesApi.share(current.key, email.value.trim())
              email.value = ''
              await fill()
            } catch (e) {
              status.textContent = e.message
            }
          },
        },
      },
      'Share',
    ),
    el('label', {}, el('span', {}, 'Who can see this workspace'), visible),
    status,
  )
  await fill()
}

/** What a workspace changed, each change dropped from there. */
export async function changesPanel(current) {
  const [{ items }, diff] = await Promise.all([
    workspacesApi.changes(current.key),
    workspacesApi.diff(current.key).catch(() => ({ pages: [], files: [] })),
  ])
  const list = el('ul')
  for (const change of items) {
    const fields = (diff.pages ?? []).find((p) => p.key === change.key)?.fields ?? []
    const row = el(
      'li',
      {},
      el('strong', {}, change.name),
      ` ${change.kind === 'made' ? 'made here' : change.kind === 'changed' ? 'changed' : `to ${change.kind}`}`,
      fields.length > 0
        ? el(
            'ul',
            {},
            fields.map((f) =>
              el('li', {}, `${fieldLabel(f.field)}: ${shown(f.theirs)} → ${shown(f.mine)}`),
            ),
          )
        : '',
      el(
        'button',
        {
          type: 'button',
          on: {
            click: async () => {
              await workspacesApi.drop(current.key, change.key).catch(() => {})
              row.remove()
            },
          },
        },
        'Drop this change',
      ),
    )
    list.append(row)
  }
  for (const file of diff.files ?? [])
    list.append(el('li', {}, el('strong', {}, file.path), ' changed'))
  dialog(
    `Changes in ${current.name}`,
    items.length + (diff.files ?? []).length > 0
      ? list
      : el('p', {}, 'Nothing has changed here yet.'),
  )
}

export default class CromboloWorkspaceSwitchElement extends UmbLitElement {
  static properties = {
    _open: { state: true },
    _at: { state: true },
    _items: { state: true },
    _changes: { state: true },
  }

  #mine = { enabled: false, required: false, mayMerge: false }
  #workspaces = []

  constructor() {
    super()
    this._open = false
    this._items = []
    this._changes = 0
  }

  async connectedCallback() {
    super.connectedCallback()
    document.addEventListener('pointerdown', this.#closeFromOutside, true)
    document.addEventListener('keydown', this.#closeOnEscape)
    window.addEventListener(WORKSPACES_CHANGED, this.#changed)
    await this.#refresh()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    document.removeEventListener('pointerdown', this.#closeFromOutside, true)
    document.removeEventListener('keydown', this.#closeOnEscape)
    window.removeEventListener(WORKSPACES_CHANGED, this.#changed)
  }

  /** Something was saved, or a workspace renamed: its name and its count are read again. */
  #changed = async () => {
    await this.#refresh()
    this.requestUpdate()
  }

  /** A press anywhere but on the switch or its list closes the list. */
  #closeFromOutside = (event) => {
    if (this._open && !event.composedPath().includes(this)) this._open = false
  }

  #closeOnEscape = (event) => {
    if (this._open && event.key === 'Escape') this._open = false
  }

  async #refresh() {
    this.#mine = await workspacesApi.mine().catch(() => this.#mine)
    if (!this.#mine.enabled) return this.requestUpdate()
    this.#workspaces = (await workspacesApi.list().catch(() => ({ items: [] }))).items ?? []
    // Renamed since this tab entered it: the tab keeps the name it has now.
    const chosen = currentWorkspace()
    const named = chosen ? this.#workspaces.find((w) => w.key === chosen.key) : undefined
    if (named && named.name !== chosen.name) chooseWorkspace({ ...chosen, name: named.name })
    const current = this.#current()
    this._changes = current
      ? ((await workspacesApi.changes(current.key).catch(() => ({ items: [] }))).items ?? []).length
      : 0
    this._items = menuFor({
      current,
      workspaces: this.#workspaces,
      mayMerge: this.#mine.mayMerge,
      changes: this._changes,
      required: this.#mine.required,
    })
  }

  #current() {
    return here(this.#mine)
  }

  async #act(item) {
    this._open = false
    const current = this.#current()
    if (item.action === 'shared')
      return enter(this.#mine.required ? { key: 'shared', name: 'Shared' } : null)
    if (item.action === 'enter') return enter(item.workspace)
    if (item.action === 'changes') return changesPanel(current)
    if (item.action === 'merge') return showWorkspace(current.key, 'merge')
    if (item.action === 'address') {
      const opened = await workspacesApi.address(current.key).catch((e) => ({ error: e.message }))
      if (opened.url) window.open(opened.url, '_blank', 'noopener')
    }
  }

  render() {
    if (!this.#mine.enabled) return nothing
    const current = this.#current()
    const label = current ? current.name : 'Shared'
    return html`<div class="switch">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded=${this._open ? 'true' : 'false'}
        @click=${async (event) => {
          // Fixed below the button, so the strip it sits in, which scrolls, never clips it.
          const { right, bottom } = event.currentTarget.getBoundingClientRect()
          // At the end of the strip, so the list is held to the button's right edge.
          this._at = { right: Math.max(0, window.innerWidth - right), top: bottom + 4 }
          // What it holds now: a page saved since the menu last opened counts.
          if (!this._open) await this.#refresh()
          this._open = !this._open
        }}
      >
        <span class="dot" style=${`background:${current ? colourOf(current.key) : 'transparent'}`}></span>
        ${label}${current && this._changes > 0 ? html` <span class="count">${this._changes}</span>` : nothing}
      </button>
      ${
        this._open
          ? html`<ul role="menu" style=${`right:${this._at?.right ?? 0}px;top:${this._at?.top ?? 0}px`}>
            ${this._items.map(
              (item, at) =>
                html`${
                  at > 0 && this._items[at - 1].section !== item.section
                    ? html`<li role="separator" class="divider"></li>`
                    : nothing
                }
                ${
                  item.section === 'workspaces' && this._items[at - 1]?.section !== 'workspaces'
                    ? html`<li role="presentation" class="heading">Workspaces</li>`
                    : nothing
                }
                <li role="none">
                  <button type="button" role="menuitem" aria-current=${item.current ? 'true' : 'false'} @click=${() => this.#act(item)}>
                    ${
                      item.section === 'actions'
                        ? nothing
                        : html`<span
                            class="dot"
                            style=${`background:${item.workspace ? colourOf(item.workspace.key) : 'transparent'}`}
                          ></span>`
                    }
                    ${item.label}
                  </button>
                </li>`,
            )}
          </ul>`
          : nothing
      }
    </div>`
  }

  static styles = css`
    .switch {
      position: relative;
      margin-left: var(--uui-size-space-2);
    }
    button {
      font: inherit;
      cursor: pointer;
    }
    .switch > button {
      display: inline-flex;
      align-items: center;
      gap: var(--uui-size-space-2);
      padding: var(--uui-size-space-1) var(--uui-size-space-3);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface);
      font-size: var(--uui-type-small-size);
    }
    .dot {
      flex: none;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 1px solid var(--uui-color-border);
    }
    .count {
      font-weight: 700;
    }
    ul {
      position: fixed;
      z-index: 1000;
      min-width: 220px;
      margin: 0;
      padding: var(--uui-size-space-1);
      list-style: none;
      background: var(--uui-color-surface);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      box-shadow: var(--uui-shadow-depth-2);
    }
    .divider {
      height: 1px;
      margin: var(--uui-size-space-1) 0;
      background: var(--uui-color-border);
    }
    .heading {
      padding: var(--uui-size-space-1) var(--uui-size-space-3) 0;
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
    }
    li button {
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-2);
      width: 100%;
      text-align: left;
      padding: var(--uui-size-space-2) var(--uui-size-space-3);
      border: none;
      background: none;
    }
    li button:hover,
    li button[aria-current='true'] {
      background: var(--uui-color-surface-emphasis);
    }
  `
}

customElements.define('crombolo-workspace-switch', CromboloWorkspaceSwitchElement)

/**
 * Deletes a workspace once the person has said so, knowing how many changes go with it.
 * Answers whether it went; the one the tab is in leaves the tab in Shared.
 */
export async function deleteWorkspace(host, workspace, mine) {
  const changes = (
    (await workspacesApi.changes(workspace.key).catch(() => ({ items: [] }))).items ?? []
  ).length
  const confirmed = await ask(host, {
    headline: `Delete ${workspace.name}`,
    content: `The workspace${changes > 0 ? ` and its ${changes} change${changes === 1 ? '' : 's'}` : ''} will be lost. This can't be undone`,
    confirmLabel: 'Delete',
  })
  if (!confirmed) return false
  try {
    await workspacesApi.discard(workspace.key)
  } catch (error) {
    dialog(`Delete ${workspace.name}`, el('p', {}, error.message))
    return false
  }
  if (here(mine)?.key === workspace.key)
    enter(mine.required ? { key: 'shared', name: 'Shared' } : null)
  return true
}

/**
 * The buttons before the switch, at the end of the strip (story 428), each an icon with its words as
 * a tooltip: a new workspace, and for the one the tab is in, merging it, sharing it and
 * deleting it. In Shared those three do nothing, and say why.
 */
export class CromboloWorkspaceControlsElement extends UmbLitElement {
  static properties = {
    _ready: { state: true },
    _tip: { state: true },
  }

  #mine = { enabled: false, required: false }
  #workspaces = []
  #changes = 0

  constructor() {
    super()
    this._ready = false
  }

  #reading = false

  async connectedCallback() {
    super.connectedCallback()
    this.#mine = await workspacesApi.mine().catch(() => this.#mine)
    await this.#refresh()
    this._ready = true
    for (const event of ['changestate', 'popstate', 'navigationend', WORKSPACES_CHANGED])
      window.addEventListener(event, this.#refresh)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    for (const event of ['changestate', 'popstate', 'navigationend', WORKSPACES_CHANGED])
      window.removeEventListener(event, this.#refresh)
  }

  /**
   * What the workspace holds now: read as the back office moves about and as the pointer
   * comes to the buttons, since a page saved since changes what Merge may do.
   */
  #refresh = async () => {
    if (!this.#mine.enabled || this.#reading) return
    this.#reading = true
    try {
      this.#workspaces = (await workspacesApi.list().catch(() => ({ items: [] }))).items ?? []
      const current = here(this.#mine)
      this.#changes = current
        ? ((await workspacesApi.changes(current.key).catch(() => ({ items: [] }))).items ?? [])
            .length
        : 0
      this.requestUpdate()
    } finally {
      this.#reading = false
    }
  }

  render() {
    if (!this._ready || !this.#mine.enabled) return nothing
    const current = here(this.#mine)
    const { merge, share, remove } = controlsFor({
      current,
      workspaces: this.#workspaces,
      mayMerge: this.#mine.mayMerge === true,
      changes: this.#changes,
    })
    const view = current ? this.#workspaces.find((w) => w.key === current.key) : undefined
    // Its words beside it while the pointer or the keyboard is on it, a greyed one too.
    const tip = (text) => (event) => {
      const { right, bottom } = event.currentTarget.getBoundingClientRect()
      this._tip = { text, right: Math.max(0, window.innerWidth - right), top: bottom + 6 }
    }
    const untip = () => {
      this._tip = undefined
    }
    const button = (label, icon, does, enabled = true, why = undefined, color = 'default') =>
      html`<span
        class="control"
        @mouseenter=${tip(why ?? label)}
        @mouseleave=${untip}
        @focusin=${tip(why ?? label)}
        @focusout=${untip}
      >
        <uui-button
          compact
          look="default"
          color=${color}
          label=${label}
          ?disabled=${!enabled}
          @click=${() => {
            untip()
            does()
          }}
        >
          <uui-icon name=${icon}></uui-icon>
        </uui-button>
      </span>`
    return html`<div class="controls" @mouseenter=${this.#refresh} @focusin=${this.#refresh}>
      ${button('New workspace', 'icon-add', () => newWorkspace())}
      ${button(
        'Merge into Shared',
        'icon-merge',
        () => showWorkspace(current.key, 'merge'),
        merge.enabled,
        merge.why,
      )}
      ${button('Share this workspace', 'icon-share', () => sharePanel(current, view), share.enabled, share.why)}
      ${button(
        'Delete this workspace',
        'icon-trash',
        () => deleteWorkspace(this, current, this.#mine),
        remove.enabled,
        remove.why,
        'danger',
      )}
      ${
        this._tip
          ? html`<div
              class="tip"
              role="tooltip"
              style=${`right:${this._tip.right}px;top:${this._tip.top}px`}
            >
              ${this._tip.text}
            </div>`
          : nothing
      }
    </div>`
  }

  static styles = css`
    .controls {
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-1);
      white-space: nowrap;
    }
    uui-icon {
      font-size: 16px;
    }
    .control {
      display: inline-flex;
    }
    .tip {
      position: fixed;
      z-index: 1000;
      padding: var(--uui-size-space-1) var(--uui-size-space-3);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-text);
      color: var(--uui-color-surface);
      font-size: var(--uui-type-small-size);
      white-space: nowrap;
      pointer-events: none;
    }
  `
}

customElements.define('crombolo-workspace-controls', CromboloWorkspaceControlsElement)
