/**
 * A header app that says when the server's extensions changed under an open back
 * office (story 181): a host installed or removed a bundle and reloaded. It
 * offers a reload rather than reloading, so nobody loses what they were typing.
 */
import { UmbElementMixin } from '@umbraco-cms/backoffice/element-api'
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UMB_MANAGEMENT_API_SERVER_EVENT_CONTEXT } from '@umbraco-cms/backoffice/management-api'

export default class CromboloBundlesChangedElement extends UmbElementMixin(LitElement) {
  static properties = { _changed: { state: true } }

  constructor() {
    super()
    this._changed = false
    this.consumeContext(UMB_MANAGEMENT_API_SERVER_EVENT_CONTEXT, (context) => {
      if (!context) return
      this.observe(context.byEventSourcesAndEventTypes(['Crombolo:Bundles'], ['Changed']), () => {
        this._changed = true
      })
    })
  }

  render() {
    if (!this._changed) return nothing
    return html`<uui-tag color="warning" look="primary">
      Extensions changed
      <uui-button compact look="secondary" label="Reload to use them" @click=${() => window.location.reload()}>
        Reload to use them
      </uui-button>
    </uui-tag>`
  }

  static styles = css`
    :host { display: flex; align-items: center; padding: 0 var(--uui-size-space-3); }
    uui-tag { gap: var(--uui-size-space-2); }
  `
}

customElements.define('crombolo-bundles-changed', CromboloBundlesChangedElement)
