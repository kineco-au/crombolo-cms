/**
 * Search, a Settings tool: what pages say in search results and when shared,
 * and the back office's search indexes, as two tabs at addresses of their own
 * under `dashboard/search-and-sharing/`. The indexes tab is Umbraco's own
 * screen, whose routes for one index sit below it.
 */
import { loadManifestElement } from '@umbraco-cms/backoffice/extension-api'
import { umbExtensionsRegistry } from '@umbraco-cms/backoffice/extension-registry'
import { css, html } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'

/** Umbraco's search indexes screen, loaded as its own dashboard, which this tool overwrites, would be. */
async function indexesScreen() {
  const manifest = umbExtensionsRegistry.getByAlias('Umb.Dashboard.ExamineManagement')
  return { default: await loadManifestElement(manifest.element) }
}

/** The tabs, in order: each one's segment, its label, and its view. */
export const SEARCH_TABS = [
  { path: 'settings', label: 'Search settings', load: () => import('./seo/dashboard.js') },
  { path: 'indexes', label: 'Search indexes', load: indexesScreen },
]

/** Where the tool is, relative to the back office. */
export const SEARCH_PATH = 'section/settings/dashboard/search-and-sharing'

export default class CromboloSearchToolElement extends UmbLitElement {
  static properties = { _routerPath: { state: true }, _active: { state: true } }

  constructor() {
    super()
    this._routerPath = SEARCH_PATH
    this._active = SEARCH_TABS[0].path
  }

  #routes = [
    ...SEARCH_TABS.map((tab) => ({ path: tab.path, component: tab.load })),
    { path: '', pathMatch: 'full', redirectTo: SEARCH_TABS[0].path },
  ]

  render() {
    return html`
      <uui-tab-group>
        ${SEARCH_TABS.map(
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
          // An index's own page sits below its tab, at indexes/index/<name>.
          this._active =
            SEARCH_TABS.find((tab) => active.includes(`/${tab.path}`))?.path ?? SEARCH_TABS[0].path
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

customElements.define('crombolo-search-tool', CromboloSearchToolElement)
