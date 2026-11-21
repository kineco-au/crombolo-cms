/**
 * The workspace switch at the head of Content (story 384): where this tab is, Shared
 * or a workspace in its colour, and what can be done from there: switch, open a new
 * one, see its changes and drop one, merge it into Shared, share it, open it at its
 * address, and see every workspace. Switching reloads the screen in that workspace.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import {
  chooseWorkspace,
  colourOf,
  currentWorkspace,
  menuFor,
  workspacesApi,
} from './workspace-client.js'

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs))
    if (k === 'on') for (const [event, fn] of Object.entries(v)) node.addEventListener(event, fn)
    else if (v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : String(v))
  for (const child of children.flat())
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  return node
}

/** A dialog over the back office, closed with its own button. */
function dialog(title, ...body) {
  const box = el('dialog', { class: 'crombolo-workspace-dialog' }, el('h3', {}, title), ...body)
  const close = el('button', { type: 'button', on: { click: () => box.close() } }, 'Close')
  box.append(close)
  box.addEventListener('close', () => box.remove())
  document.body.append(box)
  box.showModal()
  return box
}

const fieldLabel = (field) => field.split('|')[0].replace(/^@name/, 'Name')
const shown = (value) =>
  value === null || value === undefined
    ? '(empty)'
    : typeof value === 'string'
      ? value
      : JSON.stringify(value)

export default class CromboloWorkspaceSwitchElement extends UmbLitElement {
  static properties = {
    _open: { state: true },
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
    await this.#refresh()
  }

  async #refresh() {
    this.#mine = await workspacesApi.mine().catch(() => this.#mine)
    if (!this.#mine.enabled) return this.requestUpdate()
    this.#workspaces = (await workspacesApi.list().catch(() => ({ items: [] }))).items ?? []
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

  /** The workspace this tab is in: the one chosen, or with one required, the person's own. */
  #current() {
    const chosen = currentWorkspace()
    if (chosen?.key === 'shared') return null
    if (chosen) return chosen
    return this.#mine.required && this.#mine.workspace ? this.#mine.workspace : null
  }

