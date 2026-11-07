/**
 * What the Content section opens on (story 288): the first page in the tree this
 * user may open, or a word saying there is none. The address is
 * replaced, so the back button leaves the section rather than coming back here.
 */
import { UMB_CURRENT_USER_CONTEXT } from '@umbraco-cms/backoffice/current-user'
import {
  UMB_DOCUMENT_CREATE_OPTIONS_MODAL,
  UmbDocumentTreeRepository,
} from '@umbraco-cms/backoffice/document'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { umbOpenModal } from '@umbraco-cms/backoffice/modal'

const base = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

const here = () => location.pathname.slice(base().length)

const CREATE = 'Umb.Document.Create'
const PAGE = 100

export default class CromboloContentHomeDashboardElement extends UmbLitElement {
  static properties = {
    _empty: { state: true },
    _mayCreate: { state: true },
  }

  constructor() {
    super()
    this.consumeContext(UMB_CURRENT_USER_CONTEXT, (user) => {
      this.observe(user?.currentUser, (current) => {
        this._mayCreate = current?.fallbackPermissions.includes(CREATE) ?? false
      })
    })
  }

  connectedCallback() {
    super.connectedCallback()
    this.#open()
  }

  /**
   * The first page this user may open. The tree also lists the pages above their
   * start node, marked `noAccess`, to show where it sits, so those are looked inside.
   */
  async #firstPage(repository, parent) {
    const page = { skip: 0, take: PAGE }
    const { data } = await (parent
      ? repository.requestTreeItemsOf({ ...page, parent })
      : repository.requestTreeRootItems(page))
    const items = data?.items ?? []
    const open = items.find((item) => !item.noAccess)
    if (open) return open
    for (const item of items) {
      if (!item.hasChildren) continue
      const found = await this.#firstPage(repository, {
        unique: item.unique,
        entityType: item.entityType,
      })
      if (found) return found
    }
    return undefined
  }

  async #open() {
    const home = await this.#firstPage(new UmbDocumentTreeRepository(this))
    // Someone may have gone elsewhere from the menu while this was looking.
    if (!this.isConnected || !/^\/section\/content(\/dashboard\/.*|\/)?$/.test(here())) return
    if (!home) {
      this._empty = true
      return
    }
    history.replaceState(
      null,
      '',
      `${base()}/section/content/workspace/document/edit/${home.unique}`,
    )
  }

  #newPage() {
    umbOpenModal(this, UMB_DOCUMENT_CREATE_OPTIONS_MODAL, {
      data: { parent: { unique: null, entityType: 'document-root' }, documentType: null },
    }).catch(() => undefined)
  }

  render() {
    if (!this._empty) return html`<uui-loader></uui-loader>`
    return html`<uui-box>
      <h2>No pages yet</h2>
      <p>There are no pages here for you to open.</p>
      ${
        this._mayCreate
          ? html`<uui-button
              look="primary"
              label="New content"
              @click=${() => this.#newPage()}
            ></uui-button>`
          : nothing
      }
    </uui-box>`
  }

  static styles = css`
    :host {
      display: block;
      padding: var(--uui-size-layout-1);
      max-width: 40rem;
    }
    h2 { margin: 0 0 var(--uui-size-space-3); }
    p { margin: 0 0 var(--uui-size-space-5); color: var(--uui-color-text-alt); }
  `
}

customElements.define('crombolo-content-home-dashboard', CromboloContentHomeDashboardElement)
