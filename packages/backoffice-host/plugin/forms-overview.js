/**
 * The Forms section's list, and the editor for one form.
 *
 * Umbraco Forms' designer is drag-and-drop over a canvas. This is a table: a
 * form is a file, and what somebody edits here is written straight back to
 * TOML, so the shape that matters is the one a diff will show. Reordering,
 * multi-page layout and the richer per-type settings are refinements on top.
 *
 * Saving sends the whole definition. The server writes it to TOML and reads it
 * back with the strict parser before keeping it, so a refusal here is the same
 * refusal a hand-written file would get.
 */
// For its side effect: registers `umb-input-document`, which the shell loads lazily.
import './alias-input.js'
import { camelAlias } from './alias-model.js'
import '@umbraco-cms/backoffice/document'
import './form-word-input.js'
import './forms-entries.js'
import { css, html, nothing, repeat } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UMB_NOTIFICATION_CONTEXT } from '@umbraco-cms/backoffice/notification'
import { readOnlyWords } from './definition-tree-model.js'
import {
  deleteForm,
  formsTree,
  listEmailTemplates,
  listFormTypes,
  listWords,
  previewChoices,
  readForm,
  saveForm,
  setSecretHeader,
} from './forms-client.js'
import {
  addGroup,
  addPage,
  groupHasFields,
  layoutRows,
  moveField,
  moveGroup,
  movePage,
  nudgeField,
  pageHasFields,
  removeGroup,
  removePage,
  setColumns,
  setFieldText,
  setGroupCaption,
  setPageCaption,
  withLayout,
} from './forms-layout.js'
import {
  addWorkflow,
  describeProblemPath,
  removeWorkflow,
  secretHeaderNames,
  setSecretHeaderName,
  setWorkflowName,
  setWorkflowSetting,
  setWorkflowTrigger,
  setWorkflowType,
  switchValue,
  workflowSettings,
} from './forms-workflows.js'

/** The form's own texts that can name a dictionary item. */
const WORD_SETTINGS = ['messageOnSubmit', 'submitLabel', 'nextLabel', 'previousLabel']

/** The settings of a field's type that can name one. */
const WORD_FIELD_SETTINGS = ['placeholder', 'content']

/** Whose default value is words in the box, as `WORDY_DEFAULT_TYPES` in `@crombolo/core`. */
const WORDY_DEFAULT_TYPES = ['shortAnswer', 'longAnswer']

/** The tree beside the list hears of a change this way. */
const definitionsChanged = () => window.dispatchEvent(new Event('crombolo:definitions-changed'))

/** Back to the list, which the tree's links leave by their query. */
const clearQuery = () => {
  if (location.search) history.replaceState(null, '', location.pathname)
}

/** What a preview depends on, so it survives a layout change that copies the field. */
const sourceKey = (source) => `${source.kind}|${source.parent}`

/** Where a choice field's options come from, as an editor would put it. */
const CHOICE_FROM = [
  { kind: '', label: 'Options typed here' },
  { kind: 'content', label: "A page's child pages" },
  { kind: 'dictionary', label: "A dictionary item's children" },
]

export default class CromboloFormsOverviewElement extends UmbLitElement {
  static properties = {
    _forms: { state: true },
    _editing: { state: true },
    _problems: { state: true },
    _notice: { state: true },
    _busy: { state: true },
    _choices: { state: true },
    _words: { state: true },
    _types: { state: true },
    _workflowTypes: { state: true },
    _designs: { state: true },
    _secrets: { state: true },
    _because: { state: true },
    _tab: { state: true },
  }

  #notifications
  /** The folder a new form goes in, from the tree's link. */
  #folder
  #query

  #follow = () => {
    if (location.search === this.#query) return
    this.#query = location.search
    const asked = new URLSearchParams(location.search)
    if (asked.has('form')) this.#edit(asked.get('form'))
    else if (asked.has('new')) this.#new(asked.get('new'))
    else this._editing = undefined
  }

  constructor() {
    super()
    this.consumeContext(UMB_NOTIFICATION_CONTEXT, (context) => {
      this.#notifications = context
    })
    this._forms = undefined
    this._editing = undefined
    this._problems = []
    this._notice = ''
    this._busy = false
    /** What each source currently offers, by field; shown under the field. */
    this._choices = new Map()
    /** Field types by name, as the server has them: built in and from bundles. */
    this._types = new Map()
    /** Workflow types by name, likewise. */
    this._workflowTypes = new Map()
    /** The site's e-mail templates, for a Send email workflow's design. */
    this._designs = []
  }

