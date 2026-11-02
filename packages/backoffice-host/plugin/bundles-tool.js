/**
 * Bundles, a Settings tool (story 238): Marketplace, Installed and Created as
 * tabs, each at an address of its own under `dashboard/bundles/`. The views
 * are the ones Umbraco's Packages section showed, which this replaces.
 */
import { css, html } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'

/** The tabs, in order: each one's segment, its label, and its view. */
export const BUNDLE_TABS = [
  { path: 'marketplace', label: 'Marketplace', load: () => import('./bundles-marketplace.js') },
  { path: 'installed', label: 'Installed', load: () => import('./bundles-installed.js') },
  { path: 'created', label: 'Created', load: () => import('./bundles-created.js') },
]

/** Where the tool is, relative to the back office. */
export const BUNDLES_PATH = 'section/settings/dashboard/bundles'

export default class CromboloBundlesToolElement extends UmbLitElement {
  static properties = { _routerPath: { state: true }, _active: { state: true } }

  constructor() {
    super()
    this._routerPath = BUNDLES_PATH
    this._active = BUNDLE_TABS[0].path
  }

  #routes = [
    ...BUNDLE_TABS.map((tab) => ({ path: tab.path, component: tab.load })),
    { path: '', pathMatch: 'full', redirectTo: BUNDLE_TABS[0].path },
  ]

  render() {
    return html`
      <uui-tab-group>
        ${BUNDLE_TABS.map(
          (tab) => html`<uui-tab
            label=${tab.label}
            href=${`${this._routerPath}/${tab.path}`}
            ?active=${this._active === tab.path}
          >${tab.label}</uui-tab>`,
        )}
      </uui-tab-group>
      <umb-router-slot
        .routes=${this.#routes}
        @init=${(event) => {
          this._routerPath = event.target.absoluteRouterPath
        }}
        @change=${(event) => {
          const active = event.target.absoluteActiveViewPath ?? ''
          this._active = BUNDLE_TABS.find((tab) => active.endsWith(`/${tab.path}`))?.path ?? ''
        }}
      ></umb-router-slot>
    `
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    uui-tab-group {
      /* UUI's tab group fills its container's height; here it is a strip. */
      flex: none;
      height: auto;
      padding: 0 var(--uui-size-layout-1);
      border-bottom: 1px solid var(--uui-color-border);
      --uui-tab-divider: transparent;
    }
    umb-router-slot {
      display: block;
      flex: 1 1 auto;
      min-height: 0;
    }
  `
}

customElements.define('crombolo-bundles-tool', CromboloBundlesToolElement)
