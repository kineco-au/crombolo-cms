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
 * An autocomplete box: what is chosen as tags, each removable, and a box that offers the
 * `options` matching what is typed, picked with a click or the arrow keys and Enter.
 * `add` and `remove` are told the key; a false answer leaves the tags as they were.
 */
export function tagPicker(label, options, chosen, { add, remove }) {
  const picked = new Set(chosen.map((k) => String(k).toLowerCase()))
  const id = `crombolo-tags-${Math.random().toString(36).slice(2, 8)}`
  const tags = el('div', { class: 'tags' })
  tags.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--uui-size-space-2,6px);'
  const input = el('input', {
    type: 'text',
    role: 'combobox',
    'aria-label': label,
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': id,
    placeholder: `Add ${label.toLowerCase()}…`,
    autocomplete: 'off',
  })
  input.style.cssText =
    'width:100%;box-sizing:border-box;font:inherit;padding:var(--uui-size-space-2,6px) var(--uui-size-space-3,9px);border:1px solid var(--uui-color-border-standalone,var(--uui-color-border));border-radius:var(--uui-border-radius);background:var(--uui-color-surface);color:var(--uui-color-text);'
  const list = el('ul', { id, role: 'listbox', 'aria-label': label })
  // In the flow, not floating: it pushes what follows down, so it never covers the next
  // box or is cut off at a dialog's edge.
  list.style.cssText =
    'margin:2px 0 0;padding:4px 0;list-style:none;max-height:200px;overflow:auto;background:var(--uui-color-surface,#fff);border:1px solid var(--uui-color-border);border-radius:var(--uui-border-radius);'
  const shown = (on) => {
    list.style.display = on ? 'block' : 'none'
    input.setAttribute('aria-expanded', on ? 'true' : 'false')
  }
  shown(false)
  let matches = []
  let active = 0
  const byKey = (key) => options.find((o) => o.key === key)
  const drawTags = () =>
    tags.replaceChildren(
      ...[...picked].map((key) => {
        const option = byKey(key)
        const name = option?.name ?? key
        const tag = el(
          'span',
          { class: 'tag' },
          name,
          el(
            'button',
            {
              type: 'button',
              'aria-label': `Remove ${name}`,
              title: `Remove ${name}`,
              on: {
                click: async () => {
                  if ((await remove(key)) === false) return
                  picked.delete(key)
                  drawTags()
                },
              },
            },
            '×',
          ),
        )
        tag.style.cssText =
          'display:inline-flex;align-items:center;gap:4px;padding:2px 4px 2px 10px;border-radius:12px;background:var(--uui-color-surface-alt);border:1px solid var(--uui-color-border);'
        tag.lastChild.style.cssText =
          'border:none;background:none;cursor:pointer;font:inherit;line-height:1;padding:0 4px;'
        return tag
      }),
    )
  const close = () => {
    shown(false)
    input.removeAttribute('aria-activedescendant')
  }
  const pick = async (option) => {
    if (!option) return
    if ((await add(option.key)) === false) return
    picked.add(option.key)
    input.value = ''
    close()
    drawTags()
  }
  const drawList = () => {
    const q = input.value.trim().toLowerCase()
    matches = options
      .filter((o) => !picked.has(o.key))
      .filter((o) => !q || `${o.name} ${o.detail ?? ''}`.toLowerCase().includes(q))
      .slice(0, 8)
    active = Math.min(active, Math.max(matches.length - 1, 0))
    list.replaceChildren(
      ...(matches.length === 0
        ? [el('li', { role: 'presentation' }, q ? 'No match' : 'Nothing more to add')]
        : matches.map((o, i) => {
            const item = el(
              'li',
              {
                id: `${id}-${i}`,
                role: 'option',
                'aria-selected': i === active ? 'true' : 'false',
                on: {
                  mousedown: (event) => {
                    event.preventDefault()
                    pick(o)
                  },
                },
              },
              el('span', {}, o.name),
              o.detail ? el('span', { class: 'detail' }, o.detail) : '',
            )
            item.style.cssText = `display:flex;justify-content:space-between;gap:12px;padding:4px 10px;cursor:pointer;${i === active ? 'background:var(--uui-color-surface-emphasis);' : ''}`
            if (o.detail) item.lastChild.style.cssText = 'color:var(--uui-color-text-alt);'
            return item
          })),
    )
    for (const li of list.children)
      if (li.getAttribute('role') === 'presentation')
        li.style.cssText = 'padding:4px 10px;color:var(--uui-color-text-alt);'
    shown(true)
    if (matches.length > 0) input.setAttribute('aria-activedescendant', `${id}-${active}`)
  }
  input.addEventListener('input', () => {
    active = 0
    drawList()
  })
  input.addEventListener('focus', drawList)
  input.addEventListener('blur', close)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (list.style.display === 'none') return drawList()
      const step = event.key === 'ArrowDown' ? 1 : -1
      active = (active + step + matches.length) % Math.max(matches.length, 1)
      drawList()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(matches[active])
    } else if (event.key === 'Escape' && list.style.display !== 'none') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  })
  drawTags()
  const box = el('div', {}, input, list)
  const field = el('div', { class: 'tag-picker' }, el('span', { class: 'label' }, label), tags, box)
  field.style.cssText = 'display:grid;gap:var(--uui-size-space-2,6px);'
  return field
}

