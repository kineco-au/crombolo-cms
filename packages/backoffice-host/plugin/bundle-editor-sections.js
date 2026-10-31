/**
 * The Bundle Editor's tabs (story 233): each a workspace view drawing part of
 * the definition with the inputs Umbraco's own package builder is made of, and
 * writing back through the editor's context.
 */
import { UmbDictionaryPickerInputContext } from '@umbraco-cms/backoffice/dictionary'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UmbPartialViewPickerInputContext } from '@umbraco-cms/backoffice/partial-view'
import { UmbScriptPickerInputContext } from '@umbraco-cms/backoffice/script'
import { UmbServerFilePathUniqueSerializer } from '@umbraco-cms/backoffice/server-file-system'
import { UmbTextStyles } from '@umbraco-cms/backoffice/style'
import { UmbStylesheetPickerInputContext } from '@umbraco-cms/backoffice/stylesheet'
import { UmbTemplatePickerInputContext } from '@umbraco-cms/backoffice/template'
import { CROMBOLO_BUNDLE_EDITOR_CONTEXT } from './bundle-editor-context.js'

const paths = new UmbServerFilePathUniqueSerializer()

/** One tab: the definition from the editor's context, and a box of fields. */
export class CromboloBundleEditorView extends UmbLitElement {
  static properties = { _definition: { state: true } }

  /** The tab's headline. */
  headline = ''

  constructor() {
    super()
    this.consumeContext(CROMBOLO_BUNDLE_EDITOR_CONTEXT, (context) => {
      this.context = context
      // Called again with nothing as the tab is taken down.
      if (!context) return
      this.observe(context.definition, (definition) => {
        this._definition = definition
      })
    })
  }

  /** Writes part of the definition back. */
  set(patch) {
    this.context?.update(patch)
  }

  /** The tab's fields, given the definition. */
  fields() {
    return nothing
  }

  render() {
    if (!this._definition) return nothing
    return html`<uui-box headline=${this.headline}>${this.fields(this._definition)}</uui-box>`
  }

  static styles = [
    UmbTextStyles,
    css`
      :host {
        display: block;
        padding: var(--uui-size-layout-1);
      }
      uui-checkbox {
        margin-top: var(--uui-size-space-4);
      }
    `,
  ]
}

const field = (label, editor, description) =>
  html`<umb-property-layout label=${label} description=${description ?? ''}>
    <div slot="editor">${editor}</div>
  </umb-property-layout>`

/** Content: a page and optionally its children, media, and Library elements. */
export class CromboloBundleContentView extends CromboloBundleEditorView {
  headline = 'Content'

  fields(d) {
    return html`
      ${field(
        'Content',
        html`<umb-input-document
            max="1"
            .value=${d.contentNodeId ?? undefined}
            @change=${(event) => {
              const contentNodeId = event.target.selection[0]
              this.set({
                contentNodeId,
                contentLoadChildNodes: contentNodeId ? d.contentLoadChildNodes : false,
              })
            }}></umb-input-document>
          <uui-checkbox
            label="Include the pages below it"
            .checked=${d.contentLoadChildNodes ?? false}
            .disabled=${!d.contentNodeId}
            @change=${(event) => this.set({ contentLoadChildNodes: event.target.checked })}
            >Include the pages below it</uui-checkbox
          >`,
        'The page the bundle starts from',
      )}
      ${field(
        'Media',
        html`<umb-input-media
            multiple
            .selection=${d.mediaIds ?? []}
            @change=${(event) => {
              const mediaIds = event.target.selection ?? []
              this.set({
                mediaIds,
                mediaLoadChildNodes: mediaIds.length ? d.mediaLoadChildNodes : false,
              })
            }}></umb-input-media>
          <uui-checkbox
            label="Include what is inside them"
            .checked=${d.mediaLoadChildNodes ?? false}
            .disabled=${!d.mediaIds?.length}
            @change=${(event) => this.set({ mediaLoadChildNodes: event.target.checked })}
            >Include what is inside them</uui-checkbox
          >`,
      )}
      ${field(
        'Library elements',
        html`<umb-input-element
          .selection=${d.elementIds ?? []}
          @change=${(event) => this.set({ elementIds: event.target.selection ?? [] })}></umb-input-element>`,
      )}
    `
  }
}

/** Types: document, media and data types. */
export class CromboloBundleTypesView extends CromboloBundleEditorView {
  headline = 'Types'

