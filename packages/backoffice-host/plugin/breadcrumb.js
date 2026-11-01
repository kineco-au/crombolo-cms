/**
 * A trail of links to where a page sits (story 234): UUI's breadcrumbs, as
 * Umbraco's own editors show them, given `items` of `{ label, href? }`. The last
 * item is the page itself; an item without `href` is not a link.
 */
import { html, ifDefined } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'

export class CromboloBreadcrumbElement extends UmbLitElement {
  static properties = { items: { attribute: false } }

  constructor() {
    super()
    this.items = []
  }

  render() {
    return html`<nav aria-label="Breadcrumb">
      <uui-breadcrumbs>
        ${this.items.map(
          (item) =>
            html`<uui-breadcrumb-item href=${ifDefined(item.href)}>${item.label}</uui-breadcrumb-item>`,
        )}
      </uui-breadcrumbs>
    </nav>`
  }
}

customElements.define('crombolo-breadcrumb', CromboloBreadcrumbElement)
