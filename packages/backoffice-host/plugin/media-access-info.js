/**
 * The media workspace's note of who can see an item, with a "Protected" badge
 * when it is closed to visitors (story 196). Registered by `media-access.js`.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UMB_MEDIA_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/media'
import { readMediaAccess, summarise, usedByText } from './media-access.js'

export default class CromboloMediaAccessInfoElement extends UmbLitElement {
  static properties = {
    _state: { state: true },
  }

  #unique

  constructor() {
    super()
    this._state = undefined
    this.consumeContext(UMB_MEDIA_WORKSPACE_CONTEXT, (context) => {
      this.observe(context?.unique, (unique) => {
        if (!unique || unique === this.#unique) return
        this.#unique = unique
        readMediaAccess(unique).then(
          (state) => {
            this._state = state
          },
          () => {
            this._state = undefined
          },
        )
      })
    })
  }

  render() {
    if (!this._state) return nothing
    return html`<umb-workspace-info-app-layout headline="Who can see it">
      <div class="body">
        ${this._state.protected ? html`<uui-tag color="warning" look="primary">Protected</uui-tag>` : nothing}
        <span>${summarise(this._state)}</span>
      </div>
      ${
        this._state.usedBy?.length
          ? html`<div class="body"><uui-tag look="secondary">In use</uui-tag><span>${usedByText(this._state.usedBy)}</span></div>`
          : nothing
      }
    </umb-workspace-info-app-layout>`
  }

  static styles = css`
    .body {
      display: flex;
      gap: var(--uui-size-space-3, 9px);
      align-items: center;
      padding: var(--uui-size-space-4, 12px) var(--uui-size-space-5, 18px);
    }
  `
}

customElements.define('crombolo-media-access-info', CromboloMediaAccessInfoElement)
