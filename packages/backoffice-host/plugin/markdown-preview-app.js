/**
 * The preview toolbar's switch for a Markdown File (story 450): its source as
 * served, or rendered as HTML. Shown only when the server says the preview is a
 * Markdown File's (`x-crombolo-markdown`); the choice is a cookie of the editor's
 * own, read by the server's preview. Registered by `file-names.js`.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UMB_PREVIEW_CONTEXT } from '@umbraco-cms/backoffice/preview'
import { MARKDOWN_VIEW_COOKIE, MARKDOWN_VIEW_HEADER, MARKDOWN_VIEWS } from './file-names.js'

export default class CromboloMarkdownPreviewElement extends UmbLitElement {
  static properties = { _view: { state: true } }

  #preview

  constructor() {
    super()
    this._view = undefined
    this.consumeContext(UMB_PREVIEW_CONTEXT, (preview) => {
      this.#preview = preview
      this.observe(preview?.previewUrl, (url) => this.#learn(url))
    })
  }

  async #learn(url) {
    if (!url) return
    try {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store' })
      this._view = response.headers.get(MARKDOWN_VIEW_HEADER) ?? undefined
    } catch {
      this._view = undefined
    }
  }

  #choose(view) {
    if (view === this._view) return
    // biome-ignore lint/suspicious/noDocumentCookie: a view choice only this editor's own preview reads
    document.cookie = `${MARKDOWN_VIEW_COOKIE}=${view}; path=/; SameSite=Lax`
    this._view = view
    // A rendered File is sandboxed, so its document can't be reloaded from here: it is loaded again.
    const frame = this.#preview?.getIFrameWrapper()?.querySelector('iframe')
    if (frame) frame.setAttribute('src', frame.getAttribute('src') ?? frame.src)
  }

  render() {
    if (!this._view) return nothing
    return html`<uui-button-group role="radiogroup" aria-label="Show the Markdown as">
      ${MARKDOWN_VIEWS.map(
        ({ value, label }) => html`<uui-button
          look=${this._view === value ? 'primary' : 'default'}
          compact
          role="radio"
          aria-checked=${this._view === value ? 'true' : 'false'}
          label=${label}
          @click=${() => this.#choose(value)}></uui-button>`,
      )}
    </uui-button-group>`
  }

  static styles = css`
    :host {
      display: flex;
      align-items: center;
    }
  `
}

customElements.define('crombolo-markdown-preview', CromboloMarkdownPreviewElement)
