/**
 * The panel behind "View as a group…" (story 314): the groups to tick, and a
 * button that starts the view and reloads the back office into it.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbModalBaseElement } from '@umbraco-cms/backoffice/modal'
import { readViewAs, reloadBackOffice, startViewAs } from './view-as.js'
import { PANEL_NOTE, startButton } from './view-as-words.js'

export default class CromboloViewAsModalElement extends UmbModalBaseElement {
  static properties = {
    _groups: { state: true },
    _chosen: { state: true },
    _busy: { state: true },
    _message: { state: true },
  }

  constructor() {
    super()
    this._groups = undefined
    this._chosen = []
    this._busy = false
    this._message = ''
  }

  connectedCallback() {
    super.connectedCallback()
    this.#load()
  }

  async #load() {
    try {
      const status = await readViewAs()
      this._groups = status.groups
      this._chosen = status.viewing?.groups.map((g) => g.key) ?? []
    } catch (error) {
      this._message = error.message
    }
  }

  #toggle(key, on) {
    this._chosen = on ? [...this._chosen, key] : this._chosen.filter((k) => k !== key)
  }

  async #start() {
    this._busy = true
    this._message = ''
    try {
      await startViewAs(this._chosen)
      reloadBackOffice()
    } catch (error) {
      this._message = error.message
      this._busy = false
    }
  }

  render() {
    const button = startButton(this._chosen)
    return html`<umb-body-layout headline="View as a group">
      <p>${PANEL_NOTE}</p>
      ${
        this._groups
          ? html`<ul>
              ${this._groups.map(
                (group) => html`<li>
                  <uui-checkbox
                    label=${group.name}
                    ?checked=${this._chosen.includes(group.key)}
                    @change=${(event) => this.#toggle(group.key, event.target.checked)}
                    >${group.name}</uui-checkbox
                  >
                </li>`,
              )}
            </ul>`
          : this._message
            ? nothing
            : html`<uui-loader></uui-loader>`
      }
      ${this._message ? html`<p class="problem" role="alert">${this._message}</p>` : nothing}
      <uui-button slot="actions" label="Cancel" @click=${() => this._rejectModal()}
        >Cancel</uui-button
      >
      <uui-button
        slot="actions"
        look="primary"
        color="positive"
        label=${button.label}
        ?disabled=${this._busy || !button.enabled}
        @click=${() => this.#start()}
        >${button.label}</uui-button
      >
    </umb-body-layout>`
  }

  static styles = css`
    ul {
      list-style: none;
      margin: var(--uui-size-space-4, 12px) 0;
      padding: 0;
    }
    li {
      padding: var(--uui-size-space-2, 6px) 0;
    }
    .problem {
      color: var(--uui-color-danger);
    }
  `
}

customElements.define('crombolo-view-as-modal', CromboloViewAsModalElement)
