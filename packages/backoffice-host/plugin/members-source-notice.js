/**
 * The Members section's line on where its members are kept (story 444), and, while
 * that site isn't answering, the warning with Try again. Registered by `members-source.js`.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { keptAtLine, membersSource, notAnsweringLine } from './members-source.js'

export default class CromboloMembersSourceNoticeElement extends UmbLitElement {
  static properties = { _answer: { state: true }, _checking: { state: true } }

  constructor() {
    super()
    this._answer = null
    this._checking = false
    this.#check()
  }

  async #check() {
    this._checking = true
    this._answer = await membersSource()
    this._checking = false
  }

  async #tryAgain() {
    await this.#check()
    // What the section showed was asked while the site was away: ask again now it answers.
    if (this._answer?.answering) window.location.reload()
  }

  render() {
    const answer = this._answer
    if (!answer?.source) return nothing
    if (answer.answering)
      return html`<p class="kept" data-mark="members-source">${keptAtLine(answer.source)}</p>`
    return html`<div class="away" role="alert" data-mark="members-source-away">
      <p>${notAnsweringLine(answer.source)}</p>
      <uui-button
        look="secondary"
        label="Try again"
        ?disabled=${this._checking}
        @click=${() => this.#tryAgain()}
      ></uui-button>
    </div>`
  }

  static styles = css`
    :host {
      display: block;
      padding: var(--uui-size-space-4) var(--uui-size-space-5);
    }
    p {
      margin: 0 0 var(--uui-size-space-3);
    }
    .kept {
      color: var(--uui-color-text-alt);
    }
    .away {
      padding: var(--uui-size-space-4);
      border-radius: var(--uui-border-radius);
      background: var(--uui-color-danger-standalone, #d42054);
      color: var(--uui-color-danger-contrast, #fff);
    }
  `
}

customElements.define('crombolo-members-source-notice', CromboloMembersSourceNoticeElement)
