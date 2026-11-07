/**
 * Home (stories 236, 288), where the back office opens and the logo leads: the pages changed lately, how many are drafts or published, what people
 * did, a way to start a new page, and the system's details. It is the fork's
 * `homeView`, outside any section. Everything comes from `crombolo/api/overview`,
 * already narrowed to what the signed-in user may see.
 */
import { UMB_AUTH_CONTEXT } from '@umbraco-cms/backoffice/auth'
import { UMB_CURRENT_USER_CONTEXT } from '@umbraco-cms/backoffice/current-user'
import { UMB_DOCUMENT_CREATE_OPTIONS_MODAL } from '@umbraco-cms/backoffice/document'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { umbOpenModal } from '@umbraco-cms/backoffice/modal'
import { UMB_SYSINFO_MODAL, UmbSysinfoRepository } from '@umbraco-cms/backoffice/sysinfo'
import { activityLine, ago, avatarHue, firstName, initials, STATES } from './overview-format.js'

const base = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

const LISTS = { recent: 'Recent content', drafts: 'Drafts', published: 'Published' }
const SHORT = 5
const LONG = 25

export default class CromboloOverviewDashboardElement extends UmbLitElement {
  static properties = {
    _name: { state: true },
    _data: { state: true },
    _list: { state: true },
    _take: { state: true },
    _skip: { state: true },
    _error: { state: true },
    _server: { state: true },
  }

  /** The session had gone when it last asked, so signing back in is what to wait for. */
  #signedOut = false
  #auth

  constructor() {
    super()
    this._list = 'recent'
    this._take = SHORT
    this._skip = 0
    this.consumeContext(UMB_CURRENT_USER_CONTEXT, (user) => {
      this.observe(user?.currentUser, (current) => {
        this._name = current?.name
      })
    })
    // Signing back in is a pop-up, so this page stays where it was and has to look again.
    this.consumeContext(UMB_AUTH_CONTEXT, (auth) => {
      this.#auth = auth
      this.observe(auth?.isAuthorized, (authorized) => {
        if (!authorized || !this.#signedOut) return
        this.#signedOut = false
        this.#load()
      })
    })
    new UmbSysinfoRepository(this).requestServerInformation().then((server) => {
      this._server = server
    })
  }

  connectedCallback() {
    super.connectedCallback()
    this.#load()
  }

  async #load() {
    const query = new URLSearchParams({
      list: this._list,
      skip: String(this._skip),
      take: String(this._take),
    })
    try {
      // Plain `fetch` renews nothing, so a token left to lapse would be refused.
      await (await this.getContext(UMB_AUTH_CONTEXT))?.getLatestToken().catch(() => undefined)
      const response = await fetch(`${base()}/crombolo/api/overview?${query}`, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      })
      if (response.status === 401) {
        // Not this page's to report: the sign-in dialog says so, and it loads after.
        this.#signedOut = true
        if (this.#auth?.getIsAuthorized()) this.#auth.timeOut()
        return
      }
      if (!response.ok) throw new Error(`overview responded ${response.status}`)
      this._data = await response.json()
      this._error = undefined
    } catch {
      this._error = 'The overview could not be loaded. Try again in a moment.'
    }
  }

