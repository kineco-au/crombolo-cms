/**
 * The workspace chosen in the list at Workspaces: what it is for, who sees it, who made
 * it and when, who it is shared with and what it changed. Its owner renames it, says
 * what it is for and who sees it; it is entered, merged, shared and deleted from here.
 * Shared, chosen there, says what Shared is.
 */
import { DocumentService } from '@umbraco-cms/backoffice/external/backend-api'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { ask } from './ask.js'
import {
  chooseWorkspace,
  colourOf,
  controlsFor,
  fileLink,
  givenColour,
  inkOn,
  mergeRows,
  mergeSections,
  PALETTE,
  PALETTE_NAMES,
  whoSees,
  workspaceFacts,
  workspacesApi,
} from './workspace-client.js'
import {
  audienceEditor,
  deleteWorkspace,
  here,
  sharedFrom,
  workspaceTarget,
} from './workspace-switch.js'
import {
  chosenChange,
  chosenView,
  chosenWorkspace,
  mergedAddress,
  showWorkspace,
  watchWorkspaces,
  workspacesChanged,
} from './workspaces-state.js'

/** What a merge sent for approval, kept in this tab for the summary it reloads into. */
const APPROVALS_KEY = 'crombolo.merge.approvals.'

const when = (iso) => {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleString()
}

const changeWords = (change) =>
  change.kind === 'made' ? 'made here' : change.kind === 'changed' ? 'changed' : `to ${change.kind}`

const mergeField = (field) =>
  String(field)
    .split('|')[0]
    .replace(/^@name/, 'Name')

/** A value as a person reads it: text as it is, anything else as it is stored, cut short. */
const mergeValue = (value) => {
  if (value === null || value === undefined || value === '') return '(empty)'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 400 ? `${text.slice(0, 400)}…` : text
}

