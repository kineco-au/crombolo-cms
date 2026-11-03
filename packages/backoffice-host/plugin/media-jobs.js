/**
 * A header app that follows a large media change queued in the background (story
 * 246): told the job's id when it is queued, it reads its progress until it
 * finishes, then reloads the Media tree and the recycle bin.
 */
import { UMB_ACTION_EVENT_CONTEXT } from '@umbraco-cms/backoffice/action'
import { UmbElementMixin } from '@umbraco-cms/backoffice/element-api'
import { UmbRequestReloadChildrenOfEntityEvent } from '@umbraco-cms/backoffice/entity-action'
import { css, html, LitElement, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UMB_MANAGEMENT_API_SERVER_EVENT_CONTEXT } from '@umbraco-cms/backoffice/management-api'
import { mediaJobWords } from './media-jobs-words.js'

const POLL_MS = 2000
const SHOWN_AFTER_MS = 5000

const statusUrl = (id) =>
  `${(document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')}/crombolo/api/media-jobs/${encodeURIComponent(id)}`

export default class CromboloMediaJobsElement extends UmbElementMixin(LitElement) {
  static properties = { _jobs: { state: true } }

  #actions
  #timer

  constructor() {
    super()
    /** @type {Map<string, { state: string, progress?: object | null }>} */
    this._jobs = new Map()
    this.consumeContext(UMB_ACTION_EVENT_CONTEXT, (context) => {
      this.#actions = context
    })
    this.consumeContext(UMB_MANAGEMENT_API_SERVER_EVENT_CONTEXT, (context) => {
      if (!context) return
      this.observe(
        context.byEventSourcesAndEventTypes(['Crombolo:MediaJob'], ['Queued']),
        (event) => {
          if (!event?.key || this._jobs.has(event.key)) return
          this._jobs = new Map(this._jobs).set(event.key, { state: 'queued' })
          this.#poll()
        },
      )
    })
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    clearTimeout(this.#timer)
  }

  async #poll() {
    clearTimeout(this.#timer)
    const running = [...this._jobs].filter(
      ([, job]) => job.state === 'queued' || job.state === 'running',
    )
    if (running.length === 0) return
    const next = new Map(this._jobs)
    for (const [id] of running) {
      const response = await fetch(statusUrl(id), { credentials: 'include' }).catch(() => undefined)
      // Someone without the Media section is not told about it.
      if (response?.status === 403 || response?.status === 404) next.delete(id)
      if (!response?.ok) continue
      const job = await response.json()
      next.set(id, job)
      if (job.state === 'succeeded' || job.state === 'failed') this.#finished(id)
    }
    this._jobs = next
    this.#timer = setTimeout(() => this.#poll(), POLL_MS)
  }

  #finished(id) {
    for (const entityType of ['media-root', 'media-recycle-bin-root'])
      this.#actions?.dispatchEvent(
        new UmbRequestReloadChildrenOfEntityEvent({ entityType, unique: null }),
      )
    setTimeout(() => {
      const next = new Map(this._jobs)
      next.delete(id)
      this._jobs = next
    }, SHOWN_AFTER_MS)
  }

  render() {
    if (this._jobs.size === 0) return nothing
    return html`${[...this._jobs.values()].map((job) => {
      const words = mediaJobWords(job)
      return html`<uui-tag look="primary" color=${words.tone}>${words.label}</uui-tag>`
    })}`
  }

  static styles = css`
    :host { display: flex; align-items: center; gap: var(--uui-size-space-2); padding: 0 var(--uui-size-space-3); }
  `
}

customElements.define('crombolo-media-jobs', CromboloMediaJobsElement)
