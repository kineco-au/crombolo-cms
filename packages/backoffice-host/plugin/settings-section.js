/**
 * Settings, laid out as Crombolo's (story 234): a landing page of cards, each
 * tool on its own without a tab bar, and the Structure or Code tree only beside
 * the editors it opens. Built from the pieces Umbraco's `umb-section-default`
 * uses, and drawn in its place through the `Crombolo.SectionLayout.Settings`
 * manifest.
 */

import {
  createExtensionApi,
  createExtensionElement,
  UmbExtensionsElementInitializer,
  UmbExtensionsManifestInitializer,
} from '@umbraco-cms/backoffice/extension-api'
import { umbExtensionsRegistry } from '@umbraco-cms/backoffice/extension-registry'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UmbRouteNotFoundElement } from '@umbraco-cms/backoffice/router'
import { UmbTextStyles } from '@umbraco-cms/backoffice/style'
import { aliasToPath, pathFolderName } from '@umbraco-cms/backoffice/utils'
import { UmbViewController } from '@umbraco-cms/backoffice/view'
import {
  ADVANCED_MENU,
  advancedToolTitle,
  CODE_MENU,
  crumbsFor,
  SIDEBAR_APPS,
  STRUCTURE_MENU,
  settingsCards,
  treeFor,
} from './settings-cards.js'
import './breadcrumb.js'
import { readOnlyWords } from './definition-tree-model.js'
import './settings-card.js'

const base = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

/** Whether this site can send e-mail; the server answers with the reason. */
const emailStatus = async () => {
  const response = await fetch(`${base()}/crombolo/api/email`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`email responded ${response.status}`)
  return response.json()
}

const menuOf = (manifest, menu) => manifest.meta?.menus?.includes(menu) === true

export class CromboloSettingsSectionElement extends UmbLitElement {
  static properties = {
    _routes: { state: true },
    _sidebarApps: { state: true },
    _tree: { state: true },
    _crumbs: { state: true },
    _readOnly: { state: true },
  }

  #dashboards = []
  #menuItems = []
  #sectionRoutes = []
  #landing
  #viewContexts = new Map()
  #providedView

