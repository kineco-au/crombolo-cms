/**
 * A side panel's header button (story 182), registered by the host for a
 * `sidePanel` whose meta says `toggle: true`. It opens and closes that panel,
 * and hides while the panel is unavailable.
 */
import { UmbElementMixin } from '@umbraco-cms/backoffice/element-api'
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'
import { SIDE_PANEL_CONTEXT } from './layout.js'

export default class CromboloSidePanelToggleElement extends UmbElementMixin(LitElement) {
  static properties = {
    manifest: { attribute: false },
    _active: { state: true },
    _available: { state: true },
  }

  #context = undefined

  constructor() {
    super()
    this._active = null
    this._available = {}
    this.consumeContext(SIDE_PANEL_CONTEXT, (context) => {
      this.#context = context
      if (!context) return
      this.observe(context.active, (active) => {
        this._active = active
      })
      this.observe(context.available, (available) => {
        this._available = available
      })
    })
  }

  get #panel() {
    return this.manifest?.meta?.panel
  }

  #toggle(event) {
    // `detail` is 0 for a click made with the keyboard: only then does focus move in.
    const fromKeyboard = event.detail === 0
    this.#context?.toggle(this.#panel, {
      focus: fromKeyboard,
      returnFocusTo: fromKeyboard ? this.renderRoot.querySelector('uui-button') : undefined,
    })
  }

  render() {
    const panel = this.#panel
    if (!panel || this._available[panel] === false) return nothing
    const label = this.manifest?.meta?.label ?? this.manifest?.name ?? panel
    const open = this._active === panel
    return html`<uui-button
      compact
      look="primary"
      label=${label}
      title=${label}
      aria-expanded=${open ? 'true' : 'false'}
      aria-controls="panel"
      @click=${this.#toggle}>
      <uui-icon name=${this.manifest?.meta?.icon ?? 'icon-layout'}></uui-icon>
    </uui-button>`
  }

  static styles = css`
    uui-button {
      font-size: 18px;
      --uui-button-background-color: transparent;
    }
  `
}

customElements.define('crombolo-side-panel-toggle', CromboloSidePanelToggleElement)
