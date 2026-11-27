/**
 * A File's body (story 450): the editor its name chooses, each one the back
 * office already has. Markdown with its preview, a text area, the code editor
 * in JSON, XML or HTML (an SVG with its image beside it), a CSV with its first
 * rows as a table, or the upload field for a PDF or an image. Renaming the File
 * switches the editor; a body of the other kind has to be replaced before the
 * File saves. JSON and XML are checked as you type, and again on the server.
 */
import '@umbraco-cms/backoffice/code-editor'
import '@umbraco-cms/backoffice/markdown-editor'
import '@umbraco-cms/backoffice/media'
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UMB_PROPERTY_DATASET_CONTEXT } from '@umbraco-cms/backoffice/property'
import { UmbFormControlMixin } from '@umbraco-cms/backoffice/validation'
import {
  bodyProblem,
  csvRows,
  editorFor,
  FILE_EXTENSIONS,
  kindOf,
  replaceNote,
  sizeText,
} from './file-kinds.js'

const base = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

/** Where the server keeps what this editor shows of a File. */
export const fileItemUrl = (key, part) =>
  `${base()}/crombolo/api/file-item/${encodeURIComponent(key)}${part ? `/${part}` : ''}`

/** The code editor's language for each kind it edits. */
export const CODE_LANGUAGE = { json: 'json', xml: 'xml', html: 'html', svg: 'xml' }

/** What the agents' guide File's editor says of it. */
export const AGENTS_GUIDE_NOTE =
  'Coding agents read this File as instructions: whoever edits it is writing instructions for them. A site that cares puts it under a workflow, so a change to it is approved before it is published.'

export default class CromboloFileBodyElement extends UmbFormControlMixin(UmbLitElement) {
  static properties = {
    _name: { state: true },
    _key: { state: true },
    _details: { state: true },
    _problem: { state: true },
    _sent: { state: true },
  }