  constructor() {
    super()
    // An explanation, not a control: a failure leaves it out.
    fetch(`${base()}/crombolo/api/site-files`, { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : { writable: true }))
      .then(
        (files) => {
          this._readOnly = !files.writable
        },
        () => {},
      )
    new UmbExtensionsElementInitializer(
      this,
      umbExtensionsRegistry,
      'sectionSidebarApp',
      null,
      (apps) => {
        // Marked as Umbraco's section marks them, which tests and tours find them by.
        for (const app of apps)
          app.component?.setAttribute('data-mark', `section-sidebar:${app.manifest.alias}`)
        this._sidebarApps = apps.filter((a) => Object.values(SIDEBAR_APPS).includes(a.alias))
      },
    )
    new UmbExtensionsManifestInitializer(
      this,
      umbExtensionsRegistry,
      'dashboard',
      null,
      (dashboards) => {
        this.#dashboards = dashboards.map((d) => d.manifest)
        this.#createRoutes()
      },
    )
    new UmbExtensionsManifestInitializer(
      this,
      umbExtensionsRegistry,
      'menuItem',
      (m) => menuOf(m, STRUCTURE_MENU) || menuOf(m, CODE_MENU) || menuOf(m, ADVANCED_MENU),
      (items) => {
        this.#menuItems = items.map((i) => i.manifest)
        this.#refreshLanding()
      },
    )
    new UmbExtensionsManifestInitializer(
      this,
      umbExtensionsRegistry,
      'sectionRoute',
      null,
      async (extensions) => {
        this.#sectionRoutes = await Promise.all(
          extensions
            .filter((extension) => extension.manifest.element)
            .map(async (extension) => {
              const api = await createExtensionApi(this, extension.manifest)
              if (api) api.manifest = extension.manifest
              return {
                path:
                  api?.getPath?.() ||
                  extension.manifest.meta?.path ||
                  aliasToPath(extension.manifest.alias),
                component: () => createExtensionElement(extension.manifest),
                setup: (element, info) => {
                  api?.setup?.(element, info)
                  const entityType = info?.match?.params?.entityType
                  const tree = treeFor(entityType)
                  this.#showing(tree, {
                    title: tree ? undefined : advancedToolTitle(this.#advanced(), entityType),
                  })
                },
              }
            }),
        )
        this.#createRoutes()
      },
    )
  }

  #label(manifest) {
    const label = manifest.meta?.label ?? manifest.name ?? manifest.alias
    return this.localize.string(label)
  }

  #description(manifest) {
    const text = manifest.meta?.description
    return text ? this.localize.string(text) : undefined
  }

  #dashboardPath(manifest) {
    return `dashboard/${manifest.meta?.pathname || pathFolderName(manifest.meta?.label ?? manifest.name ?? manifest.alias)}`
  }

  #cards() {
    return settingsCards({
      dashboards: this.#dashboards.map((d) => ({
        alias: d.alias,
        label: this.#label(d),
        description: this.#description(d),
        bundle: d.cromboloBundle,
        path: this.#dashboardPath(d),
      })),
      advanced: this.#advanced(),
    })
  }

  #refreshLanding() {
    if (this.#landing) this.#landing.groups = this.#cards()
  }

  /** Which tree shows, and the trail that heads the page. */
  #showing(tree, { title } = {}) {
    this._tree = tree
    this._crumbs = crumbsFor({ tree, title })
  }

  #advanced() {
    return this.#menuItems
      .filter((m) => menuOf(m, ADVANCED_MENU))
      .map((m) => ({
        alias: m.alias,
        label: this.#label(m),
        description: this.#description(m),
        bundle: m.cromboloBundle,
        entityType: m.meta?.entityType,
      }))
  }

  #viewContext(manifest) {
    let context = this.#viewContexts.get(manifest.alias)
    if (!context) {
      context = new UmbViewController(this, manifest.alias)
      context.inherit()
      this.#viewContexts.set(manifest.alias, context)
    }
    context.setTitle(this.#label(manifest))
    return context
  }

  #createRoutes() {
    const landing = {
      component: () => document.createElement('crombolo-settings-landing'),
      setup: (element) => {
        this.#landing = element
        this.#refreshLanding()
        this.#showing(undefined)
      },
    }
    const tree = (name) => ({
      path: name,
      component: () => document.createElement('crombolo-settings-tree-start'),
      setup: (element) => {
        element.tree = name
        this.#showing(name)
      },
    })
    const dashboards = this.#dashboards.map((manifest) => ({
      path: this.#dashboardPath(manifest),
      component: () => createExtensionElement(manifest),
      setup: (component) => {
        const context = this.#viewContext(manifest)
        if (this.#providedView !== context) this.#providedView?.unprovide()
        if (component) {
          this.#providedView = context
          context.provideAt(component)
          component.manifest = manifest
        }
        this.#showing(undefined, { title: this.#label(manifest) })
      },
    }))
    this._routes = [
      tree('structure'),
      tree('code'),
      // Umbraco's welcome, which this page replaces: an address people have.
      { path: 'dashboard/welcome', ...landing },
      // Workflows moved beside forms (story 289): an address people have.
      {
        path: 'dashboard/workflows',
        component: () => document.createElement('div'),
        setup: () => {
          history.replaceState(
            null,
            '',
            new URL('section/forms/view/workflows', document.baseURI).pathname,
          )
        },
      },
      ...dashboards,
      ...this.#sectionRoutes,
      { path: '', pathMatch: 'full', ...landing },
      { path: '**', component: UmbRouteNotFoundElement },
    ]
  }

  #sectionPath() {
    return `section/${this.manifest?.meta?.pathname ?? 'settings'}`
  }

  render() {
    const shown = this._tree ? SIDEBAR_APPS[this._tree] : undefined
    const section = this.#sectionPath()
    const crumbs = (this._crumbs ?? []).map((c) => ({
      label: c.label,
      href: c.home
        ? document.baseURI
        : c.path === undefined
          ? undefined
          : c.path
            ? `${section}/${c.path}`
            : section,
    }))
    const main = html`<umb-section-main>
      ${
        crumbs.length > 0
          ? html`<crombolo-breadcrumb class="crumbs" .items=${crumbs}></crombolo-breadcrumb>`
          : nothing
      }
      ${this._routes ? html`<umb-router-slot .routes=${this._routes}></umb-router-slot>` : nothing}
    </umb-section-main>`
    // Both trees stay in the page, the one not in use hidden, as Umbraco's own
    // Settings keeps its menus. A tree taken out and put back breaks: the trees
    // share the section's expansion state, and a detached one still answers it.
    return html`<umb-section-sidebar ?hidden=${!shown}>
        ${
          this._tree === 'structure' && this._readOnly
            ? html`<p class="read-only" role="status">
                ${readOnlyWords('Content types, data types and languages', 'site')}
              </p>`
            : nothing
        }
        ${(this._sidebarApps ?? []).map(
          (app) => html`<div class="tree" ?hidden=${app.alias !== shown}>${app.component}</div>`,
        )}
      </umb-section-sidebar>
      ${main}`
  }

  static styles = [
    UmbTextStyles,
    css`
      :host {
        flex: 1 1 auto;
        height: 100%;
        display: flex;
      }
      umb-section-sidebar {
        --umb-section-sidebar-width: 300px;
      }
      umb-section-sidebar[hidden],
      .tree[hidden] {
        display: none;
      }
      umb-section-main {
        flex: 1 1 auto;
      }
      /* Umbraco's own views scroll inside their layout; the landing page and a
         tree's start page have none, so the area under the trail scrolls them. */
      umb-router-slot {
        display: block;
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
      }
      .read-only {
        margin: 0;
        padding: var(--uui-size-space-3) var(--uui-size-space-4);
        font-size: var(--uui-type-small-size);
        line-height: 1.5;
        color: var(--uui-color-text-alt);
      }
      .crumbs {
        display: block;
        padding: var(--uui-size-space-4) var(--uui-size-layout-1) 0;
      }
    `,
  ]
}

