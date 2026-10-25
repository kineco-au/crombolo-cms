/**
 * Side panels (story 182): a column beside the back office's main view that an
 * extension's `sidePanel` docks into. `umb-backoffice` renders its header, main
 * and a slot in a column. This adds the panel host beside main inside the
 * shell's shadow root, and a grid stylesheet that puts main and the panel side
 * by side under the header. Main is never re-rendered or moved, so its router
 * and everything open in it carry on; the panel sits outside the router, so
 * moving around keeps it.
 *
 * When the shell no longer has its header and main as expected, nothing is
 * changed: a back office without panels rather than a broken one.
 * `tests/side-panel-plugin.test.ts` fails first.
 */
import { UmbElementMixin } from '@umbraco-cms/backoffice/element-api'
import { UmbExtensionsElementInitializer } from '@umbraco-cms/backoffice/extension-api'
import { umbExtensionsRegistry } from '@umbraco-cms/backoffice/extension-registry'
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'
import {
  modeFor,
  SIDE_PANEL_CONTEXT,
  SIDE_PANEL_TYPE,
  shellIsAsExpected,
  widthForKey,
} from './layout.js'
import './toggle.js'

const SHELL_STYLES = css`
  :host {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: auto minmax(0, 1fr);
  }
  umb-backoffice-header {
    grid-column: 1 / -1;
  }
  umb-backoffice-main {
    grid-column: 1;
    grid-row: 2;
    height: 100%;
    min-width: 0;
  }
  crombolo-side-panel-host {
    grid-column: 2;
    grid-row: 2;
    min-height: 0;
  }
`

/** Docks the panel host into a live shell once; true when this call did. */
export function dockInto(shell) {
  const root = shell?.shadowRoot
  if (!root || root.querySelector('crombolo-side-panel-host')) return false
  const children = [...root.children].map((child) => `<${child.localName}`)
  // `:scope` matches nothing on a shadow root, so main is found among its children.
  const main = [...root.children].find((child) => child.localName === 'umb-backoffice-main')
  if (!main || !shellIsAsExpected(children)) {
    console.warn('Side panels are off: the back office shell no longer renders as expected.')
    return false
  }
  const sheet = SHELL_STYLES.styleSheet
  if (sheet && !root.adoptedStyleSheets.includes(sheet))
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
  main.after(document.createElement('crombolo-side-panel-host'))
  return true
}

/** The header toggles registered for panels that asked for one, by panel alias. */
const toggles = new Map()

/**
 * A panel with `meta.toggle` gets a header button that opens and closes it, so
 * an extension declares one manifest, not two. Removed with its panel.
 */
function syncToggles(manifests) {
  const wanted = new Map(manifests.filter((m) => m.meta?.toggle).map((m) => [m.alias, m]))
  for (const [alias, toggleAlias] of toggles)
    if (!wanted.has(alias)) {
      umbExtensionsRegistry.unregister(toggleAlias)
      toggles.delete(alias)
    }
  for (const [alias, manifest] of wanted) {
    if (toggles.has(alias)) continue
    const toggleAlias = `${alias}.Toggle`
    umbExtensionsRegistry.register({
      type: 'headerApp',
      alias: toggleAlias,
      name: `${manifest.name ?? alias} toggle`,
      elementName: 'crombolo-side-panel-toggle',
      weight: manifest.weight ?? 0,
      meta: {
        panel: alias,
        label: manifest.meta?.label ?? manifest.name,
        icon: manifest.meta?.icon,
      },
    })
    toggles.set(alias, toggleAlias)
  }
}

export class CromboloSidePanelHostElement extends UmbElementMixin(LitElement) {
  static properties = {
    _active: { state: true },
    _width: { state: true },
    _windowWidth: { state: true },
    _panels: { state: true },
  }

