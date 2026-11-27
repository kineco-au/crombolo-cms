/**
 * The preview toolbar's visitor switch (story 443): signed out, or a member of
 * groups chosen from the site's member groups. Registered by `preview-member.js`.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UMB_PREVIEW_CONTEXT } from '@umbraco-cms/backoffice/preview'
import {
  choosePreviewMember,
  readPreviewMember,
  STAND_IN_NOTE,
  visitorLabel,
} from './preview-member.js'

export default class CromboloPreviewMemberElement extends UmbLitElement {
  static properties = {
    _groups: { state: true },
    _chosen: { state: true },
    _open: { state: true },
    _picking: { state: true },
    _ticked: { state: true },
    _problem: { state: true },
  }

  constructor() {
    super()
    this._groups = []
    this._chosen = null
    this._open = false
    this._picking = false
    this._ticked = []
    this._problem = ''
  }

  connectedCallback() {
    super.connectedCallback()
    readPreviewMember().then(({ groups, chosen }) => {
      this._groups = groups
      this._chosen = chosen
    })
  }

  #toggle() {
    this._open = !this._open
    this._picking = false
    this._problem = ''
    this._ticked = (this._chosen?.groups ?? []).map((g) => g.key)
  }

  #tick(key, on) {
    this._ticked = on ? [...this._ticked, key] : this._ticked.filter((k) => k !== key)
  }

  async #choose(keys) {
    try {
      const answer = await choosePreviewMember(keys)
      this._groups = answer.groups
      this._chosen = answer.chosen
      this._open = false
      this._picking = false
    } catch (error) {
      this._problem = error.message
      return
    }
    const preview = await this.getContext(UMB_PREVIEW_CONTEXT)
    const frame = preview?.getIFrameWrapper()?.querySelector('iframe')
    if (frame) preview.reloadIFrame(frame)
  }

  #menu() {
    if (!this._picking)
      return html`
        <uui-menu-item label="Signed out" @click-label=${() => this.#choose([])}></uui-menu-item>
        <uui-menu-item label="A member of…" @click-label=${() => (this._picking = true)}></uui-menu-item>
      `
    return html`
      <div class="groups">
        ${
          this._groups.length === 0
            ? html`<p>This site has no member groups yet.</p>`
            : this._groups.map(
                (group) => html`<uui-checkbox
                  label=${group.name}
                  ?checked=${this._ticked.includes(group.key)}
                  @change=${(event) => this.#tick(group.key, event.target.checked)}
                ></uui-checkbox>`,
              )
        }
        <p class="note">${STAND_IN_NOTE}</p>
        ${this._problem ? html`<p class="problem">${this._problem}</p>` : nothing}
        <uui-button
          look="primary"
          label="Preview"
          ?disabled=${this._ticked.length === 0}
          @click=${() => this.#choose(this._ticked)}
        ></uui-button>
      </div>
    `
  }

  render() {
    return html`
      <uui-button look="primary" label="Visitor" compact @click=${() => this.#toggle()}>
        <uui-icon name="icon-user"></uui-icon><span>${visitorLabel(this._chosen)}</span>
      </uui-button>
      ${this._open ? html`<div class="menu" role="menu">${this.#menu()}</div>` : nothing}
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
      min-width: 260px;
      background: var(--uui-color-surface);
      box-shadow: var(--uui-shadow-depth-3);
      border-radius: var(--uui-border-radius);
      z-index: 1;
    }
    .groups {
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-2, 6px);
      padding: var(--uui-size-space-4, 12px);
    }
    .note {
      margin: 0;
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size, 12px);
    }
    .problem {
      margin: 0;
      color: var(--uui-color-danger);
    }
  `
}

customElements.define('crombolo-preview-member', CromboloPreviewMemberElement)
