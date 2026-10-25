/**
 * The side-panel context (story 182), provided for the whole back office and
 * consumed by its string alias, `Crombolo.Context.SidePanel`, so an extension
 * imports nothing of ours. One panel is open at a time; which one and how wide
 * are remembered per user in this browser.
 */
import { UmbContextBase } from '@umbraco-cms/backoffice/class-api'
import { UMB_CURRENT_USER_CONTEXT } from '@umbraco-cms/backoffice/current-user'
import {
  UmbNumberState,
  UmbObjectState,
  UmbStringState,
} from '@umbraco-cms/backoffice/observable-api'
import { clampWidth, limitsOf, maxWidthFor, SIDE_PANEL_CONTEXT, store, stored } from './layout.js'

export class CromboloSidePanelContext extends UmbContextBase {
  #active = new UmbStringState(null)
  #width = new UmbNumberState(0)
  #available = new UmbObjectState({})
  /** alias → the panel's meta, as the host found it registered. */
  #panels = new Map()
  #userKey = undefined
  #remembered = { open: null, widths: {} }
  #restored = false
  /** Set by `open(…, { focus, returnFocusTo })`, read once by the host. */
  focusRequest = undefined

  /** The open panel's alias, or null. */
  active = this.#active.asObservable()
  /** The open panel's width in pixels. */
  width = this.#width.asObservable()
  /** alias → false for a panel its extension has said is unavailable. */
  available = this.#available.asObservable()

  constructor(host) {
    super(host, SIDE_PANEL_CONTEXT)
    this.consumeContext(UMB_CURRENT_USER_CONTEXT, (user) => {
      this.observe(user?.unique, (unique) => {
        if (!unique || unique === this.#userKey) return
        this.#userKey = unique
        this.#remembered = stored(unique)
        this.#restored = false
        this.#restore()
      })
    })
  }

  /** The host's list of declared panels; a closed one that is gone stays closed. */
  setPanels(manifests) {
    this.#panels = new Map(manifests.map((m) => [m.alias, m.meta ?? {}]))
    const active = this.#active.getValue()
    if (active && !this.#panels.has(active)) this.#active.setValue(null)
    this.#restore()
  }

  isAvailable(alias) {
    return this.#panels.has(alias) && this.#available.getValue()[alias] !== false
  }

  open(alias, options = {}) {
    if (!this.isAvailable(alias)) return false
    this.focusRequest = options.focus ? options : undefined
    this.#width.setValue(this.#widthFor(alias, this.#remembered.widths[alias]))
    this.#active.setValue(alias)
    this.#save()
    return true
  }

  close() {
    if (this.#active.getValue() === null) return
    this.#active.setValue(null)
    this.#save()
  }

  toggle(alias, options = {}) {
    if (this.#active.getValue() === alias) this.close()
    else this.open(alias, options)
  }

  /** The splitter's width for the open panel, within its limits. */
  setWidth(width) {
    const alias = this.#active.getValue()
    if (!alias) return
    const clamped = this.#widthFor(alias, width)
    this.#width.setValue(clamped)
    this.#remembered.widths = { ...this.#remembered.widths, [alias]: clamped }
    this.#save()
  }

  /** The open panel's limits, for the splitter's aria values. */
  limits() {
    const alias = this.#active.getValue()
    const meta = alias ? this.#panels.get(alias) : undefined
    const { min } = limitsOf(meta)
    return { min, max: maxWidthFor(meta, globalThis.innerWidth ?? 1280) }
  }

  /** An extension's say on whether its panel can be used now; an open one closes. */
  setAvailable(alias, available) {
    this.#available.setValue({ ...this.#available.getValue(), [alias]: available !== false })
    if (available === false && this.#active.getValue() === alias) this.close()
  }

  /** The window changed size: the open panel's width is clamped again. */
  refit() {
    const alias = this.#active.getValue()
    if (alias) this.#width.setValue(this.#widthFor(alias, this.#width.getValue()))
  }

  #widthFor(alias, width) {
    return clampWidth(width, this.#panels.get(alias), globalThis.innerWidth ?? 1280)
  }

  #restore() {
    if (this.#restored || this.#userKey === undefined || this.#panels.size === 0) return
    this.#restored = true
    const open = this.#remembered.open
    if (open && this.isAvailable(open)) this.open(open)
  }

  #save() {
    if (this.#userKey === undefined) return
    this.#remembered = { ...this.#remembered, open: this.#active.getValue() }
    store(this.#userKey, this.#remembered)
  }
}

export { CromboloSidePanelContext as api }
