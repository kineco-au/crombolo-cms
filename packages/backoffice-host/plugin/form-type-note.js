/**
 * A note in the document-type workspace footer for a type made from a form
 * (story 239): it follows the form, so it is changed there, and saving it here
 * is refused.
 */
import { UMB_DOCUMENT_TYPE_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document-type'
import { UmbElementMixin } from '@umbraco-cms/backoffice/element-api'
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'
import { listLibraryTypes } from './forms-client.js'

export default class CromboloFormTypeNoteElement extends UmbElementMixin(LitElement) {
  static properties = { _formName: { state: true } }

  constructor() {
    super()
    this._formName = undefined
    this.consumeContext(UMB_DOCUMENT_TYPE_WORKSPACE_CONTEXT, (context) => {
      if (!context) return
      this.observe(context.unique, (unique) => this.#lookUp(unique))
    })
  }

  async #lookUp(unique) {
    this._formName = undefined
    if (!unique) return
    try {
      const made = (await listLibraryTypes()).find((item) => item.typeKey === unique)
      this._formName = made?.formName
    } catch {
      // Without the list there is nothing to say; the server still refuses a save.
    }
  }

  render() {
    if (!this._formName) return nothing
    return html`<uui-tag
      color="default"
      look="secondary"
      title="This type follows the ${this._formName} form. Change the form in Forms, and this type changes with it."
    >
      Made from the ${this._formName} form: change it in Forms
    </uui-tag>`
  }

  static styles = css`
    :host {
      display: flex;
      align-items: center;
    }
  `
}

customElements.define('crombolo-form-type-note', CromboloFormTypeNoteElement)