  #show(list, take = SHORT) {
    this._list = list
    this._take = take
    this._skip = 0
    this.#load()
  }

  #page(by) {
    this._skip = Math.max(0, this._skip + by * this._take)
    this.#load()
  }

  async #newPage() {
    const under = this._data?.newPageUnder ?? null
    await umbOpenModal(this, UMB_DOCUMENT_CREATE_OPTIONS_MODAL, {
      data: {
        parent: under
          ? { unique: under, entityType: 'document' }
          : { unique: null, entityType: 'document-root' },
        documentType: null,
      },
    }).catch(() => undefined)
  }

  render() {
    const name = firstName(this._name)
    return html`<div class="page">
      <header>
        <h1>Home</h1>
        <p>${name ? `Welcome back, ${name}. ` : ''}Here’s what’s happening in Crombolo.</p>
      </header>
      ${this._error ? html`<uui-box><p class="error">${this._error}</p></uui-box>` : nothing}
      <div class="grid">
        <div class="main">
          ${this.#renderPages()}
          <button class="new" type="button" @click=${() => this.#newPage()}>
            <span>
              <strong>New content</strong>
              <small>Create a new page</small>
            </span>
            <uui-icon name="icon-add"></uui-icon>
          </button>
        </div>
        <div class="side">
          ${this.#renderStats()} ${this.#renderActivity()} ${this.#renderSystem()}
        </div>
      </div>
    </div>`
  }

  #renderSystem() {
    return html`<uui-box headline="System information">
      <dl class="system">
        <dt>Version</dt>
        <dd>${this._server?.version ?? '…'}</dd>
        <dt>Mode</dt>
        <dd>${this._server?.runtimeMode ?? '…'}</dd>
      </dl>
      <div class="system-links">
        <a href="https://github.com/kineco-au/crombolo-cms" target="_blank" rel="noopener">
          Crombolo on GitHub
        </a>
        <button class="link" type="button" @click=${() => this.#openSystemDetails()}>
          All details
        </button>
      </div>
    </uui-box>`
  }

  #openSystemDetails() {
    umbOpenModal(this, UMB_SYSINFO_MODAL).catch(() => undefined)
  }

  #renderPages() {
    const pages = this._data?.pages
    const expanded = this._take === LONG
    return html`<uui-box>
      <div class="box-head" slot="header">
        <span class="headline">${LISTS[this._list]}</span>
        ${
          this._list !== 'recent' || expanded
            ? html`<button class="link" type="button" @click=${() => this.#show('recent')}>
                Back to recent
              </button>`
            : html`<button class="link" type="button" @click=${() => this.#show('recent', LONG)}>
                View all ›
              </button>`
        }
      </div>
      ${
        !pages
          ? html`<uui-loader></uui-loader>`
          : pages.items.length === 0
            ? html`<p class="empty">${this.#emptyText()}</p>`
            : html`<table>
                <thead>
                  <tr><th>Title</th><th>Type</th><th>Status</th><th>Updated</th><th>Author</th></tr>
                </thead>
                <tbody>
                  ${pages.items.map(
                    (p) => html`<tr>
                      <td>
                        <span class="title">
                          <uui-icon name="icon-document"></uui-icon>
                          <a href=${`${base()}/section/content/workspace/document/edit/${p.key}`}>${p.name}</a>
                        </span>
                      </td>
                      <td><span class="pill">${p.type}</span></td>
                      <td><span class="state ${p.state}">${STATES[p.state] ?? p.state}</span></td>
                      <td class="muted">${ago(p.updated)}</td>
                      <td>
                        ${
                          p.author
                            ? html`<span class="avatar hue-${avatarHue(p.author)}" title=${p.author}>${initials(p.author)}</span>`
                            : nothing
                        }
                      </td>
                    </tr>`,
                  )}
                </tbody>
              </table>`
      }
      ${
        pages && this._take === LONG && pages.total > LONG
          ? html`<div class="pager">
              <uui-button label="Newer" ?disabled=${this._skip === 0} @click=${() => this.#page(-1)}></uui-button>
              <span class="muted">${this._skip + 1}–${Math.min(this._skip + LONG, pages.total)} of ${pages.total}</span>
              <uui-button label="Older" ?disabled=${this._skip + LONG >= pages.total} @click=${() => this.#page(1)}></uui-button>
            </div>`
          : nothing
      }
    </uui-box>`
  }

  #emptyText() {
    if (this._list === 'drafts') return 'No drafts: every page you can see is published.'
    if (this._list === 'published') return 'Nothing is published yet.'
    return 'No pages created yet'
  }

  #renderStats() {
    const counts = this._data?.counts
    const stat = (list, icon, label, count) => html`<div class="stat">
      <span class="stat-icon ${list}"><uui-icon name=${icon}></uui-icon></span>
      <strong>${count ?? '–'}</strong>
      <span>${label}</span>
      <button class="link" type="button" @click=${() => this.#show(list, LONG)}>
        View ${label.toLowerCase()} ›
      </button>
    </div>`
    return html`<uui-box headline="Quick stats">
      <div class="stats">
        ${stat('drafts', 'icon-edit', 'Drafts', counts?.drafts)}
        ${stat('published', 'icon-check', 'Published', counts?.published)}
      </div>
    </uui-box>`
  }

  #renderActivity() {
    const activity = this._data?.activity
    return html`<uui-box>
      <div class="box-head" slot="header">
        <span class="headline">Activity</span>
        ${
          this._data?.mayReadAudit
            ? html`<a class="link" href=${`${base()}/section/settings/dashboard/audit-log`}>View all ›</a>`
            : nothing
        }
      </div>
      ${
        !activity
          ? html`<uui-loader></uui-loader>`
          : activity.length === 0
            ? html`<p class="empty">No recent activity</p>`
            : html`<ul class="feed">
                ${activity.map(
                  (a) => html`<li>
                    <span class="feed-icon ${a.action.includes('ublish') ? 'publish' : ''}">
                      <uui-icon name="icon-document"></uui-icon>
                    </span>
                    <a href=${`${base()}/section/content/workspace/document/edit/${a.key}`}>${activityLine(a)}</a>
                    <span class="muted when">${ago(a.when)}</span>
                  </li>`,
                )}
              </ul>`
      }
    </uui-box>`
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    .page {
      box-sizing: border-box;
      padding: var(--uui-size-layout-1);
      max-width: 1400px;
    }
    .system {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--uui-size-space-2) var(--uui-size-space-4);
      margin: 0 0 var(--uui-size-space-4);
    }
    .system dt { color: var(--uui-color-text-alt); }
    .system dd { margin: 0; }
    .system-links {
      display: flex;
      justify-content: space-between;
      gap: var(--uui-size-space-4);
    }
    header h1 {
      margin: 0 0 var(--uui-size-space-3);
      font-size: 2rem;
      line-height: 1.15;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    header p {
      margin: 0 0 var(--uui-size-layout-1);
      color: var(--uui-color-text-alt);
    }
    uui-box {
      box-shadow: var(--crombolo-card-shadow, none);
      --uui-box-border-radius: 12px;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
      gap: var(--uui-size-layout-1);
      align-items: start;
    }
    @media (max-width: 1000px) {
      .grid { grid-template-columns: minmax(0, 1fr); }
    }
    .main, .side {
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-layout-1);
    }
    .box-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }
    .headline { font-weight: 700; font-size: var(--uui-type-h5-size, 1rem); }
    .link {
      background: none;
      border: 0;
      padding: 0;
      font: inherit;
      color: var(--uui-color-interactive-emphasis);
      cursor: pointer;
      text-decoration: none;
    }
    .link:hover { text-decoration: underline; }
    table { width: 100%; border-collapse: collapse; }
    th {
      text-align: left;
      font-weight: 400;
      color: var(--uui-color-text-alt);
      padding: var(--uui-size-space-3) var(--uui-size-space-3);
      border-bottom: 1px solid var(--uui-color-border);
    }
    td {
      padding: var(--uui-size-space-4) var(--uui-size-space-3);
      border-bottom: 1px solid var(--uui-color-border);
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: 0; }
    .title { display: flex; gap: var(--uui-size-space-3); align-items: center; }
    .title a { color: inherit; text-decoration: none; }
    .title a:hover { text-decoration: underline; }
    .pill {
      background: var(--crombolo-terracotta-tint, var(--uui-color-surface-alt));
      border-radius: var(--uui-border-radius);
      padding: var(--uui-size-space-1) var(--uui-size-space-3);
      white-space: nowrap;
    }
    .state { white-space: nowrap; }
    .state::before {
      content: '';
      display: inline-block;
      width: 0.6em;
      height: 0.6em;
      border-radius: 50%;
      margin-right: var(--uui-size-space-2);
      background: var(--uui-color-positive);
    }
    .state.draft::before { background: var(--uui-color-warning); }
    .state.changed::before { background: var(--uui-color-warning-emphasis, var(--uui-color-warning)); }
    .muted { color: var(--uui-color-text-alt); white-space: nowrap; }
    .avatar {
      display: inline-grid;
      place-items: center;
      width: 2.2em;
      height: 2.2em;
      border-radius: 50%;
      background: var(--uui-color-surface-alt);
      color: #54321f;
      font-size: 0.85em;
      font-weight: 700;
    }
    /* Soft colours, dark ink on each: the same in light and dark. */
    .avatar.hue-0 { background: #f6dccf; }
    .avatar.hue-1 { background: #dcebdc; }
    .avatar.hue-2 { background: #ece0f3; }
    .avatar.hue-3 { background: #f7e8c6; }
    .avatar.hue-4 { background: #d9e8f2; }
    .avatar.hue-5 { background: #f3dbe2; }
    .pager {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: var(--uui-size-space-4);
    }
    .empty { color: var(--uui-color-text-alt); margin: 0; }
    .error { color: var(--uui-color-danger); margin: 0; }
    .new {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      padding: var(--uui-size-layout-1);
      border: 0;
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-selected);
      color: var(--uui-color-selected-contrast);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .new:hover { filter: brightness(1.05); }
    .new strong { display: block; font-size: 1.3em; }
    .new uui-icon {
      font-size: 1.4em;
      background: var(--uui-color-surface);
      color: var(--uui-color-selected);
      border-radius: 50%;
      padding: var(--uui-size-space-3);
    }
    .stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--uui-size-space-4);
    }
    .stat {
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-2);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      padding: var(--uui-size-space-5);
    }
    .stat strong { font-size: 2em; line-height: 1; }
    .stat .link { text-align: left; margin-top: var(--uui-size-space-3); }
    .stat-icon, .feed-icon {
      display: inline-grid;
      place-items: center;
      width: 2.4em;
      height: 2.4em;
      border-radius: 50%;
      background: color-mix(in srgb, var(--uui-color-interactive-emphasis) 14%, transparent);
      color: var(--uui-color-interactive-emphasis);
    }
    .stat-icon.published, .feed-icon.publish {
      background: color-mix(in srgb, var(--uui-color-positive) 14%, transparent);
      color: var(--uui-color-positive);
    }
    .feed { list-style: none; margin: 0; padding: 0; }
    .feed li {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: var(--uui-size-space-4);
      align-items: center;
      padding: var(--uui-size-space-4) 0;
      border-bottom: 1px solid var(--uui-color-border);
    }
    .feed li:last-child { border-bottom: 0; }
    .feed a { color: inherit; text-decoration: none; }
    .feed a:hover { text-decoration: underline; }
    .feed-icon { border-radius: var(--uui-border-radius); }
  `
}

customElements.define('crombolo-overview-dashboard', CromboloOverviewDashboardElement)
