/**
 * The Bundle Editor (story 233), in place of Umbraco's package builder: its
 * manifest declares `overwrites: ['Umb.Workspace.PackageBuilder']`, so the
 * Created view's routes open this one. Umbraco's builder draws its form as the
 * workspace editor's default content, which no added tab can sit beside; here
 * every part of the bundle is a workspace view, so another tab is one more
 * registration (docs/bundles.md, "Created packages").
 */
import { UmbContextBase } from '@umbraco-cms/backoffice/class-api'
import { css, html, ifDefined, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement, umbFocus } from '@umbraco-cms/backoffice/lit-element'
import { UMB_NOTIFICATION_CONTEXT } from '@umbraco-cms/backoffice/notification'
import { UmbTextStyles } from '@umbraco-cms/backoffice/style'
import { UMB_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/workspace'
import { CromboloBundleEditorContext } from './bundle-editor-context.js'
import { BUNDLE_EDITOR_ALIAS } from './bundle-editor-routing.js'

/** The workspace this is, as the views' conditions and Umbraco's workspace editor read it. */
class CromboloBundleWorkspaceContext extends UmbContextBase {
  workspaceAlias = BUNDLE_EDITOR_ALIAS
  #unique

  constructor(host, unique) {
    super(host, UMB_WORKSPACE_CONTEXT)
    this.#unique = unique
  }

  getEntityType() {
    return 'package-builder'
  }

  getUnique() {
    return this.#unique()
  }
}

export default class CromboloBundleEditorElement extends UmbLitElement {
  static properties = {
    entityUnique: { type: String },
    _definition: { state: true },
    _submitState: { state: true },
  }

  #context = new CromboloBundleEditorContext(this)
  #notifications

  constructor() {
    super()
    // What a workspace view's `Umb.Condition.WorkspaceAlias` reads, so the tabs
    // registered for this workspace are shown.
    new CromboloBundleWorkspaceContext(this, () => this.#context.value?.unique)
    this.consumeContext(UMB_NOTIFICATION_CONTEXT, (context) => {
      this.#notifications = context
    })
    this.observe(this.#context.definition, (definition) => {
      this._definition = definition
    })
  }

  connectedCallback() {
    super.connectedCallback()
    void this.#context.load(this.entityUnique)
  }

  async #save() {
    if (!this._definition?.name?.trim()) {
      this.#notifications?.peek('danger', { data: { message: 'Give the bundle a name first' } })
      return
    }
    const created = !this._definition.unique
    this._submitState = 'waiting'
    try {
      const unique = await this.#context.save()
      if (!unique) throw new Error('not saved')
      this._submitState = 'success'
      this.#notifications?.peek('positive', {
        data: { message: created ? 'Bundle created' : 'Bundle saved' },
      })
    } catch {
      this._submitState = 'failed'
    }
  }

  render() {
    return html`
      <umb-workspace-editor back-path="section/packages/view/created">
        ${
          this._definition
            ? html`<div id="header" slot="header">
              <uui-input
                id="name"
                required
                label="Name of the bundle"
                placeholder="Enter a name"
                ${umbFocus()}
                .value=${this._definition.name ?? ''}
                @input=${(event) => this.#context.update({ name: event.target.value })}></uui-input>
            </div>`
            : nothing
        }
        <div slot="actions">
          ${
            this._definition?.unique
              ? html`<uui-button
                look="secondary"
                label="Download"
                @click=${() => this.#context.download()}></uui-button>`
              : nothing
          }
          <uui-button
            color="positive"
            look="primary"
            state=${ifDefined(this._submitState)}
            label=${this._definition?.unique ? 'Save' : 'Create'}
            @click=${this.#save}></uui-button>
        </div>
      </umb-workspace-editor>
    `
  }

  static styles = [
    UmbTextStyles,
    css`
      :host {
        display: block;
        height: 100%;
      }
      #header {
        display: flex;
        width: 100%;
        margin-right: var(--uui-size-layout-1);
      }
      uui-input {
        width: 100%;
      }
    `,
  ]
}

customElements.define('crombolo-bundle-editor', CromboloBundleEditorElement)