  connectedCallback() {
    super.connectedCallback()
    this.#load()
    this.#follow()
    window.addEventListener('changestate', this.#follow)
    window.addEventListener('popstate', this.#follow)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('changestate', this.#follow)
    window.removeEventListener('popstate', this.#follow)
  }

  #changed() {
    this.#folder = undefined
    definitionsChanged()
    clearQuery()
  }

  async #load() {
    try {
      const [tree, types, designs] = await Promise.all([
        formsTree(),
        listFormTypes(),
        // The picker can still offer Standard without them.
        listEmailTemplates().catch(() => []),
      ])
      this._words = await listWords().catch(() => [])
      this._forms = tree.items ?? []
      this._because = tree.readOnlyBecause
      this._types = new Map(types.fields.map((info) => [info.type, info]))
      this._workflowTypes = new Map(types.workflows.map((info) => [info.type, info]))
      this._designs = designs
    } catch (error) {
      this._forms = []
      this._notice = error.message
    }
  }

  async #edit(key) {
    this._problems = []
    this._notice = ''
    this._tab = 'design'
    const detail = await readForm(key)
    this._editing = withLayout(detail.definition)
    this._secrets = detail.secrets ?? []
    this._choices = new Map()
    for (const field of this.#fields) if (field.source) this.#preview(field)
  }

  async #preview(field) {
    const source = field.source
    if (!source?.parent) {
      this.#touch()
      return
    }
    try {
      const result = await previewChoices(source)
      this._choices.set(sourceKey(source), result.ok ? result.body.options : [])
    } catch {
      this._choices.set(sourceKey(source), [])
    }
    this.#touch()
  }

