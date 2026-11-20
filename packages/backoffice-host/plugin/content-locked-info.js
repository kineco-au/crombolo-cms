/**
 * The line an item on a locked site shows on its Info tab (story 388): where it is
 * edited, and a link to the same item there. Registered by `content-locked.js`.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { editedHref, LOCKED_LINE, lockedState } from './content-locked.js'

export default class CromboloContentLockedInfoElement extends UmbLitElement {
  render() {
    const href = editedHref(lockedState.editedAt, globalThis.location?.pathname ?? '')
    return html`<umb-workspace-info-app-layout headline="Where this is edited">
      <div class="body">
        <span>${LOCKED_LINE}</span>
        ${href ? html`<a href=${href} target="_blank" rel="noopener">Edit it there</a>` : nothing}
      </div>
    </umb-workspace-info-app-layout>`
  }

  static styles = css`
    .body {
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-3, 9px);
      padding: var(--uui-size-space-4, 12px) var(--uui-size-space-5, 18px);
    }
  `
}

customElements.define('crombolo-content-locked-info', CromboloContentLockedInfoElement)
