/**
 * Crombolo's strong buttons: a tone from the palette filling the button, with light text
 * on it. `<crombolo-button tone="accent">` is the button on its own; `toned()` gives an
 * element whose `uui-button`s are drawn `look="primary" color="positive"` the tone
 * instead, which is how the content footer's actions take one.
 *
 * A tone redefines the positive colour tokens on the element's host, so every
 * `uui-button` inside it, and inside its own children's shadow roots, reads them.
 */
import { css, html, LitElement, unsafeCSS } from '@umbraco-cms/backoffice/external/lit'

/** The tones, each defined in `theme.css` as `--crombolo-button-<tone>` and `-hover`. */
export const TONES = ['cocoa', 'accent', 'positive']

/** The tokens a positive, primary `uui-button` reads, set to a tone's. Pure. */
export const toneTokens = (tone) =>
  [
    `--uui-color-positive: var(--crombolo-button-${tone})`,
    `--uui-color-positive-standalone: var(--crombolo-button-${tone})`,
    `--uui-color-positive-emphasis: var(--crombolo-button-${tone}-hover)`,
    '--uui-color-positive-contrast: var(--crombolo-button-text)',
  ].join('; ')

/** A host's styles for a tone. */
export const toneStyles = (tone) => css`
  :host {
    ${unsafeCSS(toneTokens(tone))};
  }
`

/** `Base` with its buttons drawn in `tone`. */
export const toned = (Base, tone) =>
  class extends Base {
    static styles = [...[Base.styles ?? []].flat(), toneStyles(tone)]
  }

/** What a toned element asks its buttons for, in a manifest's `meta`. */
export const TONED_META = { look: 'primary', color: 'positive' }

export class CromboloButtonElement extends LitElement {
  static properties = {
    tone: { reflect: true },
    label: {},
    href: {},
    disabled: { type: Boolean, reflect: true },
    state: {},
    type: {},
  }

  static styles = [
    ...TONES.map(
      (tone) => css`
        :host([tone='${unsafeCSS(tone)}']) {
          ${unsafeCSS(toneTokens(tone))};
        }
      `,
    ),
    css`
      :host {
        display: inline-block;
      }
      uui-button {
        width: 100%;
      }
    `,
  ]

  constructor() {
    super()
    this.tone = 'accent'
    this.label = ''
    this.disabled = false
    this.type = 'button'
  }

  render() {
    return html`<uui-button
      look="primary"
      color="positive"
      type=${this.type}
      label=${this.label}
      .href=${this.href}
      .state=${this.state}
      ?disabled=${this.disabled}
      ><slot>${this.label}</slot></uui-button
    >`
  }
}

if (!customElements.get('crombolo-button'))
  customElements.define('crombolo-button', CromboloButtonElement)
