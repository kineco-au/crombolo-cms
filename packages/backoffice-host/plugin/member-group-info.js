/**
 * A member group's Info view, in place of Umbraco's: only its General box with the
 * group's Id. Umbraco's also had a box saying a group has nothing more to edit.
 */
import { css, html } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UMB_MEMBER_GROUP_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/member-group'

export default class CromboloMemberGroupInfoElement extends UmbLitElement {
  static properties = { _unique: { state: true } }

  constructor() {
    super()
    this._unique = ''
    this.consumeContext(UMB_MEMBER_GROUP_WORKSPACE_CONTEXT, (context) => {
      this._unique = context?.getUnique() ?? ''
    })
  }

  render() {
    return html`<uui-box headline=${this.localize.term('general_general')}>
      <div class="property">
        <b><umb-localize key="general_id">Id</umb-localize></b>
        <span>${this._unique}</span>
      </div>
    </uui-box>`
  }

  static styles = css`
    :host {
      display: block;
      max-width: 350px;
      padding: var(--uui-size-space-4);
    }
    .property {
      display: flex;
      flex-direction: column;
    }
  `
}

customElements.define('crombolo-member-group-info', CromboloMemberGroupInfoElement)
