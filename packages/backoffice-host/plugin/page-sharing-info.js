/**
 * The document workspace's note of whether a page's copies are shared, and
 * the files that make it each member's (story 264). Registered by
 * `page-sharing.js`; asked again each time the page is opened.
 */
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { describeSharing, fileEditorHref, readPageSharing } from './page-sharing.js'

export default class CromboloPageSharingInfoElement extends UmbLitElement {
  static properties = {
    _said: { state: true },
  }

  #unique

  constructor() {
    super()
    this._said = undefined
    this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (context) => {
      this.observe(context?.unique, (unique) => {
        if (!unique || unique === this.#unique) return
        this.#unique = unique
        readPageSharing(unique).then(
          (state) => {
            this._said = describeSharing(state)
          },
          () => {
            this._said = undefined
          },
        )
      })
    })
  }

  render() {
    if (!this._said) return nothing
    return html`<umb-workspace-info-app-layout headline="Sharing">
      <div class="body">
        <p>${this._said.text}</p>
        ${
          this._said.files.length
            ? html`<ul>
                ${this._said.files.map(
                  (file) =>
                    html`<li><a href=${fileEditorHref(file)}>${file.replace(/^\//, '')}</a></li>`,
                )}
              </ul>`
            : nothing
        }
      </div>
    </umb-workspace-info-app-layout>`
  }

  static styles = css`
    .body {
      padding: var(--uui-size-space-4, 12px) var(--uui-size-space-5, 18px);
    }
    p {
      margin: 0;
    }
    ul {
      margin: var(--uui-size-space-3, 9px) 0 0;
      padding-left: var(--uui-size-space-5, 18px);
    }
  `
}

customElements.define('crombolo-page-sharing-info', CromboloPageSharingInfoElement)
