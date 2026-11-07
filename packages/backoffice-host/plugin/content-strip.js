/**
 * The menu under Content (story 289): Pages, Structure, Components, Forms and
 * Workflows, for whoever may open them. A row of its own under the header, shown
 * wherever one of them is open, and it keeps Content's tab marked while it shows.
 */
import { UMB_CURRENT_USER_CONTEXT } from '@umbraco-cms/backoffice/current-user'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { activeItem, stripItems } from './content-strip-items.js'

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
  }

  #follow = () => {
    this._active = activeItem(pathHere())
    this.#sync()
  }

  /** The header marks Content, and the back office makes room, only while the row shows. */
  #sync() {
    const shown = this.#shown()
    mark(shown ? CONTENT : undefined)
    if (shown) document.documentElement.style.setProperty(ROW_HEIGHT, '41px')
    else document.documentElement.style.removeProperty(ROW_HEIGHT)
  }

  #shown() {
    return this._items.length > 0 && this._active !== undefined
  }

  constructor() {
    super()
    this._items = []
    this.consumeContext(UMB_CURRENT_USER_CONTEXT, (user) => {
      this.observe(user?.currentUser, (current) => {
        this._items = stripItems(current)
        this.#sync()
      })
    })
  }

  connectedCallback() {
    super.connectedCallback()
    this.#follow()
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
    return html`<nav aria-label="Content">
      ${this._items.map(
        (item) =>
          html`<a
            href=${new URL(item.path, document.baseURI).pathname}
            aria-current=${item.label === this._active ? 'page' : 'false'}
            >${item.label}</a
          >`,
      )}
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
