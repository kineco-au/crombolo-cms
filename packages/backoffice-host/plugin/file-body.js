/**
 * A File's body (story 450): the editor its name chooses, each one the back
 * office already has. The Markdown editor, a text area, the code editor in
 * JSON, XML, HTML or SVG, or the upload field for a PDF or an image; Save and
 * preview shows it as a visitor would. A File not yet
 * named is Markdown. A text File may also be filled from a file uploaded above
 * its body, which sets its ending to that file's. Renaming the File
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
  editingName,
  editorFor,
  FILE_EXTENSIONS,
  FILE_KINDS,
  FILE_UPLOAD_MAX_BYTES,
  kindOf,
  nameAfterUpload,
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

/** What the upload above a text File's body takes: every kind of text File. */
export const TEXT_ACCEPT = FILE_KINDS.filter((kind) => kind.text)
  .map((kind) => kind.extension)
  .join(',')

export default class CromboloFileBodyElement extends UmbFormControlMixin(UmbLitElement) {
  #dataset
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
      this.#dataset = dataset
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

  async #fromFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const kind = kindOf(file.name)
    if (!kind?.text) {
      this._problem = {
        message: `Upload a text file here: ${TEXT_ACCEPT.split(',').join(', ')}.`,
      }
      return
    }
    if (file.size > FILE_UPLOAD_MAX_BYTES) {
      this._problem = {
        message: `That file is ${sizeText(file.size)}; a File takes at most 10 MB.`,
      }
      return
    }
    const text = await file.text()
    const name = nameAfterUpload(this._name, file.name)
    if (name !== this._name) this.#dataset?.setName?.(name)
    this._name = name
    this.#set(text)
  }

  #textUpload(editor) {
    if (editor === 'upload' || editor === 'folder' || editor === 'unknown') return nothing
    return html`<div class="from-file">
      <input
        id="from-file"
        type="file"
        accept=${TEXT_ACCEPT}
        hidden
        @change=${(event) => this.#fromFile(event)} />
      <uui-button
        look="secondary"
        label="Upload a file"
        @click=${() => this.renderRoot.querySelector('#from-file')?.click()}
        ><uui-icon name="icon-cloud-upload"></uui-icon> Upload a file</uui-button
      >
      <span class="hint">Its text replaces the body below.</span>
    </div>`
  }

  render() {
    const editor = editorFor(editingName(this._name))
    return html`
      ${this.#notes(editor)}
      ${this.#textUpload(editor)}
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
        return nothing
      case 'unknown':
        return html`<p class="hint">
          Files are served by their extension. Use one of: ${FILE_EXTENSIONS.join(', ')}.
        </p>`
      case 'markdown':
        return html`<umb-input-markdown
          .value=${text}
          @change=${(event) => this.#text(event)}></umb-input-markdown>`
      case 'text':
      case 'csv':
        return html`<uui-textarea
          label="Body"
          auto-height
          .value=${text}
          @input=${(event) => this.#text(event)}></uui-textarea>`
      case 'json':
      case 'xml':
      case 'html':
      case 'svg':
        return html`<umb-code-editor
          class="code"
          .language=${CODE_LANGUAGE[editor]}
          .code=${text}
          @input=${(event) => this.#code(event)}></umb-code-editor>`
      case 'upload':
        return this.#uploaded(value)
      default:
        return nothing
    }
  }

  #uploaded(value) {
    const stored = value && typeof value === 'object' && value.src ? value : undefined
    const field = html`<umb-input-upload-field
      @change=${(event) => this.#upload(event)}></umb-input-upload-field>`
    if (!stored || !this._key) return field
    const href = fileItemUrl(this._key, 'body')
    return html`<div class="upload">
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
    uui-textarea {
      width: 100%;
      --uui-textarea-min-height: 200px;
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
    .from-file {
      display: flex;
      align-items: center;
      gap: var(--uui-size-space-3, 9px);
      margin-bottom: var(--uui-size-space-4, 12px);
    }
    .from-file .hint {
      margin: 0;
    }
    .problem {
      color: var(--uui-color-danger);
    }
  `
}

customElements.define('crombolo-file-body', CromboloFileBodyElement)
