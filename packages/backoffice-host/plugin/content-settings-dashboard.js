/**
 * Content settings: one card for how pages are addressed, with tabs for the
 * addresses themselves, the redirects recorded or configured for them, and the
 * relations between items. Each tab is the screen that was a card of its own.
 */
import { css, html } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import './addresses-dashboard.js'

export const CONTENT_SETTINGS_TABS = [
  { id: 'urls', label: 'URLs' },
  { id: 'redirects', label: 'Page Redirects' },
  { id: 'relations', label: 'Relations' },
]

const REDIRECTS_DASHBOARD = 'Umb.Dashboard.RedirectManagement'
const RELATION_TYPES = 'Umb.Collection.RelationType'

export default class CromboloContentSettingsDashboardElement extends UmbLitElement {
  static properties = {
    _tab: { state: true },
  }

  constructor() {
    super()
    this._tab = 'urls'
  }

  #panel() {
    if (this._tab === 'redirects')
      return html`<umb-extension-slot
        type="dashboard"
        .filter=${(manifest) => manifest.alias === REDIRECTS_DASHBOARD}></umb-extension-slot>`
    if (this._tab === 'relations')
      return html`<div class="padded"><umb-collection alias=${RELATION_TYPES}></umb-collection></div>`
    return html`<crombolo-addresses-dashboard></crombolo-addresses-dashboard>`
  }

  render() {
    return html`
      <uui-tab-group>
        ${CONTENT_SETTINGS_TABS.map(
          (tab) => html`<uui-tab
            label=${tab.label}
            ?active=${this._tab === tab.id}
            @click=${() => {
              this._tab = tab.id
            }}>${tab.label}</uui-tab>`,
        )}
      </uui-tab-group>
      ${this.#panel()}
    `
  }

  static styles = css`
    :host { display: block; }
    uui-tab-group {
      padding: 0 var(--uui-size-layout-1);
      border-bottom: 1px solid var(--uui-color-border);
      background: var(--uui-color-surface);
    }
    .padded { padding: var(--uui-size-layout-1); }
  `
}

customElements.define(
  'crombolo-content-settings-dashboard',
  CromboloContentSettingsDashboardElement,
)
