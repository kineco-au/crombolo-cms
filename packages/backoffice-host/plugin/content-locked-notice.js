/**
 * Beside a save a locked site refused (story 412): a notice naming where content is
 * edited, with a link to the same item there. Loaded by `content-locked.js`.
 */
import { UmbContextConsumerController } from '@umbraco-cms/backoffice/context-api'
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UMB_NOTIFICATION_CONTEXT } from '@umbraco-cms/backoffice/notification'
import { lockedNotice } from './content-locked.js'

export class CromboloContentLockedNotice extends LitElement {
  static properties = { data: { attribute: false } }

  render() {
    const notice = this.data
    if (!notice) return nothing
    return html`<uui-toast-notification-layout headline=${notice.headline}>
      <span>${notice.message}</span>
      ${
        notice.href
          ? html`<a href=${notice.href} target="_blank" rel="noopener">Edit it there</a>`
          : nothing
      }
    </uui-toast-notification-layout>`
  }

  static styles = css`
    a {
      display: inline-block;
      margin-top: var(--uui-size-space-2, 6px);
    }
  `
}

customElements.define('crombolo-content-locked-notice', CromboloContentLockedNotice)

export async function watchRefusals(host) {
  const { umbHttpClient } = await import('@umbraco-cms/backoffice/http-client')
  let notifications
  new UmbContextConsumerController(host, UMB_NOTIFICATION_CONTEXT, (context) => {
    notifications = context
  })
  umbHttpClient.interceptors.response.use(async (response, request) => {
    if (request.method !== 'GET' && response.status === 409) {
      const body = await response
        .clone()
        .json()
        .catch(() => undefined)
      const notice = lockedNotice(response.status, body, globalThis.location?.pathname ?? '')
      if (notice)
        notifications?.peek('warning', {
          elementName: 'crombolo-content-locked-notice',
          data: notice,
        })
    }
    return response
  })
}
