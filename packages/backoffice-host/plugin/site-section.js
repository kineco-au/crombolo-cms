/**
 * A section a site or an extension declares (story 431), laid out: the place's menu
 * beside the screen it opens. The places themselves are in the row under the header
 * (`content-strip.js`). Drawn in place of `umb-section-default` by the section's
 * `sectionLayout`.
 */
import { createExtensionElement } from '@umbraco-cms/backoffice/extension-api'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { SPLIT_STYLES, savedPosition, savePosition } from './section-split.js'
import { declaredSection, locate, screenManifest, screenPath } from './site-section-model.js'

const pathHere = () => {
  const base = new URL(document.baseURI).pathname
  return location.pathname.startsWith(base) ? location.pathname.slice(base.length) : ''
}

export class CromboloSiteSectionElement extends UmbLitElement {
  static properties = {
    _at: { state: true },
    _screen: { state: true },
    _failed: { state: true },
  }

  #manifest
  #section
  /** Each screen's element, kept while the section is open, so moving back keeps its state. */
  #elements = new Map()

  get manifest() {
    return this.#manifest
  }

  set manifest(value) {
    this.#manifest = value
    this.#section = declaredSection(value)
    this.#follow()
  }

  #follow = () => {
    const at = this.#section ? locate(pathHere(), [this.#section]) : undefined
    if (!at) return
    const key = `${at.place.alias}/${at.screen.alias}`
    if (this._at && `${this._at.place.alias}/${this._at.screen.alias}` === key) return
    this._at = at
    this._failed = false
    this.#open(key, at)
  }

  async #open(key, at) {
    let element = this.#elements.get(key)
    if (!element) {
      try {
        const manifest = screenManifest(at.section, at.screen)
        element = await createExtensionElement(manifest)
        if (!element) throw new Error(`${manifest.alias} has no element`)
        element.manifest = manifest
        this.#elements.set(key, element)
      } catch (error) {
        console.error(error)
        if (this._at === at) this._failed = true
        return
      }
    }
    if (this._at === at) this._screen = element
  }

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener('changestate', this.#follow)
    window.addEventListener('popstate', this.#follow)
    window.addEventListener('navigationend', this.#follow)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('changestate', this.#follow)
    window.removeEventListener('popstate', this.#follow)
    window.removeEventListener('navigationend', this.#follow)
  }

  #main() {
    if (this._failed)
      return html`<uui-box headline="This screen could not be opened">
        <p>Try again, and if it still does not open, tell whoever looks after this site.</p>
      </uui-box>`
    return this._screen ?? html`<uui-loader-bar></uui-loader-bar>`
  }

  render() {
    const at = this._at
    if (!at) return nothing
    const main = html`<umb-section-main slot="end"
      ><div class="screen">${this.#main()}</div></umb-section-main
    >`
    if (at.place.menu.length < 2) return main
    return html`<umb-split-panel
      lock="start"
      snap="300px"
      .position=${savedPosition() ?? 'var(--umb-split-panel-initial-position)'}
      @position-changed=${savePosition}
      ><umb-section-sidebar slot="start">
        <nav aria-label=${at.place.label}>
          <h2>${at.place.label}</h2>
          ${at.place.menu.map(
            (screen) =>
              html`<uui-menu-item
                label=${screen.label}
                href=${new URL(screenPath(at.section, at.place, screen), document.baseURI).pathname}
                ?active=${screen.alias === at.screen.alias}
                >${screen.icon ? html`<umb-icon slot="icon" name=${screen.icon}></umb-icon>` : nothing}</uui-menu-item
              >`,
          )}
        </nav>
      </umb-section-sidebar>
      ${main}</umb-split-panel
    >`
  }

  static styles = [
    SPLIT_STYLES,
    css`
      :host {
        display: block;
        height: 100%;
      }
      h2 {
        margin: var(--uui-size-space-5) var(--uui-size-space-5) var(--uui-size-space-3);
        font-size: var(--uui-type-small-size);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--uui-color-text-alt);
      }
      .screen {
        height: 100%;
      }
    `,
  ]
}

customElements.define('crombolo-site-section', CromboloSiteSectionElement)

export default CromboloSiteSectionElement
