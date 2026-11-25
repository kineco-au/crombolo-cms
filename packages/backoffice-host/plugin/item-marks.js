/**
 * `crombolo-item-marks`: what the workspace this tab is in holds of one item, drawn
 * after its name in every tree. A dot in the workspace's colour for an item it changed,
 * with a word where more is to be said (New, Moved, Deleted); a fainter dot for an item
 * that only holds a changed one below it; nothing for one that is as Shared has it.
 * Each tree gives it the item's `unique`, and it is the same element in all of them.
 */
import { colourOf, MARK_WORDS, markOf } from './workspace-client.js'
import { marksNow, watchMarks } from './workspace-marks.js'

const STYLE = `
  :host { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; padding-left: 8px; }
  :host([hidden]) { display: none; }
  .tag {
    padding: 0 7px;
    border: 1px solid var(--mark);
    border-radius: 9px;
    color: var(--mark);
    font-size: 11px;
    font-weight: 700;
    line-height: 16px;
    white-space: nowrap;
  }
  .tag.deleted { border-color: var(--uui-color-danger, #a3271c); color: var(--uui-color-danger, #a3271c); }
  .dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--mark); }
  .dot.below { opacity: 0.35; }
`

export class CromboloItemMarksElement extends HTMLElement {
  #unique
  #stop
  entityType

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  get unique() {
    return this.#unique
  }

  set unique(value) {
    if (value === this.#unique) return
    this.#unique = value
    this.#draw()
  }

  connectedCallback() {
    this.#stop = watchMarks(() => this.#draw())
    this.#draw()
  }

  disconnectedCallback() {
    this.#stop?.()
  }

  #draw() {
    const { workspace, marks } = marksNow()
    const mark = workspace ? markOf(marks, this.#unique) : undefined
    this.hidden = !mark
    if (!mark) {
      this.shadowRoot.replaceChildren()
      this.removeAttribute('title')
      return
    }
    const words = MARK_WORDS[mark]
    this.title = `${words.says} in ${workspace.name}`
    this.style.setProperty('--mark', colourOf(workspace.key))
    const style = document.createElement('style')
    style.textContent = STYLE
    const parts = [style]
    if (words.tag) {
      const tag = document.createElement('span')
      tag.className = `tag ${mark}`
      tag.textContent = words.tag
      parts.push(tag)
    }
    const dot = document.createElement('span')
    dot.className = `dot ${mark}`
    dot.setAttribute('role', 'img')
    dot.setAttribute('aria-label', this.title)
    parts.push(dot)
    this.shadowRoot.replaceChildren(...parts)
  }
}

if (!customElements.get('crombolo-item-marks'))
  customElements.define('crombolo-item-marks', CromboloItemMarksElement)
