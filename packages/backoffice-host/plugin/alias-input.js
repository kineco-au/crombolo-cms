/**
 * An alias beside a name, locked as Umbraco's own editors lock it: while locked
 * it shows what the editor gave it, which for something new follows its name.
 * The lock opens it to be written by hand; for something already saved, it says
 * what that changes. It sends `change` with `value`, as `uui-input` does.
 */
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'

export class CromboloAliasInputElement extends LitElement {
  static properties = {
    value: { type: String },
    label: { type: String },
    readonly: { type: Boolean },
    /** Saved already: changing the alias by hand breaks what names it. */
    saved: { type: Boolean },
    _unlocked: { state: true },
  }

  constructor() {
    super()
    this.value = ''
    this.label = 'Alias'
    this._unlocked = false
  }

  #toggle() {
    this._unlocked = !this._unlocked
    if (this._unlocked)
      this.updateComplete.then(() => this.renderRoot.querySelector('uui-input')?.focus())
  }

  render() {
    const locked = this.readonly || !this._unlocked
    return html`<uui-input
        label=${this.label}
        .value=${this.value ?? ''}
        ?readonly=${locked}
        @change=${(event) => {
          event.stopPropagation()
          this.value = event.target.value.trim()
          this.dispatchEvent(new Event('change', { bubbles: true }))
        }}
      >
        ${
          this.readonly
            ? nothing
            : html`<uui-button
                slot="prepend"
                compact
                label=${locked ? `Unlock ${this.label} to change it` : `Lock ${this.label}`}
                @click=${this.#toggle}
              >
                <umb-icon name=${locked ? 'icon-lock' : 'icon-unlocked'}></umb-icon>
              </uui-button>`
        }
      </uui-input>
      ${
        this._unlocked && this.saved
          ? html`<p class="warning" role="status">
              Anything that uses the old alias stops finding this once it is saved.
            </p>`
          : nothing
      }`
  }

  static styles = css`
    :host {
      display: block;
    }
    uui-input {
      width: 100%;
    }
    uui-input[readonly] {
      color: var(--uui-color-text-alt);
    }
    .warning {
      margin: var(--uui-size-space-1) 0 0;
      color: var(--uui-color-warning-standalone, var(--uui-color-warning));
      font-size: var(--uui-type-small-size);
    }
  `
}

if (!customElements.get('crombolo-alias-input'))
  customElements.define('crombolo-alias-input', CromboloAliasInputElement)