/** The landing page: a box of cards per group, and e-mail when it is not set up. */
export class CromboloSettingsLandingElement extends UmbLitElement {
  static properties = { groups: { attribute: false }, _email: { state: true } }

  connectedCallback() {
    super.connectedCallback()
    // An explanation, not a control: a failure leaves it out.
    emailStatus().then(
      (status) => {
        this._email = status
      },
      () => {},
    )
  }

  #email() {
    const status = this._email
    if (!status || status.available) return nothing
    return html`<details class="banner" role="status">
      <summary>
        <uui-icon name="icon-alert"></uui-icon>
        <strong>E-mail is not set up.</strong>
        <uui-icon class="chevron" name="icon-navigation-right"></uui-icon>
      </summary>
      <div class="banner-details">
        <p>${status.reason}</p>
        ${
          status.affects?.length > 0
            ? html`<p>Until it is, these are unavailable:</p>
                <ul class="affected">
                  ${status.affects.map((feature) => html`<li>${feature}</li>`)}
                </ul>`
            : nothing
        }
      </div>
    </details>`
  }

  render() {
    return html`
      ${this.#email()}
      ${(this.groups ?? []).map(
        ({ group, bundle, cards }) => html`<section>
          <h2>
            ${group}
            ${
              bundle
                ? html`<a class="tag" href=${bundle.path} title=${`The ${bundle.name} bundle, which adds these`}
                    >Bundle: ${bundle.packageName}</a
                  >`
                : nothing
            }
          </h2>
          <div class="cards">
            ${cards.map(
              (card) =>
                html`<crombolo-settings-card
                  href=${`section/settings/${card.path}`}
                  heading=${card.title}
                  description=${card.description ?? ''}
                ></crombolo-settings-card>`,
            )}
          </div>
        </section>`,
      )}
    `
  }

  static styles = [
    UmbTextStyles,
    css`
      :host {
        display: block;
        padding: var(--uui-size-layout-1);
        max-width: 72rem;
      }
      section + section {
        margin-top: var(--uui-size-layout-2);
      }
      h2 {
        font-size: var(--uui-type-h5-size);
        font-weight: 800;
        letter-spacing: -0.01em;
        margin: 0 0 var(--uui-size-space-4);
      }
      h2 .tag {
        margin-left: var(--uui-size-space-2);
        padding: 0.1em 0.6em;
        border: 1px solid var(--uui-color-border-standalone);
        border-radius: 999px;
        color: var(--uui-color-text-alt);
        font-size: var(--uui-type-small-size);
        font-weight: 600;
        letter-spacing: 0;
        vertical-align: middle;
        text-decoration: none;
      }
      h2 a.tag:hover,
      h2 a.tag:focus-visible {
        border-color: var(--uui-color-interactive-emphasis);
        color: var(--uui-color-interactive-emphasis);
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
        gap: var(--uui-size-space-5);
      }
      .banner {
        margin-bottom: var(--uui-size-layout-1);
        padding: var(--uui-size-space-4) var(--uui-size-space-5);
        border: 1px solid color-mix(in srgb, var(--uui-color-warning) 45%, transparent);
        border-left-width: 4px;
        border-radius: 8px;
        background: color-mix(in srgb, var(--uui-color-warning) 12%, var(--uui-color-surface));
        color: var(--uui-color-text);
      }
      .banner summary {
        display: flex;
        gap: var(--uui-size-space-4);
        align-items: center;
        cursor: pointer;
        list-style: none;
      }
      .banner summary::-webkit-details-marker {
        display: none;
      }
      .banner summary:focus-visible {
        outline: 2px solid var(--uui-color-focus);
        outline-offset: 2px;
      }
      .banner uui-icon {
        flex: none;
        color: var(--uui-color-warning-standalone, var(--uui-color-warning));
      }
      .banner .chevron {
        margin-left: auto;
        transition: transform 120ms;
      }
      .banner[open] .chevron {
        transform: rotate(90deg);
      }
      .banner-details {
        margin-top: var(--uui-size-space-3);
        padding-left: calc(1em + var(--uui-size-space-4));
      }
      .banner p {
        margin: 0 0 var(--uui-size-space-2);
        line-height: 1.5;
      }
      .affected {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .affected li {
        position: relative;
        padding-left: var(--uui-size-space-5);
        line-height: 1.6;
      }
      .affected li::before {
        content: '';
        position: absolute;
        left: 0.2em;
        top: 0.6em;
        width: 0.45em;
        height: 0.45em;
        border-radius: 50%;
        background: var(--uui-color-warning-standalone, var(--uui-color-warning));
      }
    `,
  ]
}