  /** Clears what the old type kept, so a switched field carries no settings it no longer takes. */
  #changeType(field, type) {
    const before = this._types.get(field.type)
    for (const setting of before?.builtIn ? before.settings : []) delete field[setting.key]
    delete field.settings
    field.type = type
    if (!this._types.get(type)?.choices) {
      field.values = []
      delete field.source
    }
  }

  /** The words a field keeps out of the table: its help, and what it says when refused. */
  #fieldDetails(field) {
    const readonly = Boolean(this._because)
    const box = (key, label) => html`<label>
      <span>${label}</span>
      <crombolo-form-word-input
        label=${label}
        .value=${field[key] ?? ''}
        .words=${this._words}
        ?readonly=${readonly}
        @change=${(event) => {
          setFieldText(field, key, event.target.value)
          this.#touch()
        }}
      ></crombolo-form-word-input>
    </label>`
    const textual = this._types.get(field.type)?.settings.some((s) => s.key === 'placeholder')
    return html`<details class="field-details">
      <summary>Help and messages</summary>
      ${box('helpText', 'Help text')}
      ${box('mandatoryMessage', 'When left empty')}
      ${
        textual
          ? html`<label>
                <span>Must match (a regular expression)</span>
                <uui-input
                  label="Must match"
                  .value=${field.pattern ?? ''}
                  ?readonly=${readonly}
                  @change=${(event) => {
                    setFieldText(field, 'pattern', event.target.value)
                    this.#touch()
                  }}
                ></uui-input>
              </label>
              ${box('patternMessage', 'When it does not match')}`
          : nothing
      }
    </details>`
  }

  /**
   * One input per setting the type declares. A built-in type keeps them on the
   * field; a bundle's type keeps them in the field's own settings.
   */
  #settingsCell(field) {
    const info = this._types.get(field.type)
    if (!info || info.settings.length === 0) return nothing
    const read = (key) => (info.builtIn ? field[key] : field.settings?.[key])
    const write = (key, value) => {
      if (info.builtIn) {
        if (value === undefined) delete field[key]
        else field[key] = value
      } else {
        field.settings = { ...(field.settings ?? {}) }
        if (value === undefined) delete field.settings[key]
        else field.settings[key] = value
        if (Object.keys(field.settings).length === 0) delete field.settings
      }
      this.#touch()
    }
    return html`<div class="settings">
      ${info.settings.map((setting) => {
        const value = read(setting.key)
        const label = `${setting.label}${setting.required ? ' *' : ''}`
        if (setting.kind === 'boolean')
          return html`<uui-toggle
            label=${label}
            title=${setting.description ?? ''}
            .checked=${value === true}
            @change=${(event) => write(setting.key, event.target.checked || undefined)}
          ></uui-toggle>`
        if (
          WORD_FIELD_SETTINGS.includes(setting.key) ||
          (setting.key === 'defaultValue' && WORDY_DEFAULT_TYPES.includes(field.type))
        )
          return html`<label>
            <span>${label}</span>
            <crombolo-form-word-input
              label=${label}
              .value=${value ?? ''}
              .words=${this._words}
              ?readonly=${Boolean(this._because)}
              @change=${(event) => write(setting.key, event.target.value.trim() || undefined)}
            ></crombolo-form-word-input>
          </label>`
        return html`<label>
          <span>${label}</span>
          <uui-input
            label=${label}
            title=${setting.description ?? ''}
            type=${setting.kind === 'number' ? 'number' : 'text'}
            .value=${value === undefined ? '' : setting.kind === 'list' ? value.join(', ') : String(value)}
            @change=${(event) => {
              const raw = event.target.value.trim()
              if (raw === '') return write(setting.key, undefined)
              if (setting.kind === 'number') return write(setting.key, Number(raw))
              if (setting.kind === 'list')
                return write(
                  setting.key,
                  raw
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean),
                )
              write(setting.key, raw)
            }}
          ></uui-input>
        </label>`
      })}
    </div>`
  }

  #choicesCell(field) {
    const kind = field.source?.kind ?? ''
    const offered = field.source?.parent ? this._choices.get(sourceKey(field.source)) : undefined
    const list =
      kind === ''
        ? html`<uui-input
            label="Options"
            placeholder="One, Two, Three"
            .value=${(field.values ?? []).join(', ')}
            @change=${(event) => {
              field.values = event.target.value
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean)
              this.#touch()
            }}
          ></uui-input>`
        : kind === 'content'
          ? html`<umb-input-document
              max="1"
              .selection=${field.source.parent ? [field.source.parent] : []}
              @change=${(event) => {
                field.source = { kind, parent: event.target.selection?.[0] ?? '' }
                this.#preview(field)
              }}
            ></umb-input-document>`
          : html`<uui-input
              label="Dictionary item"
              placeholder="The name of the parent item"
              .value=${field.source.parent ?? ''}
              @change=${(event) => {
                field.source = { kind, parent: event.target.value.trim() }
                this.#preview(field)
              }}
            ></uui-input>`
    return html`
      <select
        aria-label="Where the options come from"
        @change=${(event) => {
          const chosen = event.target.value
          if (chosen === '') delete field.source
          else {
            field.source = { kind: chosen, parent: '' }
            field.values = []
          }
          this.#touch()
        }}
      >
        ${CHOICE_FROM.map(
          (from) =>
            html`<option value=${from.kind} ?selected=${from.kind === kind}>${from.label}</option>`,
        )}
      </select>
      ${list}
      ${
        kind && offered
          ? html`<p class="offered">
              ${
                offered.length > 0
                  ? `Offers now: ${offered.map((option) => option.label).join(', ')}`
                  : 'Offers nothing yet.'
              }
            </p>`
          : nothing
      }
    `
  }

  #new(folder) {
    this._problems = []
    this._notice = ''
    this._tab = 'design'
    this.#folder = folder || undefined
    this._editing = {
      key: crypto.randomUUID(),
      alias: '',
      name: '',
      storeEntries: true,
      requiresApproval: false,
      honeypot: true,
      pages: [{ groups: [{ columns: 1, fields: [] }] }],
      workflows: [],
    }
    this.#freshForm = this._editing.key
    this.#ownFormAlias = false
  }

  /**
   * What is new in this editor and not saved yet, whose alias follows its name
   * until it is written by hand. Fields by the object, which an edit keeps; the
   * form by its key, since every edit copies it. A saved one is reloaded afresh.
   */
  #fresh = new WeakSet()
  #own = new WeakSet()
  #freshForm
  #ownFormAlias = false

  #isFresh(item) {
    return item === this._editing ? item.key === this.#freshForm : this.#fresh.has(item)
  }

  #follows(item) {
    if (item === this._editing) return this.#isFresh(item) && !this.#ownFormAlias
    return this.#fresh.has(item) && !this.#own.has(item)
  }

  /** Every field, in order: for the previews, which a layout change does not touch. */
  get #fields() {
    return (this._editing?.pages ?? []).flatMap((page) =>
      page.groups.flatMap((group) => group.fields),
    )
  }

  /** Applies a layout operation from forms-layout.js to the form being edited. */
  #apply(operation, ...args) {
    this._editing = operation(this._editing, ...args)
  }

  #page(page, p) {
    const pages = this._editing.pages
    return html`<section class="page" aria-label=${page.caption || `Page ${p + 1}`}>
      <div class="bar">
        <crombolo-form-word-input
          label="Page title"
          placeholder=${`Page ${p + 1}`}
          .value=${page.caption ?? ''}
          .words=${this._words}
          ?readonly=${Boolean(this._because)}
          @change=${(event) => this.#apply(setPageCaption, p, event.target.value)}
        ></crombolo-form-word-input>
        <uui-button compact look="secondary" label="Move page up" ?disabled=${p === 0}
          @click=${() => this.#apply(movePage, p, p - 1)}>↑</uui-button>
        <uui-button compact look="secondary" label="Move page down" ?disabled=${p === pages.length - 1}
          @click=${() => this.#apply(movePage, p, p + 1)}>↓</uui-button>
        <uui-button compact look="secondary" color="danger" label="Remove page" ?disabled=${pages.length === 1}
          @click=${() => {
            if (pageHasFields(page) && !confirm('Remove this page and the fields on it?')) return
            this.#apply(removePage, p)
          }}></uui-button>
      </div>
      ${page.groups.map((group, g) => this.#group(group, p, g, page.groups.length))}
      <uui-button look="secondary" label="Add a group" @click=${() => this.#apply(addGroup, p)}></uui-button>
    </section>`
  }

  #group(group, p, g, count) {
    return html`<div
      class="group"
      @dragover=${(event) => event.preventDefault()}
      @drop=${(event) => this.#drop(event, { page: p, group: g, index: group.fields.length })}
    >
      <div class="bar">
        <crombolo-form-word-input
          label="Group title"
          placeholder="Untitled group"
          .value=${group.caption ?? ''}
          .words=${this._words}
          ?readonly=${Boolean(this._because)}
          @change=${(event) => this.#apply(setGroupCaption, p, g, event.target.value)}
        ></crombolo-form-word-input>
        <label class="columns">
          Columns
          <select @change=${(event) => this.#apply(setColumns, p, g, Number(event.target.value))}>
            ${[1, 2, 3, 4].map((n) => html`<option value=${n} ?selected=${n === group.columns}>${n}</option>`)}
          </select>
        </label>
        <uui-button compact look="secondary" label="Move group up" ?disabled=${g === 0}
          @click=${() => this.#apply(moveGroup, p, g, g - 1)}>↑</uui-button>
        <uui-button compact look="secondary" label="Move group down" ?disabled=${g === count - 1}
          @click=${() => this.#apply(moveGroup, p, g, g + 1)}>↓</uui-button>
        <uui-button compact look="secondary" color="danger" label="Remove group" ?disabled=${count === 1}
          @click=${() => {
            if (groupHasFields(group) && !confirm('Remove this group and its fields?')) return
            this.#apply(removeGroup, p, g)
          }}></uui-button>
      </div>
      ${
        group.fields.length > 0
          ? html`<div class="preview" style=${`grid-template-columns: repeat(${group.columns}, 1fr)`} aria-hidden="true">
              ${layoutRows(group)
                .flat()
                .map(
                  (field) => html`<span>${field.caption || field.alias || 'Untitled field'}</span>`,
                )}
            </div>`
          : nothing
      }
      ${this.#fieldsTable(group, p, g)}
      <uui-button
        look="secondary"
        label="Add a field"
        @click=${() => {
          const field = {
            alias: '',
            type: 'shortAnswer',
            caption: '',
            mandatory: false,
            sensitive: false,
            values: [],
            accept: [],
          }
          this.#fresh.add(field)
          group.fields.push(field)
          this.#touch()
        }}
      ></uui-button>
    </div>`
  }

  #drop(event, to) {
    event.preventDefault()
    event.stopPropagation()
    const from = JSON.parse(event.dataTransfer?.getData('application/x-crombolo-field') || 'null')
    if (from) this.#apply(moveField, from, to)
  }

  #fieldsTable(group, p, g) {
    return html`<uui-table>
          <uui-table-head>
            <uui-table-head-cell>Order</uui-table-head-cell>
            <uui-table-head-cell>Caption</uui-table-head-cell>
            <uui-table-head-cell>Alias</uui-table-head-cell>
            <uui-table-head-cell>Type</uui-table-head-cell>
            <uui-table-head-cell>Choices</uui-table-head-cell>
            <uui-table-head-cell>Settings</uui-table-head-cell>
            <uui-table-head-cell>Required</uui-table-head-cell>
            <uui-table-head-cell>Sensitive</uui-table-head-cell>
            <uui-table-head-cell></uui-table-head-cell>
          </uui-table-head>
          ${repeat(
            group.fields,
            (_field, index) => index,
            (field, index) => html`
              <uui-table-row
                draggable="true"
                @dragstart=${(event) =>
                  event.dataTransfer?.setData(
                    'application/x-crombolo-field',
                    JSON.stringify({ page: p, group: g, index }),
                  )}
                @dragover=${(event) => event.preventDefault()}
                @drop=${(event) => this.#drop(event, { page: p, group: g, index })}
              >
                <uui-table-cell>
                  <uui-button compact look="secondary" label="Move field up"
                    @click=${() => this.#apply(nudgeField, { page: p, group: g, index }, -1)}>↑</uui-button>
                  <uui-button compact look="secondary" label="Move field down"
                    @click=${() => this.#apply(nudgeField, { page: p, group: g, index }, 1)}>↓</uui-button>
                </uui-table-cell>
                <uui-table-cell>
                  <crombolo-form-word-input
                    label="Caption"
                    .value=${field.caption ?? ''}
                    .words=${this._words}
                    ?readonly=${Boolean(this._because)}
                    @input=${(event) => {
                      field.caption = event.target.value
                      if (this.#follows(field)) {
                        field.alias = camelAlias(field.caption)
                        this.requestUpdate()
                      }
                    }}
                    @change=${(event) => {
                      field.caption = event.target.value
                      if (this.#follows(field)) field.alias = camelAlias(field.caption)
                      this.#touch()
                    }}
                  ></crombolo-form-word-input>
                  ${this.#fieldDetails(field)}
                </uui-table-cell>
                <uui-table-cell>
                  <crombolo-alias-input
                    .value=${field.alias ?? ''}
                    ?saved=${!this.#fresh.has(field)}
                    ?readonly=${Boolean(this._because)}
                    @change=${(event) => {
                      field.alias = event.target.value
                      this.#own.add(field)
                      this.#touch()
                    }}
                  ></crombolo-alias-input>
                </uui-table-cell>
                <uui-table-cell>
                  <select
                    aria-label="Type"
                    @change=${(event) => {
                      this.#changeType(field, event.target.value)
                      this.#touch()
                    }}
                  >
                    ${[...this._types.values()].map(
                      (info) =>
                        html`<option value=${info.type} ?selected=${info.type === field.type}>${info.label}</option>`,
                    )}
                  </select>
                </uui-table-cell>
                <uui-table-cell>
                  ${this._types.get(field.type)?.choices ? this.#choicesCell(field) : nothing}
                </uui-table-cell>
                <uui-table-cell>${this.#settingsCell(field)}</uui-table-cell>
                <uui-table-cell>
                  <uui-toggle
                    label="Required"
                    .checked=${field.mandatory === true}
                    @change=${(event) => {
                      field.mandatory = event.target.checked
                      this.#touch()
                    }}
                  ></uui-toggle>
                </uui-table-cell>
                <uui-table-cell>
                  <uui-toggle
                    label="Sensitive"
                    .checked=${field.sensitive === true}
                    @change=${(event) => {
                      field.sensitive = event.target.checked
                      this.#touch()
                    }}
                  ></uui-toggle>
                </uui-table-cell>
                <uui-table-cell>
                  <uui-button
                    look="secondary"
                    color="danger"
                    label="Remove"
                    @click=${() => {
                      group.fields.splice(index, 1)
                      this.#touch()
                    }}
                  ></uui-button>
                </uui-table-cell>
              </uui-table-row>
            `,
          )}
        </uui-table>`
  }

  /** What happens after someone sends the form: each workflow with its settings. */
  #workflows() {
    const form = this._editing
    const workflows = form.workflows ?? []
    const types = [...this._workflowTypes.values()]
    return html`<uui-box headline="Workflows" class="workflows">
      <p class="offered">What happens after someone sends this form.</p>
      ${
        workflows.length === 0
          ? html`<p>Nothing happens yet${form.storeEntries === false ? '' : ' beyond keeping the entry'}.</p>`
          : nothing
      }
      ${repeat(
        workflows,
        (workflow, index) => workflow.key ?? index,
        (
          workflow,
          index,
        ) => html`<section class="workflow" aria-label=${workflow.name || `Workflow ${index + 1}`}>
          <div class="bar">
            <uui-input
              label="Workflow name"
              placeholder="Name"
              .value=${workflow.name ?? ''}
              @change=${(event) => this.#apply(setWorkflowName, index, event.target.value)}
            ></uui-input>
            <select
              aria-label="What it does"
              @change=${(event) => this.#apply(setWorkflowType, index, event.target.value)}
            >
              ${types.map(
                (info) =>
                  html`<option value=${info.type} ?selected=${info.type === workflow.type}>${info.label}</option>`,
              )}
            </select>
            <select
              aria-label="When it runs"
              @change=${(event) => this.#apply(setWorkflowTrigger, index, event.target.value)}
            >
              <option value="submit" ?selected=${workflow.on !== 'approve'}>When the form is sent</option>
              <option value="approve" ?selected=${workflow.on === 'approve'}>When an entry is approved</option>
            </select>
            <uui-button compact look="secondary" color="danger" label="Remove workflow"
              @click=${() => {
                if (!confirm(`Remove the workflow "${workflow.name || 'untitled'}"?`)) return
                this.#apply(removeWorkflow, index)
              }}></uui-button>
          </div>
          ${this.#workflowSettings(workflow, index)}
        </section>`,
      )}
      <uui-button
        look="secondary"
        label="Add a workflow"
        @click=${() => {
          const first = this._workflowTypes.get('sendEmail') ?? types[0]
          if (first) this.#apply(addWorkflow, first.type, first.label)
        }}
      ></uui-button>
    </uui-box>`
  }

  #workflowSettings(workflow, index) {
    const settings = workflowSettings(workflow.type, this._workflowTypes.get(workflow.type))
    if (settings.length === 0) return nothing
    const write = (key, value) => this.#apply(setWorkflowSetting, index, key, value)
    return html`<div class="workflow-settings">
      ${settings.map((setting) => {
        const value = workflow.settings?.[setting.key]
        const label = `${setting.label}${setting.required ? ' *' : ''}`
        const hint = setting.description
          ? html`<small class="offered">${setting.description}</small>`
          : nothing
        if (setting.kind === 'boolean')
          return html`<div class="switch">
            <uui-toggle
              label=${label}
              .checked=${value === undefined ? setting.defaultValue === true : value === true}
              @change=${(event) => write(setting.key, switchValue(setting, event.target.checked))}
            ></uui-toggle>
            ${hint}
          </div>`
        if (setting.kind === 'design') {
          const known = this._designs.some((design) => design.alias === value)
          return html`<label>
            <span>${label}</span>
            <select
              aria-label=${setting.label}
              @change=${(event) => write(setting.key, event.target.value || undefined)}
            >
              <option value="" ?selected=${!value}>Standard</option>
              ${this._designs.map(
                (design) =>
                  html`<option value=${design.alias} ?selected=${design.alias === value}>${design.name}</option>`,
              )}
              ${
                value && !known
                  ? html`<option value=${value} selected>${value} (not found)</option>`
                  : nothing
              }
            </select>
            ${hint}
          </label>`
        }
        return html`<label>
          <span>${label}</span>
          <uui-input
            label=${setting.label}
            type=${setting.kind === 'number' ? 'number' : 'text'}
            .value=${value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value)}
            @change=${(event) => {
              const raw = event.target.value.trim()
              if (raw === '') return write(setting.key, undefined)
              if (setting.kind === 'number') return write(setting.key, Number(raw))
              if (setting.kind === 'list')
                return write(
                  setting.key,
                  raw
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean),
                )
              write(setting.key, raw)
            }}
          ></uui-input>
          ${hint}
        </label>`
      })}
      ${workflow.type === 'sendToUrl' ? this.#secretHeaders(workflow, index) : nothing}
    </div>`
  }

  /** Headers kept sealed on the site and sent only to the address they were set for (story 304). */
  #secretHeaders(workflow, index) {
    const names = secretHeaderNames(workflow)
    return html`<div class="secret-headers">
      <span>Secret headers</span>
      <small class="offered">For a key or token the address needs. Kept on this site, never shown again, and sent only to the address above: change the address and set them again.</small>
      ${names.map((name) => {
        const saved = (this._secrets ?? []).find(
          (secret) => secret.workflow === workflow.key && secret.header === name,
        )
        return html`<div class="secret-header">
          <code>${name}</code>
          <span>${saved ? (saved.set ? 'Set' : 'Not set') : 'Save the form, then set it'}</span>
          ${
            saved
              ? html`<uui-input
                  type="password"
                  label=${`A value for ${name}`}
                  placeholder=${saved.set ? 'Replace it' : 'Its value'}
                  @change=${(event) => this.#setSecret(workflow, name, event.target.value)}
                ></uui-input>`
              : nothing
          }
          ${
            saved?.set
              ? html`<uui-button compact look="secondary" label="Clear"
                  @click=${() => this.#setSecret(workflow, name, undefined)}></uui-button>`
              : nothing
          }
          <uui-button compact look="secondary" color="danger" label=${`Stop sending ${name}`}
            @click=${() => this.#apply(setSecretHeaderName, index, name, false)}></uui-button>
        </div>`
      })}
      <uui-input
        label="Add a secret header"
        placeholder="Its name, such as Authorization"
        @change=${(event) => {
          const name = event.target.value.trim()
          if (!name) return
          this.#apply(setSecretHeaderName, index, name, true)
          event.target.value = ''
        }}
      ></uui-input>
    </div>`
  }

  async #setSecret(workflow, header, value) {
    if (value === '') return
    try {
      const result = await setSecretHeader(this._editing.key, workflow.key, header, value)
      if (!result.ok) {
        this._notice = result.body.message ?? 'That header could not be set.'
        return
      }
      this.#notifications?.peek('positive', {
        data: { message: value === undefined ? `${header} cleared` : `${header} set` },
      })
      this._secrets = (await readForm(this._editing.key)).secrets ?? []
    } catch (error) {
      this._notice = error.message
    }
  }

  #touch() {
    // Lit tracks the reference, not what is inside it.
    this._editing = { ...this._editing }
  }

  async #save() {
    this._busy = true
    this._problems = []
    this._notice = ''
    try {
      const result = await saveForm(this._editing, this.#folder)
      if (result.ok) {
        // The green toast every workspace shows on a save.
        this.#notifications?.peek('positive', { data: { message: 'Form saved' } })
        // Saved, its alias is what things will name it by: no longer following its name.
        this.#freshForm = undefined
        this._editing = undefined
        this.#changed()
        await this.#load()
      } else {
        this._problems = result.body.problems ?? []
      }
    } catch (error) {
      this._problems = [{ path: '', message: error.message }]
    } finally {
      this._busy = false
    }
  }

  async #remove(form) {
    if (!confirm(`Delete the form "${form.name}"? Its entries are kept.`)) return
    try {
      const result = await deleteForm(form.key)
      if (!result.ok) this._notice = 'That form could not be deleted.'
      this.#changed()
      await this.#load()
    } catch (error) {
      this._notice = error.message
    }
  }

  render() {
    if (this._forms === undefined) return html`<div class="list"><uui-loader></uui-loader></div>`
    if (this._editing) return this.#editor()
    return html`<div class="list">
      ${this.#readOnly()}
      ${this._notice ? html`<uui-box><p>${this._notice}</p></uui-box>` : nothing}
      ${this.#list()}
    </div>`
  }

  #readOnly() {
    const words = readOnlyWords('Forms', this._because)
    return words ? html`<uui-box><p role="status">${words}</p></uui-box>` : nothing
  }

  #list() {
    // The create button above the list, as the workflows list has it.
    return html`
      ${this._because ? nothing : html`<uui-button class="create" color="default" look="outline" label="Create" @click=${() => this.#new()}></uui-button>`}
      <uui-box headline="Forms">
        ${
          this._forms.length === 0
            ? html`<p>There are no forms yet.</p>`
            : html`
                <uui-table>
                  <uui-table-head>
                    <uui-table-head-cell>Name</uui-table-head-cell>
                    <uui-table-head-cell>Alias</uui-table-head-cell>
                    <uui-table-head-cell>Fields</uui-table-head-cell>
                    <uui-table-head-cell>Entries</uui-table-head-cell>
                    <uui-table-head-cell></uui-table-head-cell>
                  </uui-table-head>
                  ${repeat(
                    this._forms,
                    (form) => form.key,
                    (form) => html`
                      <uui-table-row>
                        <uui-table-cell>${form.name}</uui-table-cell>
                        <uui-table-cell><code>${form.alias}</code></uui-table-cell>
                        <uui-table-cell>${form.fieldCount}</uui-table-cell>
                        <uui-table-cell>${form.storeEntries ? 'stored' : 'not stored'}</uui-table-cell>
                        <uui-table-cell>
                          <uui-button look="secondary" label="Edit" @click=${() => this.#edit(form.key)}></uui-button>
                          ${this._because ? nothing : html`<uui-button look="secondary" color="danger" label="Delete" @click=${() => this.#remove(form)}></uui-button>`}
                        </uui-table-cell>
                      </uui-table-row>
                    `,
                  )}
                </uui-table>
              `
        }
      </uui-box>
    `
  }

  /** The form's own settings and layout, which is what its Design tab shows. */
  #design(form, text) {
    return html`      <uui-box>
        <uui-form-layout-item>
          <uui-label slot="label">Name</uui-label>
          <uui-input
            label="Name"
            .value=${form.name ?? ''}
            ?readonly=${Boolean(this._because)}
            @input=${(event) => {
              form.name = event.target.value
              if (this.#follows(form)) form.alias = camelAlias(form.name)
              this.#touch()
            }}
          ></uui-input>
        </uui-form-layout-item>
        <uui-form-layout-item>
          <uui-label slot="label">Alias</uui-label>
          <crombolo-alias-input
            .value=${form.alias ?? ''}
            ?saved=${!this.#isFresh(form)}
            ?readonly=${Boolean(this._because)}
            @change=${(event) => {
              form.alias = event.target.value
              this.#ownFormAlias = true
              this.#touch()
            }}
          ></crombolo-alias-input>
        </uui-form-layout-item>
        ${text('messageOnSubmit', 'Message on submit')}
        ${text('submitLabel', 'Submit button')}
        <uui-form-layout-item>
          <uui-label slot="label">Store entries</uui-label>
          <uui-toggle
            label="Store entries"
            .checked=${form.storeEntries !== false}
            @change=${(event) => {
              form.storeEntries = event.target.checked
              this.#touch()
            }}
          ></uui-toggle>
        </uui-form-layout-item>
        ${
          form.pages.length > 1
            ? html`<uui-form-layout-item>
                <uui-label slot="label">Show one page at a time</uui-label>
                <span slot="description">Each page is checked before the next. Without JavaScript the pages show together.</span>
                <uui-toggle
                  label="Show one page at a time"
                  .checked=${form.stepPages === true}
                  @change=${(event) => {
                    if (event.target.checked) form.stepPages = true
                    else delete form.stepPages
                    this.#touch()
                  }}
                ></uui-toggle>
              </uui-form-layout-item>
              ${text('nextLabel', 'Next button')}
              ${text('previousLabel', 'Back button')}`
            : nothing
        }

        <h4>Layout</h4>
        ${this._editing.pages.map((page, p) => this.#page(page, p))}
        <div class="actions">
          <uui-button look="secondary" label="Add a page" @click=${() => this.#apply(addPage)}></uui-button>
        </div>
      </uui-box>
      ${this.#workflows()}
      ${
        this._problems.length > 0
          ? html`<div class="problems" role="alert">
              <p>This form was not saved:</p>
              <ul>
                ${this._problems.map((problem) => {
                  const where = describeProblemPath(form, problem.path, this._workflowTypes)
                  return html`<li>${
                    !where
                      ? nothing
                      : where === problem.path
                        ? html`<code>${where}</code> `
                        : html`<strong>${where}</strong>: `
                  }${problem.message}</li>`
                })}
              </ul>
            </div>`
          : nothing
      }`
  }

  #editor() {
    const form = this._editing
    const text = (key, label, hint) => {
      const change = (event) => {
        form[key] = event.target.value
        this.#touch()
      }
      return html`
      <uui-form-layout-item>
        <uui-label slot="label">${label}</uui-label>
        ${hint ? html`<span slot="description">${hint}</span>` : nothing}
        ${
          WORD_SETTINGS.includes(key)
            ? html`<crombolo-form-word-input
                label=${label}
                .value=${form[key] ?? ''}
                .words=${this._words}
                ?readonly=${Boolean(this._because)}
                @change=${change}
              ></crombolo-form-word-input>`
            : html`<uui-input label=${label} .value=${form[key] ?? ''} @change=${change}></uui-input>`
        }
      </uui-form-layout-item>
    `
    }
    const leave = () => {
      this._editing = undefined
      this._problems = []
      clearQuery()
    }
    const tab = (id, label, icon) => html`<uui-tab
      label=${label}
      ?active=${this._tab === id}
      @click=${() => {
        this._tab = id
      }}
    ><umb-icon slot="icon" name=${icon}></umb-icon>${label}</uui-tab>`
    const saved = this._forms.some((known) => known.key === form.key)
    // Umbraco's own layout, as the workflow designer has it: Save bottom right,
    // and what stopped a save listed just above it.
    return html`<umb-body-layout headline=${form.alias ? `Form: ${form.name || form.alias}` : 'A new form'}>
      ${
        saved
          ? html`<uui-tab-group slot="navigation">
              ${tab('design', 'Design', 'icon-edit')}
              ${tab('entries', 'Entries', 'icon-inbox')}
            </uui-tab-group>`
          : nothing
      }
      ${this.#readOnly()}
      ${
        this._tab === 'entries'
          ? html`<crombolo-forms-entries .form=${form.key}></crombolo-forms-entries>`
          : this.#design(form, text)
      }
      ${
        this._problems.length > 0
          ? html`<span slot="footer-info" class="not-saved">Not saved: ${this._problems.length} problem(s), listed above</span>`
          : nothing
      }
      <uui-button slot="actions" look="secondary" label="Back to the list" @click=${leave}>Back to the list</uui-button>
      ${this._because ? nothing : html`<uui-button slot="actions" look="primary" color="positive" label="Save" ?disabled=${this._busy} @click=${() => this.#save()}>Save</uui-button>`}
    </umb-body-layout>`
  }

  static styles = css`
    .field-details { margin-top: var(--uui-size-space-2); }
    .field-details summary { cursor: pointer; color: var(--uui-color-text-alt); font-size: var(--uui-type-small-size); }
    .field-details label { display: block; margin-top: var(--uui-size-space-2); }
    .field-details span { display: block; font-size: var(--uui-type-small-size); }
    .page {
      border: 1px solid var(--uui-color-border, #ddd);
      border-radius: var(--uui-border-radius, 3px);
      padding: var(--uui-size-space-4, 12px);
      margin-bottom: var(--uui-size-space-4, 12px);
    }
    .group {
      border-left: 3px solid var(--uui-color-divider-emphasis, #ccc);
      padding: var(--uui-size-space-3, 9px) 0 var(--uui-size-space-3, 9px)
        var(--uui-size-space-4, 12px);
      margin: var(--uui-size-space-3, 9px) 0;
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--uui-size-space-2, 6px);
      margin-bottom: var(--uui-size-space-3, 9px);
    }
    .columns {
      display: inline-flex;
      align-items: center;
      gap: var(--uui-size-space-2, 6px);
    }
    .preview {
      display: grid;
      gap: var(--uui-size-space-2, 6px);
      margin-bottom: var(--uui-size-space-3, 9px);
    }
    .preview span {
      padding: var(--uui-size-space-2, 6px);
      background: var(--uui-color-surface-alt, #f3f3f5);
      border-radius: var(--uui-border-radius, 3px);
      font-size: 0.9em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    uui-table-row[draggable='true'] {
      cursor: grab;
    }
    .settings {
      display: grid;
      gap: var(--uui-size-space-2, 6px);
    }
    .settings label {
      display: grid;
      gap: 2px;
      font-size: 0.9em;
    }
    .offered {
      margin: var(--uui-size-space-2, 6px) 0 0;
      color: var(--uui-color-text-alt, #555);
      font-size: 0.9em;
    }
    .workflows {
      margin-top: var(--uui-size-layout-1, 24px);
    }
    .workflow {
      border: 1px solid var(--uui-color-border, #ddd);
      border-radius: var(--uui-border-radius, 3px);
      padding: var(--uui-size-space-4, 12px);
      margin: var(--uui-size-space-4, 12px) 0;
    }
    .workflow-settings {
      display: grid;
      gap: var(--uui-size-space-3, 9px);
      max-width: 60ch;
    }
    .secret-headers {
      display: grid;
      gap: var(--uui-size-space-2, 6px);
    }
    .secret-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--uui-size-space-3, 9px);
    }
    .workflow-settings label,
    .workflow-settings .switch {
      display: grid;
      gap: 2px;
    }
    :host {
      display: block;
      height: 100%;
    }
    .list {
      padding: var(--uui-size-layout-1, 24px);
    }
    .create {
      margin-bottom: var(--uui-size-space-5, 18px);
    }
    .not-saved {
      color: var(--uui-color-danger, #d42054);
    }
    p,
    ul {
      max-width: 70ch;
      line-height: 1.5;
    }
    h4 {
      margin-top: var(--uui-size-layout-1, 24px);
    }
    .actions {
      display: flex;
      gap: var(--uui-size-space-4, 12px);
      margin-top: var(--uui-size-layout-1, 24px);
    }
    .problems {
      border-left: 3px solid var(--uui-color-danger, #d42054);
      padding-left: var(--uui-size-space-4, 12px);
      margin-bottom: var(--uui-size-layout-1, 24px);
    }
    code {
      font-size: 0.9em;
    }
  `
}

customElements.define('crombolo-forms-overview', CromboloFormsOverviewElement)