  #enter(workspace) {
    chooseWorkspace(workspace)
    location.reload()
  }

  async #act(item) {
    this._open = false
    const current = this.#current()
    if (item.action === 'shared')
      return this.#enter(this.#mine.required ? { key: 'shared', name: 'Shared' } : null)
    if (item.action === 'enter') return this.#enter(item.workspace)
    if (item.action === 'new') return this.#newWorkspace()
    if (item.action === 'changes') return this.#changesPanel(current)
    if (item.action === 'merge') return this.#mergePanel(current)
    if (item.action === 'share') return this.#sharePanel(current)
    if (item.action === 'all') return this.#allPanel()
    if (item.action === 'address') {
      const opened = await workspacesApi.address(current.key).catch((e) => ({ error: e.message }))
      if (opened.url) window.open(opened.url, '_blank', 'noopener')
    }
  }

  #newWorkspace() {
    const name = el('input', { name: 'name', placeholder: 'What it is for', required: true })
    const editors = el('input', { type: 'checkbox', name: 'editors' })
    const tell = el('input', { type: 'checkbox', name: 'tell', checked: true })
    const status = el('p')
    const box = dialog(
      'New workspace',
      el('label', {}, 'Name ', name),
      el('label', {}, editors, ' Everyone who may edit can see it'),
      el('label', {}, tell, ' Tell others when they open something it changed'),
      status,
      el(
        'button',
        {
          type: 'button',
          on: {
            click: async () => {
              try {
                const opened = await workspacesApi.open(name.value.trim(), {
                  visibility: editors.checked ? 'editors' : 'members',
                  tellOthers: tell.checked,
                })
                box.close()
                this.#enter(opened)
              } catch (error) {
                status.textContent = error.message
              }
            },
          },
        },
        'Open it',
      ),
    )
    name.focus()
  }

  async #changesPanel(current) {
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

  async #mergePanel(current) {
    const body = el('div')
    const status = el('p')
    const accepted = new Set()
    const render = async () => {
      const plan = await workspacesApi.plan(current.key)
      body.replaceChildren()
      body.append(
        el('p', {}, `${plan.pages.length} page(s), ${plan.pending.length} move(s) or delete(s).`),
      )
      for (const c of plan.conflicts ?? [])
        body.append(
          el(
            'div',
            { class: 'conflict' },
            el(
              'p',
              {},
              `"${c.name ?? c.key}": ${c.words ?? fieldLabel(c.field)} was changed in Shared too.`,
            ),
            el(
              'button',
              {
                type: 'button',
                on: {
                  click: async () => {
                    await workspacesApi.answer(current.key, c.key, c.field, 'mine')
                    await render()
                  },
                },
              },
              'Keep mine',
            ),
            el(
              'button',
              {
                type: 'button',
                on: {
                  click: async () => {
                    await workspacesApi.answer(current.key, c.key, c.field, 'theirs')
                    await render()
                  },
                },
              },
              'Keep theirs',
            ),
          ),
        )
      for (const f of plan.findings ?? []) {
        const box = el('input', {
          type: 'checkbox',
          on: { change: (e) => (e.target.checked ? accepted.add(f.id) : accepted.delete(f.id)) },
        })
        body.append(el('label', {}, box, ` ${f.says}`))
      }
      const merge = el(
        'button',
        {
          type: 'button',
          disabled: (plan.conflicts ?? []).length > 0,
          on: {
            click: async () => {
              try {
                const done = await workspacesApi.merge(current.key, [...accepted])
                const waiting = done.forApproval?.length ?? 0
                status.textContent =
                  waiting > 0
                    ? `Merged; ${waiting} page(s) sent for approval.`
                    : 'Merged into Shared.'
                chooseWorkspace(this.#mine.required ? null : null)
                setTimeout(() => location.reload(), 800)
              } catch (error) {
                status.textContent = [error.message, ...(error.body?.blockers ?? [])].join(' ')
              }
            },
          },
        },
        'Merge into Shared',
      )
      body.append(merge)
    }
    dialog(`Merge ${current.name}`, body, status)
    await render()
  }

  async #sharePanel(current) {
    const list = el('ul')
    const email = el('input', { type: 'email', placeholder: 'their email' })
    const status = el('p')
    const view = this.#workspaces.find((w) => w.key === current.key)
    const editors = el('input', { type: 'checkbox', checked: view?.visibility === 'editors' })
    const tell = el('input', { type: 'checkbox', checked: view?.tellOthers !== false })
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
    const savePrivacy = () =>
      workspacesApi
        .privacy(current.key, {
          visibility: editors.checked ? 'editors' : 'members',
          tellOthers: tell.checked,
        })
        .then(
          () => (status.textContent = 'Saved.'),
          (e) => (status.textContent = e.message),
        )
    editors.addEventListener('change', savePrivacy)
    tell.addEventListener('change', savePrivacy)
    dialog(
      `Share ${current.name}`,
      list,
      el('label', {}, 'Add ', email),
      el(
        'button',
        {
          type: 'button',
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
      el('label', {}, editors, ' Everyone who may edit can see it'),
      el('label', {}, tell, ' Tell others when they open something it changed'),
      status,
    )
    await fill()
  }

  async #allPanel() {
    const open = el(
      'ul',
      {},
      this.#workspaces
        .filter((w) => w.state === 'open')
        .map((w) =>
          el(
            'li',
            {},
            el('span', { style: `color:${colourOf(w.key)}` }, '●'),
            ` ${w.name}`,
            `, last changed ${w.updatedAt.slice(0, 16).replace('T', ' ')}`,
            w.member ? '' : ' (to look at)',
          ),
        ),
    )
    const closed = el('ul')
    const response = await fetch(
      `${(document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')}/crombolo/api/changes?take=20`,
      { credentials: 'include' },
    ).catch(() => undefined)
    const changes = response?.ok ? ((await response.json()).items ?? []) : []
    for (const c of changes.filter((c) => c.kind === 'merge'))
      closed.append(
        el(
          'li',
          {},
          `${c.name ?? 'A workspace'}, merged ${String(c.startedAt).slice(0, 16).replace('T', ' ')}`,
        ),
      )
    dialog('Workspaces', el('h4', {}, 'Open'), open, el('h4', {}, 'Merged'), closed)
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
        @click=${async () => {
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
          ? html`<ul role="menu">
            ${this._items.map(
              (item) =>
                html`<li role="none">
                  <button type="button" role="menuitem" aria-current=${item.current ? 'true' : 'false'} @click=${() => this.#act(item)}>
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
      margin-left: auto;
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
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 1px solid var(--uui-color-border);
    }
    .count {
      font-weight: 700;
    }
    ul {
      position: absolute;
      right: 0;
      z-index: 10;
      min-width: 220px;
      margin: 4px 0 0;
      padding: var(--uui-size-space-1);
      list-style: none;
      background: var(--uui-color-surface);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      box-shadow: var(--uui-shadow-depth-2);
    }
    li button {
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
