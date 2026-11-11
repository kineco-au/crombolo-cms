/**
 * Draws a screen an extension describes (story 323), wherever its manifest
 * places one: a workspace, a dashboard, a side panel or an action's dialog.
 *
 * The extension's server half answers a tree from a small catalogue, and this
 * element renders it with the back office's own components. Every string the
 * extension supplies is set as text and every link checked, so nothing of the
 * extension's runs here. Typing stays in the browser; a button, a row's action
 * or a search is one call, answered with the next screen. docs/extensions.md,
 * "Screens".
 */
// For their side effects: the layout and the three pickers are defined in
// chunks the shell loads lazily.
import '@umbraco-cms/backoffice/components'
import '@umbraco-cms/backoffice/document'
import '@umbraco-cms/backoffice/media'
import '@umbraco-cms/backoffice/member'
import { css, html, nothing, repeat } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { umbConfirmModal } from '@umbraco-cms/backoffice/modal'
import {
  actionBody,
  fieldProblems,
  hintsFor,
  linkTarget,
  screenUrl,
  sentValues,
  visibleFields,
} from './extension-screen-model.js'

const backOfficeBase = () => document.querySelector('base')?.getAttribute('href') ?? '/umbraco/'

const LOOKS = {
  primary: { look: 'primary', color: 'default' },
  secondary: { look: 'secondary', color: 'default' },
  danger: { look: 'primary', color: 'danger' },
}

export default class CromboloExtensionScreenElement extends UmbLitElement {
  static properties = {
    manifest: { attribute: false },
    _screen: { state: true },
    _loading: { state: true },
    _busy: { state: true },
    _problem: { state: true },
    _notice: { state: true },
    _values: { state: true },
    _fieldProblems: { state: true },
    _tabs: { state: true },
  }

  constructor() {
    super()
    this._screen = undefined
    this._loading = true
    this._busy = false
    this._problem = ''
    this._notice = ''
    this._state = {}
    /** Each form's values, by the form as the last answer gave it. */
    this._values = new Map()
    this._typed = new Map()
    this._fieldProblems = new Map()
    this._tabs = new Map()
  }

  connectedCallback() {
    super.connectedCallback()
    this.#call({})
  }

