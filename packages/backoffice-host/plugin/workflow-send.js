/**
 * Sending a page for approval from the bottom bar (story 028): "Send for approval"
 * beside "Save and publish", and "Request unpublish" in its menu. Each shows only
 * while the page's workflow lets this user send it, saves the page first, as
 * publishing does, and asks for a note and, where the workflow allows, the times.
 */
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document'
import { UmbConditionBase } from '@umbraco-cms/backoffice/extension-registry'
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UMB_NOTIFICATION_CONTEXT } from '@umbraco-cms/backoffice/notification'
import {
  UmbWorkspaceActionBase,
  UmbWorkspaceActionMenuItemBase,
} from '@umbraco-cms/backoffice/workspace'
import { pageApproval, sendForApproval } from './workflow-client.js'
import { maySend, scheduleFor } from './workflow-send-model.js'

/** Sent on `window` when a page's request changes, so its tab and buttons catch up. */
export const APPROVAL_CHANGED = 'crombolo:approval-changed'

/** `Crombolo.Condition.Document.MaySendForApproval`, with `action` in its config. */
export class CromboloMaySendCondition extends UmbConditionBase {
  #key
  #isNew = true
  #check = async () => {
    // A page not saved yet has no request to send, and the server does not know it.
    if (!this.#key || this.#isNew) {
      this.permitted = false
      return
    }
    const key = this.#key
    const approval = await pageApproval(key).catch(() => undefined)
    if (key === this.#key) this.permitted = maySend(approval, this.config.action ?? 'publish')
  }

  constructor(host, args) {
    super(host, args)
    this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (context) => {
      this.observe(context?.isNew, (isNew) => {
        this.#isNew = isNew !== false
        this.#check()
      })
      this.observe(context?.unique, (unique) => {
        this.#key = unique ?? undefined
        this.#check()
      })
    })
    window.addEventListener(APPROVAL_CHANGED, this.#check)
  }

  destroy() {
    window.removeEventListener(APPROVAL_CHANGED, this.#check)
    super.destroy()
  }
}

/** The note and the times, in a dialog; resolves to what was given, or undefined when cancelled. */
function askForRequest(action, scheduling) {
  return new Promise((resolve) => {
    const dialog = document.createElement('crombolo-send-for-approval-dialog')
    dialog.action = action
    dialog.scheduling = scheduling
    dialog.addEventListener('done', (event) => {
      dialog.remove()
      resolve(event.detail)
    })
    document.body.append(dialog)
  })
}

async function send(host, action) {
  const workspace = await host.getContext(UMB_DOCUMENT_WORKSPACE_CONTEXT)
  const notifications = await host.getContext(UMB_NOTIFICATION_CONTEXT)
  const key = workspace?.getUnique?.()
  if (!key) return
  const approval = await pageApproval(key)
  const given = await askForRequest(action, approval.workflow?.scheduling === true)
  if (!given) return
  // What is sent is what is saved, so the editor's changes go first.
  await workspace.requestSubmit()
  const result = await sendForApproval(
    key,
    action,
    given.comment,
    scheduleFor(action, given.publishAt, given.unpublishAt),
  )
  window.dispatchEvent(new CustomEvent(APPROVAL_CHANGED, { detail: { key } }))
  if (result.ok)
    notifications?.peek('positive', {
      data: {
        message:
          action === 'unpublish' ? 'Asked for approval to take it down' : 'Sent for approval',
      },
    })
  else
    notifications?.peek('danger', {
      data: { message: result.message ?? 'The page could not be sent for approval.' },
    })
}

export class CromboloSendForApprovalAction extends UmbWorkspaceActionBase {
  async execute() {
    await send(this, 'publish')
  }
}

export class CromboloRequestUnpublishAction extends UmbWorkspaceActionMenuItemBase {
  async execute() {
    await send(this, 'unpublish')
  }
}

class CromboloSendForApprovalDialogElement extends LitElement {
  static properties = {
    action: { type: String },
    scheduling: { type: Boolean },
    _comment: { state: true },
    _publishAt: { state: true },
    _unpublishAt: { state: true },
  }

  constructor() {
    super()
    this._comment = ''
    this._publishAt = ''
    this._unpublishAt = ''
  }

  firstUpdated() {
    this.renderRoot.querySelector('dialog')?.showModal()
  }

  #done(detail) {
    this.renderRoot.querySelector('dialog')?.close()
    this.dispatchEvent(new CustomEvent('done', { detail }))
  }

  render() {
    const unpublish = this.action === 'unpublish'
    const title = unpublish ? 'Request unpublish' : 'Send for approval'
    return html`<dialog aria-label=${title} @cancel=${() => this.#done(undefined)}>
      <h3>${title}</h3>
      <p>The page is saved first, and what is saved is what the approvers see.</p>
      <uui-textarea
        label="A note for the approvers"
        placeholder="A note for the approvers (optional)"
        .value=${this._comment}
        @input=${(e) => {
          this._comment = e.target.value
        }}
      ></uui-textarea>
      ${
        this.scheduling
          ? html`<div class="times">
              ${
                unpublish
                  ? nothing
                  : html`<uui-label for="publish-at">Publish at
                      <uui-input id="publish-at" type="datetime-local" label="Publish at" .value=${this._publishAt}
                        @input=${(e) => {
                          this._publishAt = e.target.value
                        }}></uui-input></uui-label>`
              }
              <uui-label for="unpublish-at">Take down at
                <uui-input id="unpublish-at" type="datetime-local" label="Take down at" .value=${this._unpublishAt}
                  @input=${(e) => {
                    this._unpublishAt = e.target.value
                  }}></uui-input></uui-label>
              <small>Leave empty to ${unpublish ? 'take it down' : 'publish'} as soon as it is approved.</small>
            </div>`
          : nothing
      }
      <div class="actions">
        <uui-button look="secondary" label="Cancel" @click=${() => this.#done(undefined)}>Cancel</uui-button>
        <uui-button
          look="primary"
          label=${title}
          @click=${() =>
            this.#done({
              comment: this._comment,
              publishAt: this._publishAt,
              unpublishAt: this._unpublishAt,
            })}
          >${title}</uui-button
        >
      </div>
    </dialog>`
  }

  static styles = css`
    dialog {
      width: min(32rem, calc(100vw - 2rem));
      padding: var(--uui-size-space-5);
      border: 1px solid var(--uui-color-border);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-surface);
      color: var(--uui-color-text);
      box-shadow: var(--uui-shadow-depth-5);
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.35);
    }
    h3 {
      margin: 0 0 var(--uui-size-space-3);
    }
    p,
    small {
      color: var(--uui-color-text-alt);
    }
    uui-textarea {
      width: 100%;
    }
    .times {
      display: flex;
      flex-wrap: wrap;
      gap: var(--uui-size-space-4);
      margin-top: var(--uui-size-space-4);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--uui-size-space-3);
      margin-top: var(--uui-size-space-5);
    }
  `
}

if (!customElements.get('crombolo-send-for-approval-dialog'))
  customElements.define('crombolo-send-for-approval-dialog', CromboloSendForApprovalDialogElement)

export { CromboloSendForApprovalAction as api }
