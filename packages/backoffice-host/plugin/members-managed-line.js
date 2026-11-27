/**
 * The line a member a directory keeps shows in place of Save (story 445): who keeps
 * them, and that changes are made there. Registered by `members-managed.js`.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UMB_MEMBER_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/member'
import { managerLine, managerOf } from './members-managed.js'

export default class CromboloMemberManagedLineElement extends UmbLitElement {
  static properties = { _line: { state: true } }

  #key

  constructor() {
    super()
    this.consumeContext(UMB_MEMBER_WORKSPACE_CONTEXT, (context) => {
      this.observe(context?.unique, async (unique) => {
        this.#key = unique
        const managedBy = unique ? await managerOf(unique) : null
        if (unique === this.#key) this._line = managerLine(managedBy)
      })
    })
  }

  render() {
    if (!this._line) return nothing
    return html`<span class="line" data-mark="member-managed">${this._line}</span>`
  }

  static styles = css`
    :host {
      display: flex;
      align-items: center;
    }
    .line {
      color: var(--uui-color-text-alt);
    }
  `
}

customElements.define('crombolo-member-managed-line', CromboloMemberManagedLineElement)
