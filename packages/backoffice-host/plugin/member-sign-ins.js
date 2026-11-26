/**
 * Story 432: the identity providers a member signs in with, in the member's Info. The
 * provider's id for them shows to the Sensitive data group only; the server decides.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UMB_MEMBER_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/member'

const base = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

export class CromboloMemberSignInsElement extends UmbLitElement {
  static properties = { _items: { state: true } }

  #key

  constructor() {
    super()
    this.consumeContext(UMB_MEMBER_WORKSPACE_CONTEXT, (context) => {
      this.observe(context?.unique, (unique) => {
        if (!unique || unique === this.#key) return
        this.#key = unique
        this.#load(unique)
      })
    })
  }

  async #load(key) {
    try {
      const response = await fetch(`${base()}/crombolo/api/members/${key}/sign-ins`, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      })
      if (!response.ok || key !== this.#key) return
      this._items = (await response.json()).items
    } catch {
      // Left out when it cannot be read: the rest of Info stands.
    }
  }

  render() {
    if (!this._items) return nothing
    return html`<uui-box headline="Signs in with">
      ${
        this._items.length === 0
          ? html`<p>A password on this site only.</p>`
          : html`<ul>
              ${this._items.map(
                (item) =>
                  html`<li>
                    <strong>${item.name}</strong>
                    ${item.declared ? nothing : html`<span class="note">not set up on this site yet</span>`}
                    ${item.subject ? html`<code>${item.subject}</code>` : nothing}
                  </li>`,
              )}
            </ul>`
      }
    </uui-box>`
  }

  static styles = css`
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li + li {
      margin-top: var(--uui-size-space-2);
    }
    .note {
      color: var(--uui-color-text-alt);
      margin-left: var(--uui-size-space-2);
    }
    code {
      display: block;
      color: var(--uui-color-text-alt);
      font-size: var(--uui-type-small-size);
    }
  `
}

customElements.define('crombolo-member-sign-ins', CromboloMemberSignInsElement)

export default CromboloMemberSignInsElement
