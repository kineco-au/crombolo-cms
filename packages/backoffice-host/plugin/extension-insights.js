/**
 * Extension insights in Settings: Umbraco's list of what the back office has loaded,
 * without the workspace's own header band. The Settings section titles it as it does
 * every other tool (`settings-title.js`).
 */
import { css, html } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'

export default class CromboloExtensionInsightsElement extends UmbLitElement {
  render() {
    return html`<umb-collection alias="Umb.Collection.Extension"></umb-collection>`
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }
  `
}

customElements.define('crombolo-extension-insights', CromboloExtensionInsightsElement)