  get #target() {
    return this.manifest?.meta?.cromboloScreen ?? {}
  }

  async #call(body) {
    const { bundle, screen } = this.#target
    if (!bundle || !screen) {
      this._problem = 'This screen does not say which extension draws it.'
      this._loading = false
      return
    }
    this._busy = true
    try {
      const response = await fetch(screenUrl(backOfficeBase(), bundle, screen), {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ state: this._state, ...body }),
      })
      const answer = await response.json().catch(() => ({}))
      if (!response.ok) {
        this._problem =
          typeof answer?.message === 'string'
            ? answer.message
            : `The extension's screen answered ${response.status}.`
        return
      }
      if (typeof answer.problem === 'string') {
        this._problem = answer.problem
        this._notice = ''
        return
      }
      this.#show(answer)
    } catch (error) {
      this._problem = error instanceof Error ? error.message : String(error)
    } finally {
      this._busy = false
      this._loading = false
    }
  }

  #show(answer) {
    this._screen = answer.screen
    this._state = answer.state ?? this._state
    this._notice = answer.notice ?? ''
    this._problem = ''
    const values = new Map()
    const walk = (nodes) => {
      for (const node of nodes ?? []) {
        if (node.type === 'form') values.set(node, { ...(node.values ?? {}) })
        if (node.type === 'tabs') for (const tab of node.tabs ?? []) walk(tab.body)
      }
    }
    walk(answer.screen?.body)
    this._values = values
    this._typed = new Map()
    this._fieldProblems = new Map()
  }

  #set(form, field, value) {
    const next = new Map(this._values)
    next.set(form, { ...(next.get(form) ?? {}), [field.name]: value })
    this._values = next
    if (field.kind === 'secret') {
      const typed = new Set(this._typed.get(form) ?? [])
      typed.add(field.name)
      this._typed.set(form, typed)
    }
    if (this._fieldProblems.get(form)?.[field.name]) {
      const problems = new Map(this._fieldProblems)
      const { [field.name]: _, ...rest } = problems.get(form) ?? {}
      problems.set(form, rest)
      this._fieldProblems = problems
    }
  }

  async #press(button, form) {
    if (button.disabled || this._busy) return
    let values
    if (button.submit && form) {
      const current = this._values.get(form) ?? {}
      const problems = fieldProblems(form.fields, current)
      if (Object.keys(problems).length > 0) {
        this._fieldProblems = new Map(this._fieldProblems).set(form, problems)
        return
      }
      values = sentValues(form.fields, current, this._typed.get(form))
    }
    if (button.confirm) {
      try {
        await umbConfirmModal(this, {
          color: button.look === 'danger' ? 'danger' : 'default',
          headline: button.label,
          content: button.confirm,
          confirmLabel: button.label,
        })
      } catch {
        return
      }
    }
    await this.#call(actionBody(button, this._state, values))
  }

  #button(button, form) {
    const look = LOOKS[button.look ?? 'secondary'] ?? LOOKS.secondary
    return html`<uui-button
      look=${look.look}
      color=${look.color}
      label=${button.label}
      ?disabled=${button.disabled || this._busy}
      @click=${() => this.#press(button, form)}></uui-button>`
  }

  #search(item) {
    return html`<uui-input
      type="search"
      label=${item.placeholder ?? 'Search'}
      placeholder=${item.placeholder ?? ''}
      .value=${item.value ?? ''}
      @change=${(event) =>
        this.#call({
          action: item.action,
          input: { query: event.target.value ?? '' },
        })}></uui-input>`
  }

  #cell(cell) {
    switch (cell.type) {
      case 'code':
        return html`<code>${cell.text}</code>`
      case 'tag':
        return html`<uui-tag look=${cell.look ?? 'default'} size="s">${cell.text}</uui-tag>`
      case 'link': {
        const href = linkTarget(cell.href, backOfficeBase())
        if (!href) return html`${cell.text}`
        const external = /^https?:/i.test(href)
        return html`<a
          href=${href}
          target=${external ? '_blank' : nothing}
          rel=${external ? 'noopener noreferrer' : nothing}
          >${cell.text}</a
        >`
      }
      case 'date': {
        const at = new Date(cell.value)
        return html`${Number.isNaN(at.getTime()) ? '' : at.toLocaleString()}`
      }
      default:
        return html`${cell.text ?? ''}`
    }
  }

  #table(node) {
    const actions = node.rows.some((row) => (row.actions ?? []).length > 0)
    return html`<uui-table>
      <uui-table-head>
        ${node.columns.map((column) => html`<uui-table-head-cell>${column}</uui-table-head-cell>`)}
        ${actions ? html`<uui-table-head-cell></uui-table-head-cell>` : nothing}
      </uui-table-head>
      ${repeat(
        node.rows,
        (row) => row.key,
        (row) => html`<uui-table-row>
          ${row.cells.map((cell) => html`<uui-table-cell>${this.#cell(cell)}</uui-table-cell>`)}
          ${
            actions
              ? html`<uui-table-cell class="actions">
                  ${(row.actions ?? []).map((button) => this.#button(button))}
                </uui-table-cell>`
              : nothing
          }
        </uui-table-row>`,
      )}
    </uui-table>`
  }

  #input(form, field, value) {
    const set = (next) => this.#set(form, field, next)
    switch (field.kind) {
      case 'boolean':
        return html`<uui-toggle
          label=${field.label}
          .checked=${value === true}
          @change=${(event) => set(event.target.checked === true)}></uui-toggle>`
      case 'choice':
        return html`<uui-select
          label=${field.label}
          .options=${(field.options ?? []).map((option) => ({
            value: option.value,
            name: option.label,
            selected: option.value === value,
          }))}
          @change=${(event) => set(event.target.value)}></uui-select>`
      case 'page':
        return html`<umb-input-document
          max="1"
          .selection=${value ? [value] : []}
          @change=${(event) => set(event.target.selection?.[0] ?? '')}></umb-input-document>`
      case 'media':
        return html`<umb-input-media
          max="1"
          .selection=${value ? [value] : []}
          @change=${(event) => set(event.target.selection?.[0] ?? '')}></umb-input-media>`
      case 'member':
        return html`<umb-input-member
          max="1"
          .selection=${value ? [value] : []}
          @change=${(event) => set(event.target.selection?.[0] ?? '')}></umb-input-member>`
      case 'text':
        if (field.multiline)
          return html`<uui-textarea
            label=${field.label}
            placeholder=${field.placeholder ?? ''}
            .value=${value ?? ''}
            @input=${(event) => set(event.target.value)}></uui-textarea>`
        break
    }
    return html`<uui-input
      label=${field.label}
      type=${field.kind === 'secret' ? 'password' : field.kind === 'number' ? 'number' : 'text'}
      placeholder=${field.placeholder ?? ''}
      .value=${value ?? ''}
      @input=${(event) =>
        set(
          field.kind === 'number' && event.target.value !== ''
            ? Number(event.target.value)
            : event.target.value,
        )}></uui-input>`
  }

  #form(node) {
    const values = this._values.get(node) ?? {}
    const problems = this._fieldProblems.get(node) ?? {}
    return html`<uui-box headline=${node.title ?? nothing}>
      ${visibleFields(node.fields, values).map(
        (field) => html`<div class="field">
          <label>${field.label}${field.required ? html`<span class="required">*</span>` : nothing}</label>
          ${this.#input(node, field, values[field.name])}
          ${hintsFor(field, values).map((hint) => html`<small>${hint}</small>`)}
          ${problems[field.name] ? html`<small class="invalid">${problems[field.name]}</small>` : nothing}
        </div>`,
      )}
      <div class="form-actions">${node.actions.map((button) => this.#button(button, node))}</div>
    </uui-box>`
  }

  #tabs(node) {
    const active = this._tabs.get(node) ?? node.tabs[0]?.id
    const shown = node.tabs.find((tab) => tab.id === active) ?? node.tabs[0]
    return html`<uui-tab-group>
        ${node.tabs.map(
          (tab) => html`<uui-tab
            label=${tab.label}
            ?active=${tab.id === shown?.id}
            @click=${() => {
              this._tabs = new Map(this._tabs).set(node, tab.id)
            }}>${tab.label}</uui-tab>`,
        )}
      </uui-tab-group>
      <div class="tab">${this.#nodes(shown?.body ?? [])}</div>`
  }

  #node(node) {
    switch (node.type) {
      case 'table':
        return this.#table(node)
      case 'form':
        return this.#form(node)
      case 'button':
        return html`<div>${this.#button(node)}</div>`
      case 'notice':
        return html`<div class="banner notice">${node.text}</div>`
      case 'problem':
        return html`<div class="banner problem">${node.text}</div>`
      case 'empty':
        return html`<uui-box headline=${node.title}>
          ${node.text ? html`<p>${node.text}</p>` : nothing}
          ${(node.actions ?? []).map((button) => this.#button(button))}
        </uui-box>`
      case 'progress':
        return html`<div class="progress">
          ${node.label ? html`<span>${node.label}</span>` : nothing}
          ${
            typeof node.value === 'number'
              ? html`<uui-progress-bar progress=${node.value}></uui-progress-bar>`
              : html`<uui-loader-bar></uui-loader-bar>`
          }
        </div>`
      case 'tabs':
        return this.#tabs(node)
      default:
        return nothing
    }
  }

  #nodes(nodes) {
    return nodes.map((node) => this.#node(node))
  }

  render() {
    const screen = this._screen
    return html`<umb-body-layout headline=${screen?.title ?? ''}>
      <div id="content">
        ${
          (screen?.toolbar ?? []).length > 0
            ? html`<div id="toolbar">
                ${screen.toolbar.map((item) =>
                  item.type === 'search' ? this.#search(item) : this.#button(item),
                )}
              </div>`
            : nothing
        }
        ${this._problem ? html`<div class="banner problem">${this._problem}</div>` : nothing}
        ${this._notice ? html`<div class="banner notice">${this._notice}</div>` : nothing}
        ${
          this._loading
            ? html`<div id="loader"><uui-loader></uui-loader></div>`
            : this.#nodes(screen?.body ?? [])
        }
      </div>
    </umb-body-layout>`
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    #content {
      padding: var(--uui-size-layout-1, 24px);
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-5, 18px);
    }
    #toolbar {
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-4, 12px);
    }
    #toolbar uui-input {
      flex: 1;
    }
    #loader {
      display: flex;
      justify-content: center;
      padding: var(--uui-size-layout-3, 48px);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-2, 6px);
      margin-bottom: var(--uui-size-space-5, 18px);
      max-width: 48rem;
    }
    .field label {
      font-weight: bold;
    }
    .field small {
      opacity: 0.8;
      line-height: 1.5;
    }
    .field small.invalid {
      color: var(--uui-color-danger, #d42054);
      opacity: 1;
    }
    .required {
      color: var(--uui-color-danger, #d42054);
      margin-left: 2px;
    }
    .form-actions,
    .actions {
      display: flex;
      gap: var(--uui-size-space-2, 6px);
    }
    .actions {
      justify-content: flex-end;
    }
    .banner {
      padding: var(--uui-size-space-4, 12px);
      border-left: 3px solid var(--uui-color-default, #3544b1);
      background: var(--uui-color-surface-alt, #f3f3f5);
    }
    .banner.problem {
      border-left-color: var(--uui-color-danger, #d42054);
    }
    .banner.notice {
      border-left-color: var(--uui-color-positive, #2bc37c);
    }
    .progress {
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-2, 6px);
    }
    .tab {
      display: flex;
      flex-direction: column;
      gap: var(--uui-size-space-5, 18px);
      padding-top: var(--uui-size-space-4, 12px);
    }
    code {
      word-break: break-all;
    }
    p {
      max-width: 60ch;
      line-height: 1.5;
    }
  `
}

if (!customElements.get('crombolo-extension-screen'))
  customElements.define('crombolo-extension-screen', CromboloExtensionScreenElement)