  fields(d) {
    return html`
      ${field(
        'Document types',
        html`<umb-input-document-type
          .selection=${d.documentTypes ?? []}
          @change=${(event) => this.set({ documentTypes: event.target.selection ?? [] })}></umb-input-document-type>`,
      )}
      ${field(
        'Media types',
        html`<umb-input-media-type
          .selection=${d.mediaTypes ?? []}
          @change=${(event) => this.set({ mediaTypes: event.target.selection ?? [] })}></umb-input-media-type>`,
      )}
      ${field(
        'Data types',
        html`<umb-data-type-input
          .selection=${d.dataTypes ?? []}
          @change=${(event) => this.set({ dataTypes: event.target.selection ?? [] })}></umb-data-type-input>`,
      )}
      <crombolo-bundle-brought-types></crombolo-bundle-brought-types>
    `
  }
}

/** A list of server files (stylesheets, scripts, partial views) as the builder keeps them. */
const filePicker = (view, d, key, icon, pickerContext) =>
  html`<umb-input-entity
    .getIcon=${() => icon}
    .pickerContext=${pickerContext}
    .selection=${(d[key] ?? []).map((path) => paths.toUnique(path))}
    @change=${(event) =>
      view.set({
        [key]: (event.target.selection ?? []).map((unique) => paths.toServerPath(unique)),
      })}></umb-input-entity>`

/** Code: templates, partial views, stylesheets and scripts. */
export class CromboloBundleCodeView extends CromboloBundleEditorView {
  headline = 'Code'

  fields(d) {
    return html`
      ${field(
        'Templates',
        html`<umb-input-entity
          .getIcon=${() => 'icon-document-html'}
          .pickerContext=${UmbTemplatePickerInputContext}
          .selection=${d.templates ?? []}
          @change=${(event) => this.set({ templates: event.target.selection ?? [] })}></umb-input-entity>`,
      )}
      ${field(
        'Partial views',
        filePicker(this, d, 'partialViews', 'icon-document-html', UmbPartialViewPickerInputContext),
      )}
      ${field('Stylesheets', filePicker(this, d, 'stylesheets', 'icon-palette', UmbStylesheetPickerInputContext))}
      ${field('Scripts', filePicker(this, d, 'scripts', 'icon-document-js', UmbScriptPickerInputContext))}
    `
  }
}

/** Language: languages and dictionary items. */
export class CromboloBundleLanguageView extends CromboloBundleEditorView {
  headline = 'Language'

  fields(d) {
    return html`
      ${field(
        'Languages',
        html`<umb-input-language
          .value=${(d.languages ?? []).join(',')}
          @change=${(event) => this.set({ languages: event.target.selection ?? [] })}></umb-input-language>`,
      )}
      ${field(
        'Dictionary',
        html`<umb-input-entity
          .getIcon=${() => 'icon-book-alt'}
          .pickerContext=${UmbDictionaryPickerInputContext}
          .selection=${d.dictionaryItems ?? []}
          @change=${(event) => this.set({ dictionaryItems: event.target.selection ?? [] })}></umb-input-entity>`,
      )}
    `
  }
}

const LISTS = { form: 'forms', workflow: 'workflows', userGroup: 'userGroups' }

const KEY = (kind, alias) => `${kind}:${alias}`.toLowerCase()

/** Why a dependency matters, said where it can be unticked. */
const NEEDS = {
  userGroup: (by) => `${by} needs this group`,
  documentType: (by) => `${by} needs this document type`,
}

/**
 * The forms, approval workflows and user groups tabs (story 226): the site's
 * own, ticked to carry them. What a ticked one needs is ticked with it, saying
 * why; unticking that leaves it out, with a warning.
 */
class CromboloBundleSchemaView extends CromboloBundleEditorView {
  static properties = {
    ...CromboloBundleEditorView.properties,
    _picks: { state: true },
    _carried: { state: true },
    _choices: { state: true },
  }

  /** `form`, `workflow` or `userGroup`. */
  kind = ''
  /** Said when the site has none to pick. */
  empty = ''

  constructor() {
    super()
    this.consumeContext(CROMBOLO_BUNDLE_EDITOR_CONTEXT, (context) => {
      if (!context) return
      this.observe(context.picks, (picks) => {
        this._picks = picks
      })
      this.observe(context.carried, (carried) => {
        this._carried = carried
      })
      this.observe(context.choices, (choices) => {
        this._choices = choices
      })
    })
  }

