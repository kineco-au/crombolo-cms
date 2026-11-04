/**
 * "A personalised part" from a view's Insert menu (story 264): pick an existing
 * view, or name a new one, made from the "Personalised part" starter. Answers
 * the view's path; `view-parts.js` writes its tag and import. Registered by
 * `tsx-editors.js`.
 */
import { PartialViewService } from '@umbraco-cms/backoffice/external/backend-api'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbModalBaseElement, umbOpenModal } from '@umbraco-cms/backoffice/modal'
import { UMB_PARTIAL_VIEW_PICKER_MODAL } from '@umbraco-cms/backoffice/partial-view'
import { componentName, partFileName } from './view-parts.js'

export default class CromboloPersonalisedPartModalElement extends UmbModalBaseElement {
  static properties = {
    _name: { state: true },
    _busy: { state: true },
    _message: { state: true },
  }

  constructor() {
    super()
    this._name = ''
    this._busy = false
    this._message = ''
  }

  async #pick() {
    const picked = await umbOpenModal(this, UMB_PARTIAL_VIEW_PICKER_MODAL).catch(() => undefined)
    const unique = picked?.selection?.[0]
    if (!unique) return
    this.value = { path: decodeURIComponent(unique).replace('%dot%', '.') }
    this._submitModal()
  }

  async #make() {
    const name = partFileName(this._name)
    if (!name) {
      this._message = 'Give the part a name.'
      return
    }
    this._busy = true
    this._message = ''
    try {
      const { data: starter } = await PartialViewService.getPartialViewSnippetById({
        path: { id: 'PersonalisedPart' },
      })
      const content = (starter?.content ?? '').replace(
        'function Greeting',
        `function ${componentName(name)}`,
      )
      await PartialViewService.postPartialView({ body: { name, parent: null, content } })
      this.value = { path: `/${name}` }
      this._submitModal()
    } catch {
      this._message = 'The part could not be made. Is there already one with that name?'
    } finally {
      this._busy = false
    }
  }

  render() {
    return html`<umb-body-layout headline="A personalised part">
      <uui-box>
        <p>
          A part that shows the signed-in visitor, fetched for each visitor after the page loads, so
          the rest of the page is shared.
        </p>
        <uui-button look="secondary" label="Choose an existing part" @click=${() => this.#pick()}
          >Choose an existing part</uui-button
        >
      </uui-box>
      <uui-box headline="Or make a new one">
        <uui-label for="name">Name</uui-label>
        <uui-input
          id="name"
          label="Name"
          placeholder="User menu"
          .value=${this._name}
          @input=${(event) => {
            this._name = event.target.value
          }}></uui-input>
        ${this._message ? html`<p class="problem" role="alert">${this._message}</p>` : nothing}
      </uui-box>
      <uui-button slot="actions" label="Cancel" @click=${() => this._rejectModal()}
        >Cancel</uui-button
      >
      <uui-button
        slot="actions"
        look="primary"
        color="positive"
        label="Make it"
        ?disabled=${this._busy}
        @click=${() => this.#make()}
        >Make it</uui-button
      >
    </umb-body-layout>`
  }

  static styles = css`
    uui-box + uui-box {
      margin-top: var(--uui-size-space-5, 18px);
    }
    uui-input {
      width: 100%;
    }
    .problem {
      color: var(--uui-color-danger);
    }
  `
}

customElements.define('crombolo-personalised-part-modal', CromboloPersonalisedPartModalElement)