  #context = undefined
  #onResize = () => {
    this._windowWidth = window.innerWidth
    this.#context?.refit()
  }

  constructor() {
    super()
    this._active = null
    this._width = 0
    this._windowWidth = window.innerWidth
    this._panels = []
    this.consumeContext(SIDE_PANEL_CONTEXT, (context) => {
      this.#context = context
      if (!context) return
      this.observe(context.active, (active) => {
        const was = this._active
        this._active = active
        if (was && !active) this.#returnFocus()
        if (active) this.updateComplete.then(() => this.#takeFocus())
      })
      this.observe(context.width, (width) => {
        this._width = width
      })
      context.setPanels(this._panels.map((c) => c.manifest))
    })
    new UmbExtensionsElementInitializer(
      this,
      umbExtensionsRegistry,
      SIDE_PANEL_TYPE,
      null,
      (permitted) => {
        this._panels = permitted
        this.#context?.setPanels(permitted.map((c) => c.manifest))
        syncToggles(permitted.map((c) => c.manifest))
      },
    )
  }

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener('resize', this.#onResize)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('resize', this.#onResize)
  }

  get #mode() {
    return modeFor(this._windowWidth, this._width)
  }

  get #manifest() {
    return this._panels.find((c) => c.manifest.alias === this._active)?.manifest
  }

  #takeFocus() {
    const request = this.#context?.focusRequest
    if (!request) return
    this.#returnTo = request.returnFocusTo
    this.#context.focusRequest = undefined
    this.renderRoot.querySelector('#panel')?.focus()
  }

  /** The toggle that opened the panel from the keyboard, given focus back on close. */
  #returnTo = undefined
  #returnFocus() {
    const target = this.#returnTo
    this.#returnTo = undefined
    target?.focus?.()
  }

  #onKeydown(event) {
    if (event.key === 'Escape' && this.#mode === 'sheet') {
      event.stopPropagation()
      this.#context?.close()
    }
  }

  #onSplitterKey(event) {
    const next = widthForKey(event.key, this._width, this.#manifest?.meta, this._windowWidth)
    if (next === undefined) return
    event.preventDefault()
    this.#context?.setWidth(next)
  }

  #onSplitterDown(event) {
    const splitter = event.currentTarget
    splitter.setPointerCapture(event.pointerId)
    const move = (e) => this.#context?.setWidth(window.innerWidth - e.clientX)
    const up = () => {
      splitter.removeEventListener('pointermove', move)
      splitter.removeEventListener('pointerup', up)
    }
    splitter.addEventListener('pointermove', move)
    splitter.addEventListener('pointerup', up)
  }

  render() {
    const manifest = this.#manifest
    const open = Boolean(manifest)
    const sheet = this.#mode === 'sheet'
    const label = manifest?.meta?.label ?? manifest?.name ?? ''
    const limits = this.#context?.limits() ?? { min: 0, max: 0 }
    this.toggleAttribute('open', open)
    this.toggleAttribute('sheet', open && sheet)
    // Every panel's element stays mounted, hidden while another is open, so its
    // state outlives closing and opening as well as navigation.
    const bodies = this._panels.map(
      (c) =>
        html`<div class="body" ?hidden=${c.manifest.alias !== this._active}>${c.component}</div>`,
    )
    return html`
      ${
        open && !sheet
          ? html`<div
              class="splitter"
              role="separator"
              tabindex="0"
              aria-orientation="vertical"
              aria-label=${`Resize ${label}`}
              aria-controls="panel"
              aria-valuenow=${this._width}
              aria-valuemin=${limits.min}
              aria-valuemax=${limits.max}
              @keydown=${this.#onSplitterKey}
              @pointerdown=${this.#onSplitterDown}></div>`
          : nothing
      }
      <div
        id="panel"
        tabindex="-1"
        role=${sheet ? 'dialog' : 'complementary'}
        aria-modal=${sheet ? 'true' : nothing}
        aria-label=${label || nothing}
        ?hidden=${!open}
        style=${sheet ? '' : `width: ${this._width}px`}
        @keydown=${this.#onKeydown}>
        <div class="header">
          <span class="label">${label}</span>
          <uui-button compact look="secondary" label="Close" @click=${() => this.#context?.close()}>
            <uui-icon name="icon-delete"></uui-icon>
          </uui-button>
        </div>
        ${bodies}
      </div>
    `
  }

  static styles = css`
    :host {
      display: none;
      height: 100%;
      background: var(--uui-color-surface);
    }
    :host([open]) {
      display: flex;
    }
    :host([sheet]) {
      position: fixed;
      inset: 0;
      z-index: 1000;
    }
    .splitter {
      width: 6px;
      cursor: col-resize;
      background: var(--uui-color-divider);
      flex: none;
    }
    .splitter:focus-visible {
      outline: 2px solid var(--uui-color-focus);
    }
    #panel {
      display: flex;
      flex-direction: column;
      min-width: 0;
      height: 100%;
      animation: slide 160ms ease-out;
    }
    #panel[hidden] {
      display: none;
    }
    :host([sheet]) #panel {
      width: 100%;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--uui-size-space-3) var(--uui-size-space-4);
      border-bottom: 1px solid var(--uui-color-divider);
    }
    .label {
      font-weight: 700;
    }
    .body {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }
    .body[hidden] {
      display: none;
    }
    @keyframes slide {
      from {
        transform: translateX(16px);
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      #panel {
        animation: none;
      }
    }
  `
}

customElements.define('crombolo-side-panel-host', CromboloSidePanelHostElement)

// A back-office entry point's host is the live `umb-backoffice`, rendered by
// the time this module loads; a new shell (after signing in again) runs it again.
export const onInit = async (host) => {
  await host?.updateComplete
  dockInto(host)
}