  constructor() {
    super()
    this._name = ''
    this._key = undefined
    this._details = undefined
    this._problem = undefined
    this._sent = undefined
    this.addValidator(
      'customError',
      () => this._problem?.message ?? '',
      () => Boolean(this._problem),
    )
    this.consumeContext(UMB_PROPERTY_DATASET_CONTEXT, (dataset) => {
      if (dataset?.name)
        this.observe(dataset.name, (name) => {
          this._name = name ?? ''
          this.#check()
        })
    })
    this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
      this.observe(workspace?.unique, (unique) => {
        if (!unique || unique === this._key) return
        this._key = unique
        fetch(fileItemUrl(unique), { credentials: 'include' })
          .then((response) => (response.ok ? response.json() : undefined))
          .then(
            (details) => {
              this._details = details
            },
            () => {},
          )
      })
    })
  }

  updated(changed) {
    super.updated?.(changed)
    if (changed.has('value')) this.#check()
  }

  #check() {
    const problem = this._name ? bodyProblem(this._name, this.value ?? null, this._sent) : undefined
    this._problem = problem
    this.checkValidity?.()
  }

  #set(value, sent) {
    this.value = value
    this._sent = sent
    this.#check()
    this.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
  }

  #text(event) {
    event.stopPropagation()
    this.#set(event.target.value ?? '')
  }

  #code(event) {
    event.stopPropagation()
    this.#set(event.target.code ?? '')
  }

  #upload(event) {
    event.stopPropagation()
    const field = event.target
    const id = field.value?.temporaryFileId
    const file = field.temporaryFile?.file
    if (!id) {
      this.#set(undefined)
      return
    }
    this.#set({ temporaryFileId: id }, file ? { name: file.name, size: file.size } : undefined)
  }

  render() {
    const editor = editorFor(this._name)
    return html`
      ${this.#notes(editor)}
      ${this.#editor(editor)}
      ${
        this._problem ? html`<p class="problem" role="alert">${this._problem.message}</p>` : nothing
      }
    `
  }

  #notes(editor) {
    const notes = []
    if (this._details?.agentsGuide) notes.push(html`<p class="note">${AGENTS_GUIDE_NOTE}</p>`)
    if (this._details?.winner)
      notes.push(
        html`<p class="note">This File is never served at ${this._details.address}: ${this._details.winner}.</p>`,
      )
    if (editor === 'html')
      notes.push(html`<p class="hint">It is shown to visitors with no scripts run.</p>`)
    const replace = replaceNote(this._name, this.value)
    if (replace)
      notes.push(
        html`<p class="note">${replace}</p>
          <uui-button look="secondary" label="Clear the body" @click=${() => this.#set(undefined)}
            >Clear the body</uui-button
          >`,
      )
    return notes
  }

  #editor(editor) {
    const value = this.value
    const text = typeof value === 'string' ? value : ''
    switch (editor) {
      case 'folder':
        return html`<p class="hint">
          A File with no extension in its name is a folder: it holds Files, and answers nothing at
          its own address. Name it with an extension, such as notes.txt, to give it a body.
        </p>`
      case 'unknown':
        return html`<p class="hint">
          Files are served by their extension. Use one of: ${FILE_EXTENSIONS.join(', ')}.
        </p>`
      case 'markdown':
        return html`<umb-input-markdown
          preview
          .value=${text}
          @change=${(event) => this.#text(event)}></umb-input-markdown>`
      case 'text':
        return html`<uui-textarea
          label="Body"
          auto-height
          .value=${text}
          @input=${(event) => this.#text(event)}></uui-textarea>`
      case 'csv':
        return html`<uui-textarea
            label="Body"
            auto-height
            .value=${text}
            @input=${(event) => this.#text(event)}></uui-textarea>
          ${this.#table(text)}`
      case 'json':
      case 'xml':
      case 'html':
      case 'svg':
        return html`<div class=${editor === 'svg' ? 'beside' : ''}>
          <umb-code-editor
            class="code"
            .language=${CODE_LANGUAGE[editor]}
            .code=${text}
            @input=${(event) => this.#code(event)}></umb-code-editor>
          ${
            editor === 'svg' && text && !this._problem
              ? html`<img
                  class="svg"
                  alt="The image as it is drawn"
                  src=${`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`} />`
              : nothing
          }
        </div>`
      case 'upload':
        return this.#uploaded(value)
      default:
        return nothing
    }
  }

  #table(text) {
    const rows = csvRows(text, 20)
    if (rows.length === 0) return nothing
    return html`<table aria-label="The first rows">
      ${rows.map((row) => html`<tr>${row.map((cell) => html`<td>${cell}</td>`)}</tr>`)}
    </table>`
  }

  #uploaded(value) {
    const stored = value && typeof value === 'object' && value.src ? value : undefined
    const image = kindOf(this._name)?.contentType.startsWith('image/')
    const field = html`<umb-input-upload-field
      @change=${(event) => this.#upload(event)}></umb-input-upload-field>`
    if (!stored || !this._key) return field
    const href = fileItemUrl(this._key, 'body')
    return html`<div class="upload">
        ${image ? html`<img class="preview" alt="The File's image" src=${href} />` : nothing}
        <p>
          ${stored.name}, ${sizeText(stored.size ?? 0)}.
          <a href=${href} target="_blank" rel="noopener">Open it</a>
        </p>
      </div>
      <p class="hint">Upload another file to replace it.</p>
      ${field}`
  }

  static styles = css`
    :host {
      display: block;
    }
    .code {
      display: block;
      height: 400px;
      border-radius: var(--uui-border-radius);
      border: 1px solid var(--uui-color-divider-emphasis);
    }
    .beside {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
      gap: var(--uui-size-space-4, 12px);
    }
    .svg,
    .preview {
      max-width: 100%;
      max-height: 300px;
      border: 1px solid var(--uui-color-divider);
      background: var(--uui-color-surface-alt);
    }
    uui-textarea {
      width: 100%;
      --uui-textarea-min-height: 200px;
    }
    table {
      margin-top: var(--uui-size-space-4, 12px);
      border-collapse: collapse;
      font-size: var(--uui-type-small-size, 0.8rem);
    }
    td {
      border: 1px solid var(--uui-color-divider);
      padding: 2px 6px;
    }
    .note,
    .hint {
      margin: 0 0 var(--uui-size-space-3, 9px);
      color: var(--uui-color-text-alt);
    }
    .note {
      padding: var(--uui-size-space-3, 9px);
      border-left: 3px solid var(--uui-color-warning);
      background: var(--uui-color-surface-alt);
      color: var(--uui-color-text);
    }
    .problem {
      color: var(--uui-color-danger);
    }
  `
}

customElements.define('crombolo-file-body', CromboloFileBodyElement)