/**
 * Who sees a workspace besides its owner and the administrators: the groups and people it
 * is shared with, each chosen in an autocomplete box. `target` saves each choice as it is
 * made: a workspace's own calls, or, for one not yet made, a draft. One every editor may
 * look at (`visibility: 'editors'`, from the command line) says so, and can be limited to
 * those chosen. `say` reports what happened.
 */
export function audienceEditor(visibility, shared, target, say = () => {}) {
  const now = {
    groups: shared.groups.map((g) => g.key),
    people: shared.people.map((p) => p.key),
  }
  const editor = el('div', { class: 'audience' })
  editor.style.cssText = 'display:grid;gap:var(--uui-size-space-4,12px);'
  if (visibility === 'editors') {
    const note = el('p', {}, 'Every editor can look at it too. ')
    note.style.cssText = 'margin:0;'
    const limit = el(
      'button',
      {
        type: 'button',
        class: 'link',
        on: {
          click: async () => {
            try {
              await target.visibility('members')
              note.remove()
              say('Only those chosen below, as well as you and the administrators, see it now.')
            } catch (error) {
              say(error.message)
            }
          },
        },
      },
      'Limit it to those chosen below',
    )
    limit.style.cssText =
      'border:none;background:none;padding:0;font:inherit;color:var(--uui-color-interactive);text-decoration:underline;cursor:pointer;'
    note.append(limit)
    editor.append(note)
  }
  const guard = (fn) => async (key) => {
    try {
      await fn(key)
    } catch (error) {
      say(error.message)
      return false
    }
  }
  workspacesApi
    .shareOptions()
    .catch(() => ({ users: [], groups: [] }))
    .then((options) => {
      editor.append(
        tagPicker(
          'Groups',
          (options.groups ?? []).map((g) => ({ key: g.key, name: g.name })),
          now.groups,
          {
            add: guard(async (key) => {
              await target.addGroup(key)
              now.groups.push(key)
            }),
            remove: guard(async (key) => {
              await target.removeGroup(key)
              now.groups = now.groups.filter((k) => k !== key)
            }),
          },
        ),
        tagPicker(
          'People',
          (options.users ?? [])
            .filter((u) => !shared.ownerKey || u.key !== shared.ownerKey)
            .map((u) => ({ key: u.key, name: u.name, detail: u.email })),
          now.people,
          {
            add: guard(async (key) => {
              await target.addPerson(key)
              now.people.push(key)
            }),
            remove: guard(async (key) => {
              await target.removePerson(key)
              now.people = now.people.filter((k) => k !== key)
            }),
          },
        ),
      )
    })
  return editor
}

/** A workspace's own calls, for `audienceEditor`; `saved` is told after each. */
export const workspaceTarget = (view, saved = () => {}) => {
  const then = (promise) => promise.then(() => saved())
  return {
    visibility: (visibility) => then(workspacesApi.privacy(view.key, { visibility })),
    addGroup: (key) => then(workspacesApi.shareGroup(view.key, key)),
    removeGroup: (key) => then(workspacesApi.unshareGroup(view.key, key)),
    addPerson: (key) => then(workspacesApi.share(view.key, key)),
    removePerson: (key) => then(workspacesApi.unshare(view.key, key)),
  }
}

/** What a workspace is shared with, by name, from its members' answer. */
export const sharedFrom = (members) => ({
  ownerKey: (members.items ?? []).find((m) => m.owner)?.key,
  people: (members.items ?? []).filter((m) => !m.owner).map((m) => ({ key: m.key, name: m.name })),
  groups: (members.groups ?? []).map((g) => ({ key: g.key, name: g.name })),
})

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
  const draft = { visibility: 'members', groups: new Set(), people: new Set() }
  const status = el('p')
  const audience = audienceEditor(
    'members',
    { groups: [], people: [] },
    {
      visibility: async (v) => {
        draft.visibility = v
      },
      addGroup: async (k) => draft.groups.add(k),
      removeGroup: async (k) => draft.groups.delete(k),
      addPerson: async (k) => draft.people.add(k),
      removePerson: async (k) => draft.people.delete(k),
    },
    (said) => {
      status.textContent = said === 'Saved.' ? '' : said
    },
  )
  const box = asking(
    'New workspace',
    el('label', {}, el('span', {}, 'Name'), name),
    el('label', {}, el('span', {}, 'Description'), description),
    el('div', { class: 'field' }, el('span', {}, 'Shared with'), audience),
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
                visibility: draft.visibility,
              })
              for (const key of draft.groups) await workspacesApi.shareGroup(opened.key, key)
              for (const key of draft.people) await workspacesApi.share(opened.key, key)
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

/** Who sees a workspace, and the groups and people it is shared with. */
export async function sharePanel(current, view) {
  const status = el('p', { role: 'status' })
  const members = await workspacesApi.members(current.key).catch(() => ({ items: [], groups: [] }))
  const shared = sharedFrom(members)
  dialog(
    `Share ${current.name}`,
    el(
      'div',
      { class: 'field' },
      el('span', {}, 'Shared with'),
      audienceEditor(
        view?.visibility,
        shared,
        workspaceTarget(current, () => window.dispatchEvent(new CustomEvent(WORKSPACES_CHANGED))),
        (said) => {
          status.textContent = said
        },
      ),
    ),
    status,
  )
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