const TREE_HELP = {
  structure: html`<p>
      Choose a type, data type or language in the tree to edit it.
    </p>
    <p>
      Content types, data types and languages are <strong>files</strong>, in
      <code>schema/</code>, written as TOML. What you change here is written to the file, and the
      file is what a deploy and every other server reads, so a change can be reviewed like code.
    </p>`,
  code: html`<p>Choose a component, stylesheet or script in the tree to edit it.</p>`,
}

/** What Structure or Code shows until something in its tree is chosen. */
export class CromboloSettingsTreeStartElement extends UmbLitElement {
  static properties = { tree: { attribute: false } }

  render() {
    return html`<uui-box headline=${this.tree === 'code' ? 'Code' : 'Structure'}
      >${TREE_HELP[this.tree] ?? nothing}</uui-box
    >`
  }

  static styles = [
    UmbTextStyles,
    css`
      :host {
        display: block;
        padding: var(--uui-size-layout-1);
        max-width: 48rem;
      }
    `,
  ]
}

customElements.define('crombolo-settings-section', CromboloSettingsSectionElement)
customElements.define('crombolo-settings-landing', CromboloSettingsLandingElement)
customElements.define('crombolo-settings-tree-start', CromboloSettingsTreeStartElement)

export default CromboloSettingsSectionElement
