/**
 * The preview toolbar's visitor switch (story 264): signed out, or a member
 * picked with Umbraco's member picker. Hidden from a user who cannot open
 * Members. Registered by `preview-member.js`.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UMB_MEMBER_PICKER_MODAL } from '@umbraco-cms/backoffice/member'
import { umbOpenModal } from '@umbraco-cms/backoffice/modal'
import { UMB_PREVIEW_CONTEXT } from '@umbraco-cms/backoffice/preview'
import { choosePreviewMember, readPreviewMember, visitorLabel } from './preview-member.js'

export default class CromboloPreviewMemberElement extends UmbLitElement {
  static properties = {
    _allowed: { state: true },
    _member: { state: true },
    _open: { state: true },
  }

  constructor() {
    super()
    this._allowed = false
    this._member = null
    this._open = false
  }

  connectedCallback() {
    super.connectedCallback()
    this.hidden = true
    readPreviewMember().then(({ allowed, member }) => {
      this._allowed = allowed
      this._member = member
      this.hidden = !allowed
    })
  }

  async #choose(member) {
    this._open = false
    const answer = await choosePreviewMember(member)
    this._member = answer.member
    const preview = await this.getContext(UMB_PREVIEW_CONTEXT)
    const frame = preview?.getIFrameWrapper()?.querySelector('iframe')
    if (frame) preview.reloadIFrame(frame)
  }

  async #pick() {
    this._open = false
    const picked = await umbOpenModal(this, UMB_MEMBER_PICKER_MODAL, {
      data: { multiple: false },
    }).catch(() => undefined)
    const key = picked?.selection?.[0]
    if (key) await this.#choose(key)
  }

  render() {
    if (!this._allowed) return nothing
    return html`
      <uui-button look="primary" label="Visitor" compact @click=${() => (this._open = !this._open)}>
        <uui-icon name="icon-user"></uui-icon><span>${visitorLabel(this._member)}</span>
      </uui-button>
      ${
        this._open
          ? html`<div class="menu" role="menu">
              <uui-menu-item label="Signed out" @click-label=${() => this.#choose(null)}></uui-menu-item>
              <uui-menu-item label="Choose a member…" @click-label=${() => this.#pick()}></uui-menu-item>
            </div>`
          : nothing
      }
    `
  }

  static styles = css`
    :host {
      position: relative;
      display: flex;
    }
    span {
      margin-left: var(--uui-size-space-2, 6px);
    }
    .menu {
      position: absolute;
      bottom: 100%;
      right: 0;
      min-width: 200px;
      background: var(--uui-color-surface);
      box-shadow: var(--uui-shadow-depth-3);
      border-radius: var(--uui-border-radius);
      z-index: 1;
    }
  `
}

customElements.define('crombolo-preview-member', CromboloPreviewMemberElement)
