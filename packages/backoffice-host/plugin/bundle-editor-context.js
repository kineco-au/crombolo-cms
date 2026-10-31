/**
 * What the Bundle Editor's tabs share (story 233): the bundle's definition as
 * Umbraco's package repository reads and saves it, so a definition made in
 * Umbraco's builder opens here unchanged; and its forms, workflows and user
 * groups (story 226), which Umbraco's definition has no fields for.
 */
import { UmbContextBase } from '@umbraco-cms/backoffice/class-api'
import { UmbContextToken } from '@umbraco-cms/backoffice/context-api'
import { UmbObjectState } from '@umbraco-cms/backoffice/observable-api'
import { UmbPackageRepository } from '@umbraco-cms/backoffice/package'
import { blobDownload } from '@umbraco-cms/backoffice/utils'
import { carriedSchema, readSchemaPicks, saveSchemaPicks, schemaChoices } from './bundles-client.js'

const NO_PICKS = { forms: [], workflows: [], userGroups: [], excluded: [] }

export const CROMBOLO_BUNDLE_EDITOR_CONTEXT = new UmbContextToken('CromboloBundleEditorContext')

/** Provides itself to the editor's tabs, as Umbraco's contexts do. */
export class CromboloBundleEditorContext extends UmbContextBase {
  #repository
  #state = new UmbObjectState(undefined)
  /** The definition, as it stands in the editor. */
  definition = this.#state.asObservable()
  #picks = new UmbObjectState(NO_PICKS)
  /** The forms, workflows and user groups picked, and the dependencies unticked. */
  picks = this.#picks.asObservable()
  #carried = new UmbObjectState([])
  #asked = 0
  /** What the picks carry: each pick, and what it brings and why. */
  carried = this.#carried.asObservable()
  #choices = new UmbObjectState({ forms: [], workflows: [], userGroups: [] })
  /** The site's forms, workflows and user groups. */
  choices = this.#choices.asObservable()

  constructor(host) {
    super(host, CROMBOLO_BUNDLE_EDITOR_CONTEXT)
    this.#repository = new UmbPackageRepository(host)
  }

  /** Reads a saved definition, or a new one when `unique` is undefined. */
  async load(unique) {
    this.#state.setValue(await this.#repository.getCreatedPackage(unique))
    const [choices, picks] = await Promise.all([
      schemaChoices().catch(() => undefined),
      unique ? readSchemaPicks(unique).catch(() => undefined) : undefined,
    ])
    if (choices) this.#choices.setValue(choices)
    await this.updatePicks(picks ?? NO_PICKS)
  }

  /** Changes some of the picks, and works out again what they carry. */
  async updatePicks(patch) {
    const picks = { ...this.#picks.getValue(), ...patch }
    this.#picks.setValue(picks)
    const asked = ++this.#asked
    const { carried } = await carriedSchema(picks).catch(() => ({ carried: [] }))
    if (asked === this.#asked) this.#carried.setValue(carried ?? [])
  }

  get value() {
    return this.#state.getValue()
  }

  /** Changes some of the definition's fields. */
  update(patch) {
    const current = this.#state.getValue()
    if (current) this.#state.setValue({ ...current, ...patch })
  }

  /** Saves it, creating it the first time; resolves to its unique, or undefined. */
  async save() {
    const current = this.#state.getValue()
    if (!current) return undefined
    let unique = current.unique
    if (unique) {
      if (!(await this.#repository.updateCreatedPackage(current))) return undefined
    } else {
      unique = await this.#repository.saveCreatedPackage(current)
      if (!unique || typeof unique !== 'string') return undefined
      this.update({ unique })
    }
    await saveSchemaPicks(unique, this.#picks.getValue())
    return unique
  }

  /** Downloads the built bundle. */
  async download() {
    const unique = this.#state.getValue()?.unique
    if (!unique) return
    const data = await this.#repository.getCreatePackageDownload(unique)
    if (!data) return
    const zip = typeof data === 'object'
    blobDownload(data, zip ? 'bundle.zip' : 'bundle.xml', zip ? 'application/zip' : 'text/xml')
  }
}
