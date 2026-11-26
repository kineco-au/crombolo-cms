/**
 * The menu under Content (story 289): the workspace switch, then Pages, Media, Library,
 * Translation, Structure and Code, for whoever may open them: what a workspace holds
 * (story 419), in the open workspace's colour. A row of its own under the header, shown
 * wherever one of them is open, and it keeps Content's tab marked while it shows.
 * A section a site or an extension declares (story 431) has its places here too.
 */
import { UMB_CURRENT_USER_CONTEXT } from '@umbraco-cms/backoffice/current-user'
import { umbExtensionsRegistry } from '@umbraco-cms/backoffice/extension-registry'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { activeItem, stripItems, WORKSPACES } from './content-strip-items.js'
import { declaredSection, locate, screenPath } from './site-section-model.js'
import { workspacesApi } from './workspace-client.js'
import './workspace-switch.js'

const CONTENT = 'Umb.Section.Content'
const ROW_HEIGHT = '--crombolo-content-strip-height'

const pathHere = () => {
  const base = new URL(document.baseURI).pathname
  return location.pathname.startsWith(base) ? location.pathname.slice(base.length) : ''
}

const mark = (section) =>
  window.dispatchEvent(new CustomEvent('crombolo:mark-section', { detail: section }))

export default class CromboloContentStripElement extends UmbLitElement {
  static properties = {
    _items: { state: true },
    _active: { state: true },
    _declared: { state: true },
  }

  #user
  /** The sections a site or an extension declares, with places. */
  #sections = []
  /** Story 384: with workspaces on, the row shows for the switch whatever else it holds. */
  #workspaces = false

  #follow = () => {
    this._active = activeItem(pathHere())
    const at = locate(pathHere(), this.#sections)
    this._declared = at && at.section.places.length > 1 ? at : undefined
    this.#sync()
  }

  /** The header marks Content, and the back office makes room, only while the row shows. */
  #sync() {
    const shown = this.#shown()
    mark(shown && !this._declared ? CONTENT : undefined)
    if (shown) document.documentElement.style.setProperty(ROW_HEIGHT, '41px')
    else document.documentElement.style.removeProperty(ROW_HEIGHT)
  }

  #offer() {
    this._items = stripItems(this.#user, this.#workspaces)
    this.#sync()
  }

  #shown() {
    if (this._declared) return true
    return (this._items.length > 0 || this.#workspaces) && this._active !== undefined
  }

  constructor() {
    super()
    this._items = []
    this.consumeContext(UMB_CURRENT_USER_CONTEXT, (user) => {
      this.observe(user?.currentUser, (current) => {
        this.#user = current
        this.#offer()
      })
    })
    this.observe(umbExtensionsRegistry.byType('section'), (manifests) => {
      this.#sections = manifests.map(declaredSection).filter(Boolean)
      this.#follow()
    })
  }

  connectedCallback() {
    super.connectedCallback()
    this.#follow()
    workspacesApi.mine().then(
      (mine) => {
        this.#workspaces = mine.enabled === true
        this.#offer()
      },
      () => {},
    )
    window.addEventListener('changestate', this.#follow)
    window.addEventListener('popstate', this.#follow)
    // A route the router settles on without a state change of its own, such as Home.
    window.addEventListener('navigationend', this.#follow)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('changestate', this.#follow)
    window.removeEventListener('popstate', this.#follow)
    window.removeEventListener('navigationend', this.#follow)
    mark(undefined)
    document.documentElement.style.removeProperty(ROW_HEIGHT)
  }

  render() {
    if (!this.#shown()) return nothing
    const at = this._declared
    if (at)
      return html`<nav aria-label=${at.section.label}>
        ${at.section.places.map(
          (place) =>
            html`<a
              href=${new URL(screenPath(at.section, place), document.baseURI).pathname}
              aria-current=${place.alias === at.place.alias ? 'page' : 'false'}
              >${place.label}</a
            >`,
        )}
      </nav>`
    return html`<nav aria-label="Content">
      ${this._items.map(
        (item) =>
          html`<a
            href=${new URL(item.path, document.baseURI).pathname}
            aria-current=${item.label === this._active ? 'page' : 'false'}
            >${item.label}</a
          >`,
      )}
      ${
        this.#workspaces
          ? html`<a
                href=${new URL(WORKSPACES.path, document.baseURI).pathname}
                aria-current=${this._active === WORKSPACES.label ? 'page' : 'false'}
                >${WORKSPACES.label}</a
              ><crombolo-workspace-controls></crombolo-workspace-controls
              ><crombolo-workspace-switch></crombolo-workspace-switch>`
          : nothing
      }
    </nav>`
  }

  static styles = css`
    nav {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-2);
      height: 41px;
      padding: 0 var(--uui-size-space-5);
      overflow-x: auto;
      background: var(--uui-color-surface);
      border-bottom: 1px solid var(--uui-color-border);
    }
    crombolo-workspace-controls {
      margin-left: auto;
    }
    a {
      padding: var(--uui-size-space-1) var(--uui-size-space-3);
      white-space: nowrap;
      border-radius: var(--uui-border-radius);
      color: var(--uui-color-text);
      font-size: var(--uui-type-small-size);
      text-decoration: none;
    }
    a:hover {
      background: var(--uui-color-surface-emphasis);
    }
    a[aria-current='page'] {
      background: var(--crombolo-terracotta-tint, var(--uui-color-surface-alt));
      font-weight: 700;
    }
  `
}

customElements.define('crombolo-content-strip', CromboloContentStripElement)

/** Loaded on its own so that the element the header draws is defined. */
export const onInit = () => {}
