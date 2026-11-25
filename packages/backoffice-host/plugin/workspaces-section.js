/**
 * Workspaces, a place under Content with a layout of its own: the list in the sidebar and
 * the workspace chosen beside it, in the same split as the other places'.
 */
import { css, html } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { SPLIT_STYLES, savedPosition, savePosition } from './section-split.js'
import './workspaces-list.js'
import './workspaces-page.js'

export class CromboloWorkspacesSectionElement extends UmbLitElement {
  render() {
    return html`<umb-split-panel
      lock="start"
      snap="300px"
      .position=${savedPosition() ?? 'var(--umb-split-panel-initial-position)'}
      @position-changed=${savePosition}
    >
      <umb-section-sidebar slot="start">
        <crombolo-workspaces-list></crombolo-workspaces-list>
      </umb-section-sidebar>
      <umb-section-main slot="end">
        <crombolo-workspaces-page></crombolo-workspaces-page>
      </umb-section-main>
    </umb-split-panel>`
  }

  static styles = [
    SPLIT_STYLES,
    css`
    :host {
      flex: 1 1 auto;
      height: 100%;
      display: flex;
    }
    umb-section-main {
      flex: 1 1 auto;
    }
  `,
  ]
}

customElements.define('crombolo-workspaces-section', CromboloWorkspacesSectionElement)

export { CromboloWorkspacesSectionElement as element }