/** A field as a person names it: `seoNoindex|es` reads "Seo noindex (es)". */
const fieldName = (field) => {
  const text = String(field)
  if (text === '@name') return 'Name'
  if (text === '@template') return 'Template'
  if (text.startsWith('@name:')) return `Name (${text.slice(6)})`
  const [alias, culture, segment] = text.split('|')
  const words = alias
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
  const where = [culture, segment].filter(Boolean).join(', ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}${where ? ` (${where})` : ''}`
}

/** A value that can be read as it is, or undefined for one too rich to show in a line. */
const plainValue = (value) => {
  if (value === null || value === undefined || value === '') return '(empty)'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return undefined
  return value.length > 600 ? `${value.slice(0, 600)}…` : value
}

const PENDING_SAYS = {
  move: 'Moved to another place in the tree.',
  sort: 'Put in another order among the pages beside it.',
  trash: 'Deleted: it goes to the recycle bin in Shared.',
  delete: 'Deleted for good.',
  gone: 'It is no longer in Shared.',
}

/** What a merge does to a file of the site, from what the workspace and Shared hold of it. */
const fileSays = (file) =>
  file.mine === null || file.mine === undefined
    ? 'Removed.'
    : file.base === null || file.base === undefined
      ? 'New.'
      : 'Changed.'

const PENDING_WORDS = {
  move: 'Moved',
  sort: 'Put in another order',
  trash: 'Deleted',
  delete: 'Deleted',
  gone: 'Gone from Shared',
}

/** What a merge does to a page, in words: its name and how many of its fields, never their aliases. */
const mergePageWords = (page) => {
  const changes = page.changes ?? []
  const named = changes.some((c) => c.startsWith('its name'))
  const template = changes.includes('its template')
  const fields = changes.filter((c) => !c.startsWith('its ')).length
  const what = [
    named ? 'name' : '',
    template ? 'template' : '',
    fields > 0 ? `${fields} field${fields === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return [
    page.made
      ? 'New page'
      : what.length > 0
        ? `${what.join(', ').replace(/^./, (c) => c.toUpperCase())} changed`
        : 'Unchanged',
    page.publish ? 'published' : '',
    page.unpublish ? 'unpublished' : '',
  ]
    .filter(Boolean)
    .join(', ')
}

export default class CromboloWorkspacesPageElement extends UmbLitElement {
  static properties = {
    _ready: { state: true },
    _chosen: { state: true },
    _status: { state: true },
    _detail: { state: true },
    _merge: { state: true },
    _summary: { state: true },
    _palette: { state: true },
  }

  #mine = { enabled: false, required: false }
  #workspaces = []
  #audienceFor
  #stop

  constructor() {
    super()
    this._ready = false
    this._chosen = 'shared'
    this._status = ''
    this._detail = { members: [], changes: [] }
    this._merge = undefined
  }

  async connectedCallback() {
    super.connectedCallback()
    this.#stop = watchWorkspaces(async (what) => {
      if (what === 'changed') await this.#list()
      await this.#choose(chosenWorkspace())
      // A merge's summary is chosen by the address alone.
      this.requestUpdate()
    })
    this.#mine = await workspacesApi.mine().catch(() => this.#mine)
    if (this.#mine.enabled) {
      await this.#list()
      if (chosenWorkspace() !== undefined) await this.#choose(chosenWorkspace())
      // A merge's summary is shown where the address says, not moved to the tab's workspace.
      else if (!(chosenView() === 'merged' && chosenChange()))
        showWorkspace(here(this.#mine)?.key ?? 'shared', 'info', true)
    }
    this._ready = true
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.#stop?.()
  }

  async #list() {
    this.#workspaces = (await workspacesApi.list().catch(() => ({ items: [] }))).items ?? []
  }

  #view() {
    return this.#workspaces.find((w) => w.key === this._chosen)
  }

  async #choose(key) {
    if (key !== this._chosen) this._status = ''
    this._chosen = this.#workspaces.some((w) => w.key === key) ? key : 'shared'
    const view = this.#view()
    if (!view) {
      this._detail = { members: [], changes: [] }
      this._merge = undefined
      return
    }
    if (chosenView() === 'merge' || chosenView() === 'changes') return this.#plan(view)
    this._merge = undefined
    const [members, changes] = await Promise.all([
      workspacesApi.members(view.key).catch(() => ({ items: [], groups: [] })),
      workspacesApi.changes(view.key).catch(() => ({ items: [] })),
    ])
    if (this._chosen === view.key)
      this._detail = {
        members: members.items ?? [],
        groups: members.groups ?? [],
        changes: changes.items ?? [],
      }
  }

  /** What merging it would do, read again after each conflict is settled. */
  async #plan(view) {
    const was = this._merge?.key === view.key ? this._merge : undefined
    try {
      const [plan, diff] = await Promise.all([
        workspacesApi.plan(view.key),
        workspacesApi.diff(view.key).catch(() => ({ pages: [], files: [] })),
      ])
      if (this._chosen !== view.key) return
      this._merge = {
        key: view.key,
        plan,
        diff,
        accepted: new Set(
          [...(was?.accepted ?? [])].filter((id) => plan.findings?.some((f) => f.id === id)),
        ),
        settled: was?.settled ?? [],
        says: was?.says ?? '',
        done: false,
      }
    } catch (error) {
      this._merge = {
        key: view.key,
        plan: { pages: [], pending: [], conflicts: [], findings: [] },
        diff: { pages: [], files: [] },
        accepted: new Set(),
        settled: [],
        says: error.message,
        done: false,
      }
    }
  }

  async #settle(view, conflict, side) {
    try {
      await workspacesApi.answer(view.key, conflict.key, conflict.field, side)
      this._merge = { ...this._merge, settled: [...this._merge.settled, { ...conflict, side }] }
    } catch (error) {
      this._merge = { ...this._merge, says: error.message }
    }
    await this.#plan(view)
    workspacesChanged()
  }

  #accept(id, yes) {
    const accepted = new Set(this._merge.accepted)
    if (yes) accepted.add(id)
    else accepted.delete(id)
    this._merge = { ...this._merge, accepted }
  }

  async #mergeNow(view) {
    this._merge = { ...this._merge, says: 'Merging…' }
    try {
      const done = await workspacesApi.merge(view.key, [...this._merge.accepted])
      // The workspace is closed: a tab that was in it is in Shared from here.
      if (here(this.#mine)?.key === view.key) chooseWorkspace(null)
      if (done.changeId) {
        // What went for approval is known only here: kept for the summary it reloads into.
        try {
          sessionStorage.setItem(
            `${APPROVALS_KEY}${done.changeId}`,
            JSON.stringify((done.forApproval ?? []).map((p) => p.key)),
          )
        } catch {}
        location.assign(mergedAddress(done.changeId))
        return
      }
      this._merge = { ...this._merge, done: true, says: 'Merged into Shared.' }
      setTimeout(() => {
        showWorkspace('shared', 'info', true)
        location.reload()
      }, 900)
    } catch (error) {
      this._merge = {
        ...this._merge,
        says: [error.message, ...(error.body?.blockers ?? [])].join(' '),
      }
    }
  }

  /** A past merge's summary: its recorded change, and the pages it touched as they are now. */
  async #loadSummary(id) {
    this._summary = { id, loading: true }
    try {
      const base = (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(
        /\/$/,
        '',
      )
      const response = await fetch(`${base}/crombolo/api/changes/${encodeURIComponent(id)}`, {
        credentials: 'include',
      })
      if (!response.ok) throw new Error('That merge could not be found.')
      const change = await response.json()
      const keys = [...new Set((change.pageChanges ?? []).map((p) => p.key))]
      const [found, addresses] = keys.length
        ? await Promise.all([
            DocumentService.getItemDocument({ query: { id: keys } }).then((r) => r.data ?? []),
            DocumentService.getDocumentUrls({ query: { id: keys } })
              .then((r) => r.data ?? [])
              .catch(() => []),
          ])
        : [[], []]
      const items = new Map(
        found.map((d) => [
          String(d.id).toLowerCase(),
          {
            name: d.variants?.[0]?.name,
            trashed: d.isTrashed,
            published: (d.variants ?? []).some((v) => String(v.state).startsWith('Published')),
          },
        ]),
      )
      const urls = new Map(
        addresses.map((a) => [
          String(a.id).toLowerCase(),
          a.urlInfos?.find((u) => u.url && !u.url.startsWith('#'))?.url,
        ]),
      )
      let forApproval = []
      try {
        forApproval = JSON.parse(sessionStorage.getItem(`${APPROVALS_KEY}${id}`) ?? '[]')
      } catch {}
      if (this._summary?.id !== id) return
      this._summary = { id, change, sections: mergeSections(change, items, forApproval), urls }
    } catch (error) {
      if (this._summary?.id === id) this._summary = { id, says: error.message }
    }
  }

  #merged(id) {
    if (this._summary?.id !== id) {
      this.#loadSummary(id)
      return html`<section class="detail"><p class="hint">Loading…</p></section>`
    }
    const { change, sections, urls, says, loading } = this._summary
    if (loading) return html`<section class="detail"><p class="hint">Loading…</p></section>`
    if (says) return html`<section class="detail"><p>${says}</p></section>`
    const name = (change.name ?? 'A workspace').replace(/^Merged\s+/i, '').replace(/^"|"$/g, '')
    const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
    const pages = sections.filter((x) => x.kind !== 'files').reduce((n, x) => n + x.rows.length, 0)
    const files = sections.find((x) => x.kind === 'files')?.rows.length ?? 0
    const edit = (key) =>
      new URL(`section/content/workspace/document/edit/${key}`, document.baseURI).pathname
    return html`<section class="detail"><div class="merge summary">
        <button type="button" class="link back" @click=${() => showWorkspace('shared')}>← Workspaces</button>
        <div class="head">
          <span class="dot" style=${change.workspaceKey ? `background:${colourOf(change.workspaceKey)}` : ''}></span>
          <h2>${name}</h2>
          <span class="merged-badge"><uui-icon name="icon-check"></uui-icon> Merged into Shared</span>
        </div>
        <p class="hint">Merged ${when(change.finishedAt ?? change.startedAt)}</p>
        <div class="chips">
          <span class="chip">${count(pages, 'page')}</span>
          ${files > 0 ? html`<span class="chip">${count(files, 'file')}</span>` : nothing}
        </div>
        ${
          sections.length === 0
            ? html`<p>It held no changes, so nothing in Shared changed.</p>`
            : sections.map(
                (section) => html`<div class="field wide">
                  <h3>${section.title}</h3>
                  <ul class="merged-list">
                    ${section.rows.map((row) =>
                      section.kind === 'files'
                        ? html`<li>
                            <span class="what">${row.path}</span>
                            <a href=${new URL(fileLink(row.path), document.baseURI).pathname}>Open</a>
                          </li>`
                        : html`<li>
                            <span class="what">${row.name}${row.made ? html` <span class="hint">new</span>` : nothing}</span>
                            ${
                              section.kind === 'deleted'
                                ? html`<a href=${new URL('section/content/recycle-bin', document.baseURI).pathname}>Recycle bin</a>`
                                : html`<a href=${edit(row.key)}>Open</a>
                                    ${
                                      section.kind === 'published' && urls.get(row.key)
                                        ? html`<a href=${urls.get(row.key)} target="_blank" rel="noopener">View on site</a>`
                                        : nothing
                                    }
                                    ${
                                      section.kind === 'approval'
                                        ? html`<a href=${new URL('section/approvals', document.baseURI).pathname}>Approvals</a>`
                                        : nothing
                                    }`
                            }
                          </li>`,
                    )}
                  </ul>
                </div>`,
              )
        }
      </div></section>
      <uui-button slot="actions" look="secondary" label="See it in History" href=${new URL('section/settings/dashboard/changes', document.baseURI).pathname}>See it in History</uui-button>
      <uui-button slot="actions" look="primary" label="Back to Shared" @click=${() => showWorkspace('shared')}>Back to Shared</uui-button>`
  }

  async #save(change, saved = 'Saved.') {
    try {
      await change()
      workspacesChanged()
      this._status = saved
    } catch (error) {
      this._status = error.message
    }
  }

  #enter(view) {
    chooseWorkspace(view ?? (this.#mine.required ? { key: 'shared', name: 'Shared' } : null))
    location.reload()
  }

  async #delete(view) {
    if (!(await deleteWorkspace(this, view, this.#mine))) return
    showWorkspace('shared')
    workspacesChanged()
  }

  #rename(event, view) {
    const name = event.currentTarget.value.trim()
    if (!name || name === view.name) {
      event.currentTarget.value = view.name
      return
    }
    return this.#save(() => workspacesApi.rename(view.key, name), 'Renamed.')
  }

  /**
   * The owner's choice of who sees a workspace, built once for it and kept across renders,
   * so typing in its boxes survives each save; the facts are read again after each.
   */
  #audience(view) {
    if (this.#audienceFor?.key === view.key && this.#audienceFor.loaded)
      return this.#audienceFor.node
    if (this.#audienceFor?.key !== view.key) {
      this.#audienceFor = { key: view.key, loaded: false, node: html`<p class="hint">Loading…</p>` }
      workspacesApi
        .members(view.key)
        .catch(() => ({ items: [], groups: [] }))
        .then((members) => {
          if (this.#audienceFor?.key !== view.key) return
          const shared = sharedFrom(members)
          this.#audienceFor = {
            key: view.key,
            loaded: true,
            node: audienceEditor(
              view.visibility,
              shared,
              workspaceTarget(view, () => {
                workspacesChanged()
              }),
              (said) => {
                this._status = said
              },
            ),
          }
          this.requestUpdate()
        })
    }
    return this.#audienceFor.node
  }

  #describe(event, view) {
    event.preventDefault()
    const description = new FormData(event.currentTarget).get('description')
    return this.#save(() => workspacesApi.describe(view.key, String(description ?? '')))
  }

  /** Merges a workspace with no conflicts from Shared's grid; what must be settled first opens its merge. */
  async #mergeFromGrid(row) {
    const yes = await ask(this, {
      headline: `Merge ${row.name} into Shared?`,
      content: 'Its changes go into Shared, and the workspace is closed.',
      confirmLabel: 'Merge',
      color: 'positive',
    })
    if (!yes) return
    this._status = `Merging ${row.name}…`
    try {
      const done = await workspacesApi.merge(row.key, [])
      const waiting = done.forApproval?.length ?? 0
      this._status =
        waiting > 0
          ? `${row.name} merged into Shared; ${waiting} page${waiting === 1 ? '' : 's'} sent for approval.`
          : `${row.name} merged into Shared.`
      if (here(this.#mine)?.key === row.key) chooseWorkspace(null)
      workspacesChanged()
    } catch (error) {
      // Something to accept or settle first: its own merge says what.
      this._status = [error.message, ...(error.body?.blockers ?? [])].join(' ')
      showWorkspace(row.key, 'merge')
    }
  }

  #grid() {
    const rows = mergeRows(this.#workspaces, this.#mine.mayMerge === true)
    if (rows.length === 0) return html`<p class="hint">No workspaces are open.</p>`
    return html`<uui-table aria-label="Workspaces">
      <uui-table-head>
        <uui-table-head-cell>Workspace</uui-table-head-cell>
        <uui-table-head-cell>Status</uui-table-head-cell>
        <uui-table-head-cell></uui-table-head-cell>
      </uui-table-head>
      ${rows.map(
        (row) => html`<uui-table-row>
          <uui-table-cell>
            <button
              type="button"
              class="name-chip"
              style=${`background:${row.colour};color:${inkOn(row.colour)}`}
              @click=${() => showWorkspace(row.key)}
            >${row.name}</button>
          </uui-table-cell>
          <uui-table-cell>
            ${
              row.status.tone === 'danger'
                ? html`<button
                    type="button"
                    class="status danger link"
                    title=${`Open ${row.name} to settle them`}
                    @click=${() => showWorkspace(row.key)}
                  >
                    <uui-icon name=${row.status.icon}></uui-icon>${row.status.label}
                  </button>`
                : html`<span class=${`status ${row.status.tone}`}>
                    <uui-icon name=${row.status.icon}></uui-icon>${row.status.label}
                  </span>`
            }
          </uui-table-cell>
          <uui-table-cell class="actions">
            <uui-button
              look="primary"
              color="positive"
              compact
              label=${`Merge ${row.name} into Shared`}
              title=${row.merge.why}
              ?disabled=${!row.merge.enabled}
              @click=${() => this.#mergeFromGrid(row)}
            >Merge</uui-button>
          </uui-table-cell>
        </uui-table-row>`,
      )}
    </uui-table>`
  }

  #shared() {
    const inShared = !here(this.#mine)
    return html`<section class="detail">
        <div class="head">
          <span
            class=${inShared ? 'dot here' : 'dot'}
            title=${inShared ? 'You are here' : nothing}
            aria-label=${inShared ? 'You are here' : nothing}
            role=${inShared ? 'img' : nothing}
          ></span>
          <h2>Shared</h2>
        </div>
        ${this.#grid()}
        ${this._status ? html`<p class="hint" role="status">${this._status}</p>` : nothing}
      </section>
      ${
        inShared
          ? html`<span slot="footer-info" class="hint">This tab is in Shared.</span>`
          : html`<uui-button slot="actions" look="primary" label="Switch to Shared" @click=${() => this.#enter(null)}>Switch to Shared</uui-button>`
      }`
  }

  /** Its owner's choice of its colour, from the palette, or the one it is given. */
  async #chooseColour(view, colour) {
    this._palette = false
    try {
      await workspacesApi.colour(view.key, colour)
      await this.#list()
      workspacesChanged()
      this._status = 'Saved.'
    } catch (error) {
      this._status = error.message
    }
  }

  #colourPicker(view) {
    const now = colourOf(view.key)
    return html`<span class="colour">
      <button
        type="button"
        class="dot chooser"
        style=${`background:${now}`}
        aria-label="Choose its colour"
        title="Choose its colour"
        aria-expanded=${this._palette ? 'true' : 'false'}
        @click=${() => {
          this._palette = !this._palette
        }}
      ></button>
      ${
        this._palette
          ? html`<div class="palette" role="group" aria-label="Its colour">
              ${PALETTE.map(
                (colour, i) =>
                  html`<button
                    type="button"
                    class="swatch"
                    style=${`background:${colour}`}
                    aria-label=${PALETTE_NAMES[i]}
                    title=${PALETTE_NAMES[i]}
                    aria-pressed=${view.colour === colour ? 'true' : 'false'}
                    @click=${() => this.#chooseColour(view, colour)}
                  ></button>`,
              )}
              <button
                type="button"
                class="given"
                aria-pressed=${view.colour ? 'false' : 'true'}
                title="The colour it was given when made, rather than one chosen"
                @click=${() => this.#chooseColour(view, null)}
              >
                <span class="swatch" style=${`background:${givenColour(view.key)}`}></span> Automatic
              </button>
            </div>`
          : nothing
      }
    </span>`
  }

  #workspace(view) {
    const current = here(this.#mine)
    const owner = view.mine === true
    const inIt = current?.key === view.key
    const { changes, members } = this._detail
    const { merge, remove } = controlsFor({
      current: view,
      workspaces: this.#workspaces,
      mayMerge: this.#mine.mayMerge === true,
      changes: changes.length,
    })
    return html`<section class="detail"><div class="head">
        ${owner ? this.#colourPicker(view) : html`<span class="dot" style=${`background:${colourOf(view.key)}`}></span>`}
        ${
          owner
            ? html`<input
                class="title"
                aria-label="Name"
                .value=${view.name}
                maxlength="255"
                @change=${(event) => this.#rename(event, view)}
              />`
            : html`<h2>${view.name}</h2>`
        }
      </div>
      ${
        view.conflicts === 0 && changes.length > 0
          ? html`<div class="conflict clear" role="status">
              <strong>No conflicts with Shared</strong>
              <button type="button" class="link" @click=${() => showWorkspace(view.key, 'changes')}>View all changes</button>
            </div>`
          : nothing
      }
      ${
        view.conflicts > 0
          ? html`<div class="conflict" role="status">
              <strong>${view.conflicts} conflict${view.conflicts === 1 ? '' : 's'} with Shared</strong>
              ${merge.enabled ? html`<button type="button" class="link" @click=${() => showWorkspace(view.key, 'merge')}>Settle and merge</button>` : nothing}
            </div>`
          : nothing
      }
      ${
        owner
          ? html`<form @submit=${(event) => this.#describe(event, view)}>
              <label for="description">Description</label>
              <textarea id="description" name="description" rows="3" maxlength="1000" placeholder="What it is for" .value=${view.description ?? ''}></textarea>
              <uui-button type="submit" look="primary" label="Save description">Save description</uui-button>
            </form>`
          : html`<div class="field"><span class="label">Description</span><p>${view.description ?? 'It has no description.'}</p></div>`
      }
      <div class="field">
        <span class="label">Shared with</span>
        ${owner ? this.#audience(view) : html`<p>${whoSees(view, this._detail.groups ?? [], members)}.</p>`}
      </div>
      <div class="facts">
        ${workspaceFacts(view, members, changes.length, when, this._detail.groups ?? []).map(
          (fact) =>
            html`<div class="fact">
              <span class="hint">${fact.label}</span>
              <strong>${fact.value}</strong>
              <span class="hint">${fact.note}</span>
            </div>`,
        )}
      </div>
      <div class="field">
        <span class="label">Changes</span>
        ${
          changes.length === 0
            ? html`<p class="hint">None yet.</p>`
            : html`<ul class="changes">
                ${changes.map(
                  (change) =>
                    html`<li>
                      <strong>${change.name}</strong>
                      <span class="hint">${changeWords(change)}</span>
                      ${
                        view.member && change.key
                          ? html`<button
                              type="button"
                              class="link"
                              @click=${() => this.#save(() => workspacesApi.drop(view.key, change.key), 'Dropped.')}
                            >
                              Drop this change
                            </button>`
                          : nothing
                      }
                    </li>`,
                )}
              </ul>`
        }
      </div></section>
      <span slot="footer-info" class="hint" role="status">${this._status || (inIt ? 'This tab is in this workspace.' : '')}</span>
      <uui-button
        slot="actions"
        look="secondary"
        color="danger"
        label="Delete"
        title=${remove.why ?? `Delete ${view.name}`}
        ?disabled=${!remove.enabled}
        @click=${() => this.#delete(view)}
        >Delete</uui-button
      >
      <uui-button
        slot="actions"
        look="secondary"
        label="Merge into Shared"
        title=${merge.why ?? 'Merge into Shared'}
        ?disabled=${!merge.enabled}
        @click=${() => showWorkspace(view.key, 'merge')}
        >Merge into Shared</uui-button
      >
      ${
        !inIt && view.member
          ? html`<uui-button slot="actions" look="primary" label="Switch to this workspace" @click=${() => this.#enter(view)}>Switch to this workspace</uui-button>`
          : nothing
      }`
  }

  /** The merge, or with `readOnly` every change it would make, with nothing to settle or accept. */
  #merging(view, readOnly = false) {
    const { plan, diff, accepted, settled, says, done } = this._merge
    const conflicts = plan.conflicts ?? []
    const findings = plan.findings ?? []
    const waiting = findings.filter((f) => !accepted.has(f.id)).length
    const blocked = [...(plan.pending ?? [])].filter((p) => p.conflict)
    const ready = conflicts.length === 0 && blocked.length === 0 && waiting === 0 && !done
    const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
    const left = [
      conflicts.length > 0 ? `Settle ${count(conflicts.length, 'conflict')}` : '',
      waiting > 0 ? `accept ${count(waiting, 'thing')} above` : '',
    ].filter(Boolean)
    const pending = plan.pending ?? []
    const items = (plan.pages?.length ?? 0) + pending.length + (diff.files?.length ?? 0)
    return html`<section class="detail"><div class="merge">
      <button type="button" class="link back" @click=${() => showWorkspace(view.key)}>
        ← ${view.name}
      </button>
      <div class="head">
        <span class="dot" style=${`background:${colourOf(view.key)}`}></span>
        <h2>${readOnly ? `Changes in ${view.name}` : `Merge ${view.name} into Shared`}</h2>
      </div>
      <div class="chips">
        <span class="chip">${count(plan.pages?.length ?? 0, 'page')}</span>
        ${pending.length > 0 ? html`<span class="chip">${count(pending.length, 'move or delete', 'moves or deletes')}</span>` : nothing}
        ${conflicts.length > 0 ? html`<span class="chip warn">${count(conflicts.length, 'conflict')}${readOnly ? '' : ' to settle'}</span>` : nothing}
        ${findings.length > 0 && !readOnly ? html`<span class="chip">${count(findings.length, 'thing')} to accept</span>` : nothing}
      </div>
      ${
        !readOnly && conflicts.length + settled.length > 0
          ? html`<div class="field wide">
              <h3>Conflicts <span class="hint">changed here and in Shared: choose which to keep</span></h3>
              ${conflicts.map(
                (c) =>
                  html`<div class="card conflict-card">
                    <span><strong>${c.name ?? c.key}</strong> · ${c.words ?? mergeField(c.field)}</span>
                    <div class="sides">
                      <div class="side">
                        <span class="side-label">In this workspace</span>
                        <span class="value">${mergeValue(c.mine)}</span>
                        <uui-button look="primary" label="Keep the workspace's" @click=${() => this.#settle(view, c, 'mine')}>Keep the workspace's</uui-button>
                      </div>
                      <div class="side">
                        <span class="side-label">In Shared</span>
                        <span class="value">${mergeValue(c.theirs)}</span>
                        <uui-button look="outline" label="Keep Shared's" @click=${() => this.#settle(view, c, 'theirs')}>Keep Shared's</uui-button>
                      </div>
                    </div>
                  </div>`,
              )}
              ${settled.map(
                (c) =>
                  html`<div class="card settled">
                    <span><strong>${c.name ?? c.key}</strong> · ${c.words ?? mergeField(c.field)}</span>
                    <span class="hint">Settled: ${c.side === 'mine' ? "kept the workspace's" : "kept Shared's"}.</span>
                  </div>`,
              )}
            </div>`
          : nothing
      }
      ${
        !readOnly && findings.length > 0
          ? html`<div class="field wide">
              <h3>To accept <span class="hint">tick each to go on</span></h3>
              ${findings.map(
                (f) =>
                  html`<label class="card accept">
                    <input type="checkbox" .checked=${accepted.has(f.id)} @change=${(event) => this.#accept(f.id, event.currentTarget.checked)} />
                    <span>${f.says}</span>
                  </label>`,
              )}
            </div>`
          : nothing
      }
      <div class="field wide">
        <h3>What it changes <span class="hint">open one to see it before and after</span></h3>
        ${
          items === 0
            ? html`<p class="hint">Nothing: it holds no changes.</p>`
            : html`<div class="items">
                ${(plan.pages ?? []).map((p) => {
                  // Its name first, then its fields as the page has them.
                  const fields = [...(diff.pages?.find((d) => d.key === p.key)?.fields ?? [])].sort(
                    (a, b) =>
                      Number(String(b.field).startsWith('@')) -
                      Number(String(a.field).startsWith('@')),
                  )
                  return html`<details class="item" ?open=${items === 1}>
                    <summary>
                      <strong class="what">${p.name}</strong>
                      <span class="hint">${mergePageWords(p)}</span>
                    </summary>
                    ${
                      fields.length === 0
                        ? html`<p class="says">${p.made ? 'A new page, with nothing in its fields yet.' : `${mergePageWords(p)}.`}</p>`
                        : html`<table>
                            <thead>
                              <tr>
                                <th scope="col">Field</th>
                                ${p.made ? nothing : html`<th scope="col">Before, in Shared</th>`}
                                <th scope="col">${p.made ? 'In this workspace' : 'After, from this workspace'}</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${fields.map((f) => {
                                const before = plainValue(f.theirs)
                                const after = plainValue(f.mine)
                                const shown =
                                  after !== undefined && (p.made || before !== undefined)
                                return html`<tr>
                                  <th scope="row">${fieldName(f.field)}</th>
                                  ${
                                    shown
                                      ? html`${p.made ? nothing : html`<td class="value">${before}</td>`}
                                          <td class="value">${after}</td>`
                                      : html`<td class="hint" colspan=${p.made ? 1 : 2}>
                                          ${p.made ? 'Filled in.' : 'Changed. It holds more than a line can show: open the page to see it.'}
                                        </td>`
                                  }
                                </tr>`
                              })}
                            </tbody>
                          </table>`
                    }
                  </details>`
                })}
                ${pending.map(
                  (p) =>
                    html`<details class="item">
                      <summary>
                        <strong class="what">${p.name ?? 'A page'}</strong>
                        <span class="hint">${PENDING_WORDS[p.kind] ?? p.kind}</span>
                      </summary>
                      <p class="says">${PENDING_SAYS[p.kind] ?? ''} ${p.conflict ?? ''}</p>
                    </details>`,
                )}
                ${(diff.files ?? []).map(
                  (f) =>
                    html`<details class="item">
                      <summary>
                        <strong class="what">${f.path}</strong>
                        <span class="hint">${fileSays(f).replace('.', '')}</span>
                      </summary>
                      <p class="says">
                        ${fileSays(f)} It is one of the site's types, templates or files: see it under
                        Structure or Code.
                      </p>
                    </details>`,
                )}
              </div>`
        }
      </div>
    </div></section>
      ${
        readOnly
          ? html`${says ? html`<span slot="footer-info" class="hint" role="status">${says}</span>` : nothing}
              <uui-button slot="actions" look="secondary" label="Back" @click=${() => showWorkspace(view.key)}>Back</uui-button>
              ${
                ready
                  ? html`<uui-button slot="actions" look="primary" color="positive" label="Merge into Shared" ?disabled=${done} @click=${() => this.#mergeNow(view)}>Merge into Shared</uui-button>`
                  : html`<uui-button slot="actions" look="primary" color="positive" label="Merge into Shared…" @click=${() => showWorkspace(view.key, 'merge')}>Merge into Shared…</uui-button>`
              }`
          : html`<span slot="footer-info" class="hint" role="status">
                ${says || (left.length > 0 ? `${left.join(' and ')} first.` : 'Once merged, the workspace is closed and its changes are in Shared.')}
              </span>
              <uui-button slot="actions" look="secondary" label="Cancel" @click=${() => showWorkspace(view.key)}>Cancel</uui-button>
              <uui-button slot="actions" look="primary" color="positive" label="Merge into Shared" ?disabled=${!ready} @click=${() => this.#mergeNow(view)}>Merge into Shared</uui-button>`
      }`
  }

  render() {
    if (!this._ready || !this.#mine.enabled) return nothing
    const change = chosenView() === 'merged' ? chosenChange() : undefined
    if (change) return html`<umb-body-layout>${this.#merged(change)}</umb-body-layout>`
    const view = this.#view()
    const shown = view && this._merge?.key === view.key ? chosenView() : undefined
    const merging = shown === 'merge' || shown === 'changes'
    return html`<umb-body-layout>
      ${merging ? this.#merging(view, shown === 'changes') : view ? this.#workspace(view) : this.#shared()}
    </umb-body-layout>`
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .dot.here {
      border-color: transparent;
      background: var(--uui-color-positive, #2e7d32);
    }
    .name-chip {
      padding: 2px var(--uui-size-space-3, 9px);
      border: none;
      border-radius: var(--uui-border-radius, 3px);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: var(--uui-size-space-2, 6px);
    }
    .status.danger uui-icon {
      color: var(--uui-color-danger);
    }
    .status.warning uui-icon {
      color: var(--uui-color-warning-standalone);
    }
    .status.positive uui-icon {
      color: var(--uui-color-positive);
    }
    uui-table-cell.actions {
      text-align: right;
    }
    .dot {
      flex: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 1px solid var(--uui-color-border-emphasis, var(--uui-color-border));
      box-sizing: border-box;
    }
    [slot='footer-info'] {
      padding-left: var(--uui-size-layout-1);
    }
    .hint {
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
      font-weight: 400;
    }
    .detail {
      box-sizing: border-box;
      padding: var(--uui-size-layout-1) var(--uui-size-layout-2);
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-5);
      max-width: 900px;
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--uui-size-space-3);
    }
    h2,
    .title {
      margin: 0;
      font: inherit;
      font-size: var(--uui-type-h4-size);
      font-weight: 700;
    }
    .title {
      flex: 1 1 240px;
      max-width: 380px;
      padding: var(--uui-size-space-2) var(--uui-size-space-3);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface);
      color: inherit;
    }
    .conflict.clear {
      border-color: var(--uui-color-positive-standalone, var(--uui-color-border));
    }
    .conflict {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--uui-size-space-3);
      padding: var(--uui-size-space-3) var(--uui-size-space-4);
      border: 1px solid var(--uui-color-warning-standalone, var(--uui-color-border));
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface);
    }
    .conflict .link {
      margin-left: auto;
    }
    form,
    .field {
      display: grid;
      gap: var(--uui-size-space-2);
      justify-items: start;
    }
    label,
    .label {
      font-weight: 700;
    }
    textarea {
      box-sizing: border-box;
      width: 100%;
      font: inherit;
      padding: var(--uui-size-space-3);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface);
      color: inherit;
    }
    p {
      margin: 0;
    }
    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--uui-size-space-4);
    }
    .fact {
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-1);
      padding: var(--uui-size-space-4);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface);
    }
    .changes {
      width: 100%;
      margin: 0;
      padding: 0;
      list-style: none;
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface);
    }
    .changes li {
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-3);
      padding: var(--uui-size-space-3) var(--uui-size-space-4);
      border-top: 1px solid var(--uui-color-border);
    }
    .changes li:first-child {
      border-top: none;
    }
    .changes .link {
      margin-left: auto;
    }
    .merge {
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-5);
    }
    .back {
      align-self: flex-start;
      text-decoration: none;
    }
    h3 {
      margin: 0;
      font-size: inherit;
      font-weight: 700;
    }
    .colour {
      position: relative;
      display: inline-flex;
    }
    .dot.chooser {
      padding: 0;
      cursor: pointer;
      outline-offset: 2px;
    }
    .palette {
      position: absolute;
      z-index: 5;
      top: calc(100% + 6px);
      left: -6px;
      display: grid;
      grid-template-columns: repeat(4, 24px);
      gap: 6px;
      padding: var(--uui-size-space-3);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface);
      box-shadow: var(--uui-shadow-depth-3, 0 4px 12px rgb(0 0 0 / 0.15));
    }
    .palette .swatch {
      width: 24px;
      height: 24px;
      border: 2px solid transparent;
      border-radius: 50%;
      padding: 0;
      cursor: pointer;
    }
    .palette .swatch[aria-pressed='true'] {
      border-color: var(--uui-color-text);
    }
    .palette .given {
      grid-column: 1 / -1;
      display: inline-flex;
      align-items: center;
      gap: var(--uui-size-space-2);
      border: none;
      background: none;
      padding: 0;
      font: inherit;
      font-size: var(--uui-type-small-size);
      color: var(--uui-color-text);
      cursor: pointer;
    }
    .palette .given .swatch {
      display: inline-block;
      width: 14px;
      height: 14px;
    }
    .palette .given[aria-pressed='true'] {
      font-weight: 700;
    }
    .merged-badge {
      display: inline-flex;
      align-items: center;
      gap: var(--uui-size-space-1);
      padding: 2px var(--uui-size-space-3);
      border-radius: 12px;
      background: color-mix(in srgb, var(--uui-color-positive) 14%, var(--uui-color-surface));
      color: var(--uui-color-positive-emphasis, var(--uui-color-positive));
      font-size: var(--uui-type-small-size);
      font-weight: 700;
    }
    .merged-list {
      margin: 0;
      padding: 0;
      list-style: none;
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface);
    }
    .merged-list li {
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-4);
      padding: var(--uui-size-space-3) var(--uui-size-space-4);
    }
    .merged-list li + li {
      border-top: 1px solid var(--uui-color-border);
    }
    .merged-list .what {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .merged-list a {
      color: var(--uui-color-interactive);
      font-size: var(--uui-type-small-size);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--uui-size-space-2);
    }
    .chip {
      padding: var(--uui-size-space-1) var(--uui-size-space-4);
      border: 1px solid var(--uui-color-border);
      border-radius: 14px;
      background: var(--uui-color-surface);
      font-size: var(--uui-type-small-size);
    }
    .chip.warn {
      border-color: var(--crombolo-terracotta-light, var(--uui-color-border));
      background: var(--crombolo-terracotta-tint, var(--uui-color-surface));
      font-weight: 600;
    }
    .wide {
      justify-items: stretch;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-3);
      padding: var(--uui-size-space-4);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface);
    }
    .conflict-card {
      border-color: var(--crombolo-terracotta-light, var(--uui-color-border));
    }
    .sides {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: var(--uui-size-space-4);
    }
    .side {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--uui-size-space-3);
      padding: var(--uui-size-space-4);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
    }
    .side-label {
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .value {
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    .accept {
      flex-direction: row;
      align-items: center;
      font-weight: 400;
    }
    .items {
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-2);
    }
    .item {
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface);
    }
    summary {
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-3);
      padding: var(--uui-size-space-3) var(--uui-size-space-4);
      cursor: pointer;
    }
    summary::before {
      content: '▸';
      color: var(--uui-color-text-alt);
    }
    details[open] > summary::before {
      content: '▾';
    }
    summary::-webkit-details-marker {
      display: none;
    }
    .says {
      padding: 0 var(--uui-size-space-4) var(--uui-size-space-4);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border-top: 1px solid var(--uui-color-border);
      table-layout: fixed;
    }
    th,
    td {
      padding: var(--uui-size-space-3) var(--uui-size-space-4);
      text-align: left;
      vertical-align: top;
      border-top: 1px solid var(--uui-color-border);
    }
    thead th {
      border-top: none;
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
      font-weight: 700;
    }
    tbody th {
      width: 24%;
      font-weight: 600;
    }
    thead th:first-child {
      width: 24%;
    }
    .what {
      flex: none;
      width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .link {
      padding: 0;
      border: none;
      background: none;
      font: inherit;
      font-size: var(--uui-type-small-size);
      font-weight: 600;
      color: var(--uui-color-interactive);
      cursor: pointer;
      text-decoration: underline;
    }
  `
}

customElements.define('crombolo-workspaces-page', CromboloWorkspacesPageElement)