  /** Ticks or unticks one, as a pick or as something a pick brought. */
  toggle(kind, alias, on) {
    const picks = this._picks
    const key = KEY(kind, alias)
    const list = LISTS[kind]
    const brought = (this._carried ?? []).some((c) => c.for && KEY(c.kind, c.alias) === key)
    const excluded = picks.excluded.filter((entry) => entry.toLowerCase() !== key)
    if (on) {
      const listed = list ? picks[list] : []
      this.context?.updatePicks({
        excluded,
        ...(list && !brought && !listed.includes(alias) ? { [list]: [...listed, alias] } : {}),
      })
      return
    }
    this.context?.updatePicks({
      ...(list ? { [list]: picks[list].filter((a) => a !== alias) } : {}),
      excluded: brought ? [...excluded, KEY(kind, alias)] : excluded,
    })
  }

  /** One row: a checkbox, and why it is ticked or what leaving it out means. */
  row(kind, alias, name) {
    const key = KEY(kind, alias)
    const carried = (this._carried ?? []).filter((c) => KEY(c.kind, c.alias) === key)
    const picked = carried.some((c) => !c.for)
    const brought = carried.find((c) => c.for)
    const ticked = picked || (brought && !brought.excluded)
    const note =
      !picked && brought
        ? brought.excluded
          ? html`<p class="warning">${NEEDS[kind]?.(brought.for.name)}. Leave it out only if the site that installs the bundle already has it.</p>`
          : html`<p class="note">Added for ${brought.for.name}</p>`
        : nothing
    return html`<div class="row">
      <uui-checkbox
        label=${name}
        .checked=${Boolean(ticked)}
        @change=${(event) => this.toggle(kind, alias, event.target.checked)}
        >${name}</uui-checkbox
      >${note}
    </div>`
  }

  fields() {
    if (!this._picks || !this._choices) return nothing
    const choices = this._choices[LISTS[this.kind]] ?? []
    if (choices.length === 0) return html`<p>${this.empty}</p>`
    return choices.map((choice) => this.row(this.kind, choice.alias, choice.name))
  }

  static styles = [
    ...CromboloBundleEditorView.styles,
    css`
      .row {
        margin-bottom: var(--uui-size-space-4);
      }
      .row uui-checkbox {
        margin-top: 0;
      }
      .note,
      .warning {
        margin: var(--uui-size-space-1) 0 0 var(--uui-size-space-6);
        font-size: var(--uui-type-small-size);
      }
      .note {
        color: var(--uui-color-text-alt);
      }
      .warning {
        color: var(--uui-color-warning-standalone);
      }
    `,
  ]
}

export class CromboloBundleFormsView extends CromboloBundleSchemaView {
  headline = 'Forms'
  kind = 'form'
  empty = 'This site has no forms.'
}

export class CromboloBundleWorkflowsView extends CromboloBundleSchemaView {
  headline = 'Approval workflows'
  kind = 'workflow'
  empty = 'This site has no approval workflows.'
}

export class CromboloBundleUserGroupsView extends CromboloBundleSchemaView {
  headline = 'User groups'
  kind = 'userGroup'
  empty = 'This site declares no user groups of its own.'
}

/** The document types the forms and workflows bring, on the Types tab. */
class CromboloBundleBroughtTypes extends CromboloBundleSchemaView {
  kind = 'documentType'

  fields() {
    const brought = (this._carried ?? []).filter((c) => c.kind === 'documentType')
    if (brought.length === 0) return nothing
    return field(
      'Added for forms and workflows',
      brought.map((c) => this.row('documentType', c.alias, c.alias)),
      'Carried as well as the document types picked above',
    )
  }

  render() {
    return this.fields()
  }

  static styles = [
    ...CromboloBundleSchemaView.styles,
    css`
      :host {
        padding: 0;
      }
    `,
  ]
}

customElements.define('crombolo-bundle-content-view', CromboloBundleContentView)
customElements.define('crombolo-bundle-types-view', CromboloBundleTypesView)
customElements.define('crombolo-bundle-code-view', CromboloBundleCodeView)
customElements.define('crombolo-bundle-language-view', CromboloBundleLanguageView)
customElements.define('crombolo-bundle-forms-view', CromboloBundleFormsView)
customElements.define('crombolo-bundle-workflows-view', CromboloBundleWorkflowsView)
customElements.define('crombolo-bundle-user-groups-view', CromboloBundleUserGroupsView)
customElements.define('crombolo-bundle-brought-types', CromboloBundleBroughtTypes)
