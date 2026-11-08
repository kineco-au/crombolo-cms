/**
 * The History box on a page's Info view, in place of Umbraco's list: when the page
 * last changed and by whom, and View all changes, which opens its history in a
 * panel that slides in (`page-history-modal.js`).
 */
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document'
import { DocumentVersionService, UserService } from '@umbraco-cms/backoffice/external/backend-api'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UmbModalToken, umbOpenModal } from '@umbraco-cms/backoffice/modal'

export const PAGE_HISTORY_MODAL = 'Crombolo.Modal.PageHistory'

const token = new UmbModalToken(PAGE_HISTORY_MODAL, { modal: { type: 'sidebar', size: 'medium' } })

export default class CromboloPageHistoryElement extends UmbLitElement {
  static properties = {
    _unique: { state: true },
    _latest: { state: true },
  }

  #documentTypeUnique

  constructor() {
    super()
    this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (context) => {
      this.observe(context?.unique, (unique) => {
        this._unique = unique ?? undefined
        this.#documentTypeUnique = context?.getContentTypeUnique?.()
        this.#load()
      })
    })
  }

  async #load() {
    const unique = this._unique
    if (!unique) return
    const { data } = await DocumentVersionService.getDocumentVersion({
      query: { documentId: unique, skip: 0, take: 1 },
    }).catch(() => ({}))
    if (unique !== this._unique) return
    const latest = data?.items?.[0]
    if (!latest) {
      this._latest = undefined
      return
    }
    const who = latest.user?.id
      ? (await UserService.getItemUser({ query: { id: [latest.user.id] } }).catch(() => ({})))
          .data?.[0]?.name
      : undefined
    this._latest = { date: latest.versionDate, who }
  }

  async #view() {
    await umbOpenModal(this, token, {
      data: { unique: this._unique, documentTypeUnique: this.#documentTypeUnique },
    }).catch(() => undefined)
  }

  render() {
    if (!this._unique) return nothing
    const latest = this._latest
    return html`<uui-box headline="History">
      <p>
        ${
          latest
            ? html`Last changed ${new Date(latest.date).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}${latest.who ? ` by ${latest.who}` : ''}.`
            : 'No changes yet.'
        }
      </p>
      <uui-button look="primary" label="View all changes" @click=${this.#view}
        >View all changes</uui-button
      >
    </uui-box>`
  }

  static styles = css`
    p {
      margin: 0 0 var(--uui-size-space-4);
    }
  `
}

customElements.define('crombolo-page-history', CromboloPageHistoryElement)

export { CromboloPageHistoryElement as element }
