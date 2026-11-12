/**
 * The user group editor (story 338): Access, Permissions, Exceptions, Data
 * Transfer and People, in place of Umbraco's checkbox grids. It reads and writes
 * the group through the workspace's own context, so Save, routing, the tree and
 * the read-only rules for non-administrators stay the workspace's.
 */
import { UmbDocumentItemRepository } from '@umbraco-cms/backoffice/document'
import { UmbDocumentTypeDetailRepository } from '@umbraco-cms/backoffice/document-type'
import { UmbElementItemRepository } from '@umbraco-cms/backoffice/element'
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UmbTextStyles } from '@umbraco-cms/backoffice/style'
import { UMB_USER_GROUP_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/user-group'
import {
  ACCESS_OFF,
  AREAS,
  exceptionSentence,
  exceptionSummary,
  KIND_AREA,
  KIND_LABEL,
  kindVerbs,
  LEVELS,
  levelOf,
  libraryFollowsPages,
  SENSITIVE_ANSWERS,
  SYSTEM_GROUPS,
  shownLevel,
  systemGroupNote,
  TABS,
  TRANSFER,
  VERB_WORDS,
  withLevel,
  withVerb,
} from './group-editor-words.js'

const DOCUMENT = 'DocumentPermissionPresentationModel'
const ELEMENT = 'ElementPermissionPresentationModel'
const FIELD = 'DocumentPropertyValuePermissionPresentationModel'
const WRITE_FIELD = 'Umb.Document.PropertyValue.Write'

const idOf = (ref) => ref?.id ?? ref?.unique

/** Which of a group's granular entries are exceptions the editor lists. */
function kindOfEntry(entry) {
  if (entry.$type === DOCUMENT && entry.document) return 'pages'
  if (entry.$type === ELEMENT && entry.element) return 'library'
  if (
    (entry.$type === FIELD || entry.userPermissionType === 'document-property-value') &&
    entry.propertyType
  )
    return 'field'
  return undefined
}

export default class CromboloGroupEditorElement extends UmbLitElement {
  static properties = {
    _tab: { state: true },
    _group: { state: true },
    _readOnly: { state: true },
    _canManageMembers: { state: true },
    _names: { state: true },
    _adding: { state: true },
    _open: { state: true },
  }

  #context
  #documents = new UmbDocumentItemRepository(this)
  #elements = new UmbElementItemRepository(this)
  #documentTypes = new UmbDocumentTypeDetailRepository(this)

  constructor() {
    super()
    this._tab = 'access'
    this._group = {}
    this._readOnly = true
    this._canManageMembers = false
    this._names = {}
    this._adding = undefined
    this._open = {}
    this.consumeContext(UMB_USER_GROUP_WORKSPACE_CONTEXT, (context) => {
      this.#context = context
      for (const key of [
        'name',
        'alias',
        'sections',
        'languages',
        'hasAccessToAllLanguages',
        'documentStartNode',
        'documentRootAccess',
        'mediaStartNode',
        'mediaRootAccess',
        'elementStartNode',
        'elementRootAccess',
        'fallbackPermissions',
        'permissions',
        'owners',
      ])
        this.observe(
          context?.[key],
          (value) => {
            this._group = { ...this._group, [key]: value }
            if (key === 'permissions') this.#nameExceptions(value ?? [])
          },
          `_observe_${key}`,
        )
      this.observe(
        context?.readOnly,
        (value) => (this._readOnly = value ?? true),
        '_observeReadOnly',
      )
      this.observe(
        context?.canManageMembers,
        (value) => (this._canManageMembers = value ?? false),
        '_observeCanManageMembers',
      )
    })
  }

  // ---- reading and writing the group

  get #verbs() {
    return this._group.fallbackPermissions ?? []
  }
  #setVerbs(verbs) {
    this.#context?.setFallbackPermissions(verbs)
  }
  #set(key, value) {
    this.#context?.updateProperty(key, value)
  }
  get #alias() {
    return this._group.alias ?? ''
  }
  get #isAdminGroup() {
    return this.#alias.toLowerCase() === 'admin'
  }
  /** Story 338: a built-in group's access and permissions are shown, never changed. */
  get #permissionsLocked() {
    return this._readOnly || SYSTEM_GROUPS.has(this.#alias)
  }
  #renderSystemNote() {
    return SYSTEM_GROUPS.has(this.#alias)
      ? html`<div class="notice" role="status"><uui-icon name="icon-lock"></uui-icon>${systemGroupNote(this.#alias)}</div>`
      : nothing
  }

  #hasArea(section) {
    return (this._group.sections ?? []).includes(section)
  }

  async #nameExceptions(entries) {
    const pages = entries.filter((e) => kindOfEntry(e) === 'pages').map((e) => idOf(e.document))
    const items = entries.filter((e) => kindOfEntry(e) === 'library').map((e) => idOf(e.element))
    const types = [
      ...new Set(
        entries.filter((e) => kindOfEntry(e) === 'field').map((e) => idOf(e.documentType)),
      ),
    ]
    const names = { ...this._names }
    if (pages.length) {
      const { data } = await this.#documents.requestItems(pages)
      for (const item of data ?? [])
        names[item.unique] = item.variants?.[0]?.name ?? item.name ?? item.unique
    }
    if (items.length) {
      const { data } = await this.#elements.requestItems(items)
      for (const item of data ?? [])
        names[item.unique] = item.variants?.[0]?.name ?? item.name ?? item.unique
    }
    for (const type of types) {
      if (names[type]) continue
      const { data } = await this.#documentTypes.requestByUnique(type)
      if (!data) continue
      names[type] = data.name
      for (const property of data.properties ?? []) names[property.unique] = property.name
    }
    this._names = names
  }

  // ---- Access

  #toggleArea(section, on) {
    const sections = this._group.sections ?? []
    this.#set(
      'sections',
      on ? [...new Set([...sections, section])] : sections.filter((s) => s !== section),
    )
  }

  #renderSwitch(on, label, toggle) {
    return html`<button
      type="button"
      role="switch"
      class="switch ${on ? 'on' : ''}"
      aria-checked=${on ? 'true' : 'false'}
      aria-label=${`${label}: ${on ? 'on' : 'off'}`}
      ?disabled=${this.#permissionsLocked}
      @click=${() => toggle(!on)}><span></span></button>`
  }

  #renderWhere(label, root, node, rootKey, nodeKey, picker) {
    return html`<div class="row">
      <span class="row-label">${label}</span>
      <div class="row-value">
        <uui-toggle
          label="Everywhere"
          ?checked=${root}
          ?disabled=${this.#permissionsLocked}
          @change=${(e) => {
            this.#set(rootKey, e.target.checked)
            this.#set(nodeKey, null)
          }}></uui-toggle>
        ${root ? nothing : picker(node ? [node.unique ?? node.id] : [])}
      </div>
    </div>`
  }

  #pick(nodeKey) {
    return (e) => {
      const unique = e.target.selection?.[0]
      this.#set(nodeKey, unique ? { unique } : null)
    }
  }

  #renderAreaSettings(section) {
    const g = this._group
    if (section === 'Umb.Section.Content')
      return html`
        ${this.#renderWhere('Pages', g.documentRootAccess, g.documentStartNode, 'documentRootAccess', 'documentStartNode', (selection) => html`<umb-input-document max="1" ?readonly=${this.#permissionsLocked} .selection=${selection} @change=${this.#pick('documentStartNode')}></umb-input-document>`)}
        <div class="row">
          <span class="row-label">Languages</span>
          <div class="row-value">
            <uui-toggle
              label="All languages"
              ?checked=${g.hasAccessToAllLanguages}
              ?disabled=${this.#permissionsLocked}
              @change=${(e) => this.#set('hasAccessToAllLanguages', e.target.checked)}></uui-toggle>
            ${
              g.hasAccessToAllLanguages
                ? nothing
                : html`<umb-input-language
                    ?readonly=${this.#permissionsLocked}
                    .selection=${g.languages ?? []}
                    @change=${(e) => this.#set('languages', e.target.selection)}></umb-input-language>`
            }
          </div>
        </div>
      `
    if (section === 'Umb.Section.Library')
      return this.#renderWhere(
        'Folders',
        g.elementRootAccess,
        g.elementStartNode,
        'elementRootAccess',
        'elementStartNode',
        (selection) =>
          html`<umb-input-element max="1" ?folderOnly=${true} ?readonly=${this.#permissionsLocked} .selection=${selection} @change=${this.#pick('elementStartNode')}></umb-input-element>`,
      )
    if (section === 'Umb.Section.Media')
      return this.#renderWhere(
        'Folders',
        g.mediaRootAccess,
        g.mediaStartNode,
        'mediaRootAccess',
        'mediaStartNode',
        (selection) =>
          html`<umb-input-media max="1" folder-filter="foldersOnly" ?readonly=${this.#permissionsLocked} .selection=${selection} @change=${this.#pick('mediaStartNode')}></umb-input-media>`,
      )
    return nothing
  }

  #renderAccess() {
    return html`
      ${this.#renderSystemNote()}
      ${AREAS.map((area) => {
        const on = this.#hasArea(area.section)
        const settings = on ? this.#renderAreaSettings(area.section) : nothing
        return html`<uui-box class="area ${on ? '' : 'off'}">
          <div class="area-head">
            ${this.#renderSwitch(on, area.label, (value) => this.#toggleArea(area.section, value))}
            <div class="area-text">
              <h2>${area.label}</h2>
              <p>${area.line}</p>
            </div>
            <span class="state">${on ? 'On' : 'Off'}</span>
          </div>
          ${settings === nothing ? nothing : html`<div class="area-body">${settings}</div>`}
        </uui-box>`
      })}
    `
  }

  // ---- Permissions

  #renderLevels(kind, current, choose, disabled = false) {
    return html`<div class="levels" role="radiogroup" aria-label=${KIND_LABEL[kind]}>
      ${LEVELS[kind].map(
        (level) => html`<label class="level ${current === level.id ? 'chosen' : ''}">
          <input
            type="radio"
            name=${`level-${kind}`}
            .checked=${current === level.id}
            ?disabled=${disabled || this.#permissionsLocked}
            @change=${() => choose(level.id)} />
          <span class="level-text"><strong>${level.label}</strong><span>${level.line}</span></span>
        </label>`,
      )}
      ${current === 'custom' ? html`<span class="custom">Custom</span>` : nothing}
    </div>`
  }

  #renderCustomise(kind, current) {
    // An administrator can do everything, so their verbs are nothing to customise.
    if (this.#isAdminGroup) return nothing
    const open = this._open[kind] || current === 'custom'
    const verbs = this.#verbs
    return html`<details ?open=${open} @toggle=${(e) => (this._open = { ...this._open, [kind]: e.target.open })}>
      <summary>Customise</summary>
      <div class="verbs">
        ${kindVerbs(kind).map(
          (verb) => html`<label class="verb">
            <input
              type="checkbox"
              .checked=${verbs.includes(verb)}
              ?disabled=${this.#permissionsLocked}
              @change=${(e) => this.#setVerbs(withVerb(verbs, verb, e.target.checked))} />
            ${VERB_WORDS[verb] ?? verb}
          </label>`,
        )}
      </div>
    </details>`
  }

  #renderKind(kind, extra = nothing) {
    const area = KIND_AREA[kind]
    const label = KIND_LABEL[kind]
    if (!this.#hasArea(area))
      return html`<section class="kind off" aria-disabled="true">
        <div class="kind-head">
          <h2>${label}</h2>
          <span class="pill">Access is off</span>
          <span class="note">${ACCESS_OFF(label)}
            <button type="button" class="link" @click=${() => (this._tab = 'access')}>Go to Access</button></span>
        </div>
        ${this.#renderLevels(kind, 'none', () => {}, true)}
      </section>`
    const current = shownLevel(kind, this.#verbs, this.#alias)
    return html`<section class="kind">
      <div class="kind-head"><h2>${label}</h2></div>
      ${this.#renderLevels(kind, current, (id) => this.#setVerbs(withLevel(this.#verbs, kind, id)))}
      ${extra} ${this.#renderCustomise(kind, current)}
    </section>`
  }

  #renderLibrary() {
    if (!this.#hasArea(KIND_AREA.library)) return this.#renderKind('library')
    const follows = this.#isAdminGroup || libraryFollowsPages(this.#verbs)
    if (!follows || this._open.libraryOwn)
      return this.#renderKind('library', this.#renderFollow(false))
    return html`<section class="kind">
      <div class="kind-head"><h2>Library</h2></div>
      ${this.#renderFollow(true)}
    </section>`
  }

  #renderFollow(follows) {
    return html`<div class="follow">
      <label class="level ${follows ? 'chosen' : ''}"><input
          type="radio"
          name="library-follows"
          .checked=${follows}
          ?disabled=${this.#permissionsLocked}
          @change=${() => {
            this._open = { ...this._open, libraryOwn: false }
            const pages = levelOf('pages', this.#verbs)
            if (pages !== 'custom') this.#setVerbs(withLevel(this.#verbs, 'library', pages))
          }} /><strong>Same as pages</strong></label>
      <label class="level ${follows ? '' : 'chosen'}"><input
          type="radio"
          name="library-follows"
          .checked=${!follows}
          ?disabled=${this.#permissionsLocked}
          @change=${() => (this._open = { ...this._open, libraryOwn: true })} /><strong>Choose separately</strong></label>
    </div>`
  }

  #renderPermissions() {
    const sensitive = html`<label class="verb">
      <input
        type="checkbox"
        .checked=${this.#isAdminGroup || this.#verbs.includes(SENSITIVE_ANSWERS)}
        ?disabled=${this.#permissionsLocked}
        @change=${(e) => this.#setVerbs(withVerb(this.#verbs, SENSITIVE_ANSWERS, e.target.checked))} />
      Can see answers marked sensitive
    </label>`
    return html`
      ${this.#renderSystemNote()}
      ${this.#renderKind('pages')} ${this.#renderLibrary()} ${this.#renderKind('media')}
      ${this.#renderKind('forms', sensitive)}
    `
  }

  // ---- Exceptions

  get #exceptions() {
    return (this._group.permissions ?? [])
      .map((entry, index) => ({ entry, index, kind: kindOfEntry(entry) }))
      .filter((e) => e.kind)
  }

  #describe({ entry, kind }) {
    if (kind === 'field')
      return exceptionSentence(
        {
          kind,
          typeName: this._names[idOf(entry.documentType)] ?? 'A page type',
          fieldName: this._names[idOf(entry.propertyType)] ?? 'a field',
          verbs: entry.verbs,
        },
        this.#verbs,
      )
    const id = idOf(kind === 'library' ? entry.element : entry.document)
    return exceptionSentence(
      { kind, name: this._names[id] ?? '…', verbs: entry.verbs },
      this.#verbs,
    )
  }

  #remove(index) {
    this.#context?.setPermissions((this._group.permissions ?? []).filter((_, i) => i !== index))
  }

  #renderExceptions() {
    const list = this.#exceptions
    return html`
      ${this.#renderSystemNote()}
      <div class="intro-row">
        ${
          this._readOnly
            ? nothing
            : html`<uui-button look="primary" label="Add an exception" ?disabled=${this.#permissionsLocked} @click=${() => (this._adding = { kind: 'pages', level: 'see' })}></uui-button>`
        }
      </div>
      ${this._adding ? this.#renderAdding() : nothing}
      ${
        list.length === 0
          ? html`<p class="empty">No exceptions: the permissions apply everywhere this group has access.</p>`
          : html`<uui-box>
              ${list.map((item) => {
                const said = this.#describe(item)
                return html`<div class="exception">
                  <div class="exception-text">
                    <strong>${said.where}</strong> <span class="muted">${said.whereNote}</span>
                    <div>${said.what}</div>
                  </div>
                  ${
                    this.#permissionsLocked
                      ? nothing
                      : html`<uui-button look="secondary" color="danger" label="Remove" @click=${() => this.#remove(item.index)}></uui-button>`
                  }
                </div>`
              })}
            </uui-box>`
      }
      <p class="note">An exception on a page covers that page and everything below it, and the nearest one wins. An exception on a field applies on every page of that type.</p>
    `
  }

  async #chooseType(unique) {
    const { data } = await this.#documentTypes.requestByUnique(unique)
    this._adding = {
      ...this._adding,
      typeId: unique,
      typeName: data?.name,
      fields: (data?.properties ?? []).map((p) => ({ id: p.unique, name: p.name })),
      fieldId: undefined,
    }
  }

  #addException() {
    const a = this._adding
    const entries = [...(this._group.permissions ?? [])]
    if (a.kind === 'field') {
      if (!a.typeId || !a.fieldId) return
      entries.push({
        $type: FIELD,
        userPermissionType: 'document-property-value',
        documentType: { id: a.typeId, unique: a.typeId },
        propertyType: { id: a.fieldId, unique: a.fieldId },
        verbs: a.level === 'edit' ? [WRITE_FIELD] : [],
      })
    } else {
      if (!a.placeId) return
      const verbs = LEVELS[a.kind].find((l) => l.id === a.level)?.verbs ?? []
      entries.push(
        a.kind === 'library'
          ? { $type: ELEMENT, element: { id: a.placeId }, verbs }
          : { $type: DOCUMENT, document: { id: a.placeId }, verbs },
      )
    }
    this.#context?.setPermissions(entries)
    this._adding = undefined
  }

  #renderAdding() {
    const a = this._adding
    const set = (patch) => (this._adding = { ...a, ...patch })
    const field = a.kind === 'field'
    const placeName = field
      ? `${a.typeName ?? 'the page type'} › ${a.fields?.find((f) => f.id === a.fieldId)?.name ?? 'the field'}`
      : (a.placeName ?? 'the chosen place')
    return html`<uui-box headline="Add an exception" class="adding">
      <fieldset>
        <legend>1. What is it for?</legend>
        <div class="stack">
          ${[
            ['pages', 'A page and everything below it'],
            ['library', 'A Library folder and everything in it'],
            ['field', 'One field on a page type'],
          ].map(
            ([kind, label]) => html`<label class="level ${a.kind === kind ? 'chosen' : ''}"><input
                type="radio"
                name="exception-kind"
                .checked=${a.kind === kind}
                @change=${() => (this._adding = { kind, level: kind === 'field' ? 'see' : 'see' })} /><strong>${label}</strong></label>`,
          )}
        </div>
      </fieldset>
      <div class="step">
        <span class="step-label">2. ${field ? 'Which field?' : 'Which one?'}</span>
        ${
          field
            ? html`<umb-input-document-type
                  max="1"
                  .selection=${a.typeId ? [a.typeId] : []}
                  @change=${(e) => e.target.selection?.[0] && this.#chooseType(e.target.selection[0])}></umb-input-document-type>
                ${
                  a.fields
                    ? html`<uui-select
                        label="Field"
                        .options=${[{ name: 'Choose a field', value: '', selected: !a.fieldId }, ...a.fields.map((f) => ({ name: f.name, value: f.id, selected: f.id === a.fieldId }))]}
                        @change=${(e) => set({ fieldId: e.target.value || undefined })}></uui-select>`
                    : nothing
                }`
            : a.kind === 'library'
              ? html`<umb-input-element max="1" ?folderOnly=${true} @change=${async (e) => {
                  const id = e.target.selection?.[0]
                  const { data } = id ? await this.#elements.requestItems([id]) : { data: [] }
                  set({ placeId: id, placeName: data?.[0]?.name ?? data?.[0]?.variants?.[0]?.name })
                }}></umb-input-element>`
              : html`<umb-input-document max="1" @change=${async (e) => {
                  const id = e.target.selection?.[0]
                  const { data } = id ? await this.#documents.requestItems([id]) : { data: [] }
                  set({ placeId: id, placeName: data?.[0]?.variants?.[0]?.name ?? data?.[0]?.name })
                }}></umb-input-document>`
        }
      </div>
      <fieldset>
        <legend>3. What can they do there?</legend>
        ${
          field
            ? html`<div class="levels">
                ${[
                  ['see', "See it, can't change it"],
                  ['edit', 'Change it'],
                ].map(
                  ([
                    id,
                    label,
                  ]) => html`<label class="level ${a.level === id ? 'chosen' : ''}"><input
                      type="radio"
                      name="exception-level"
                      .checked=${a.level === id}
                      @change=${() => set({ level: id })} /><strong>${label}</strong></label>`,
                )}
              </div>`
            : this.#renderLevels(a.kind, a.level, (id) => set({ level: id }))
        }
      </fieldset>
      <p class="summary">${exceptionSummary(this._group.name ?? 'This group', a.kind, placeName, a.level)}</p>
      <div class="actions">
        <uui-button look="secondary" label="Cancel" @click=${() => (this._adding = undefined)}></uui-button>
        <uui-button
          look="primary"
          label="Add exception"
          ?disabled=${field ? !(a.typeId && a.fieldId) : !a.placeId}
          @click=${() => this.#addException()}></uui-button>
      </div>
    </uui-box>`
  }

  // ---- Data Transfer

  #renderTransfer() {
    const verbs = this.#verbs
    const groups = [...new Set(TRANSFER.map((entry) => entry.group))]
    return html`
      ${this.#renderSystemNote()}
      ${groups.map(
        (group) => html`<uui-box headline=${group}>
          ${TRANSFER.filter((entry) => entry.group === group).map((entry) => {
            const blocked = entry.under && !verbs.includes(entry.under)
            return html`<label class="transfer ${entry.under ? 'under' : ''} ${entry.warning ? 'warning' : ''}">
              <input
                type="checkbox"
                .checked=${verbs.includes(entry.verb)}
                ?disabled=${this.#permissionsLocked || blocked}
                @change=${(e) => this.#setVerbs(withVerb(verbs, entry.verb, e.target.checked))} />
              <span><strong>${entry.label}</strong><span class="muted">${entry.line}</span></span>
            </label>`
          })}
        </uui-box>`,
      )}
    `
  }

  // ---- People

  #renderPeople() {
    const alias = (this._group.alias ?? '').toLowerCase()
    const unownable =
      alias === 'admin' || this.#verbs.some((verb) => verb.startsWith('Crombolo.Remote.'))
    const owners = this._group.owners ?? []
    return html`<div class="people">
      <umb-user-group-workspace-users ?readonly=${!this._canManageMembers}></umb-user-group-workspace-users>
      <uui-box headline="Owners">
        ${
          unownable && owners.length === 0
            ? html`<p class="muted">${
                alias === 'admin'
                  ? 'The administrators group never has owners: only an administrator can make someone an administrator.'
                  : "This group can't have owners, because it can move sites or install code. Only an administrator can add people to it."
              }</p>`
            : html`<p class="muted">Owners can manage group members</p>
                <umb-user-group-input
                  ?readonly=${this._readOnly}
                  .selection=${owners.map((owner) => owner.unique)}
                  @change=${(e) =>
                    this.#set(
                      'owners',
                      e.target.selection.map((unique) => ({ unique })),
                    )}></umb-user-group-input>`
        }
      </uui-box>
    </div>`
  }

  // ---- the page

  #notice() {
    if (!this._readOnly) return nothing
    return html`<div class="notice" role="status">
      <uui-icon name="icon-lock"></uui-icon>
      ${
        this._canManageMembers
          ? "Only an administrator can change what this group allows. You can choose who's in it."
          : 'Only an administrator can change this group.'
      }
    </div>`
  }

  render() {
    const tabs = TABS.filter((tab) => !tab.adminOnly || !this._readOnly)
    const count = this.#exceptions.length
    const body = {
      access: () => this.#renderAccess(),
      permissions: () => this.#renderPermissions(),
      exceptions: () => this.#renderExceptions(),
      transfer: () => this.#renderTransfer(),
      people: () => this.#renderPeople(),
    }[this._tab]
    return html`
      <uui-tab-group>
        ${tabs.map(
          (tab) => html`<uui-tab
            label=${tab.label}
            ?active=${this._tab === tab.id}
            @click=${() => (this._tab = tab.id)}>${tab.label}${
              tab.id === 'exceptions' && count > 0
                ? html` <span class="count">${count}</span>`
                : nothing
            }</uui-tab>`,
        )}
      </uui-tab-group>
      <div class="body">${this.#notice()} ${body()}</div>
    `
  }

  static styles = [
    UmbTextStyles,
    css`
      :host { display: block; }
      uui-tab-group { padding: 0 var(--uui-size-layout-1); border-bottom: 1px solid var(--uui-color-border); background: var(--uui-color-surface); }
      .count { background: var(--uui-color-selected); color: var(--uui-color-selected-contrast); border-radius: 999px; padding: 0 8px; font-size: 12px; }
      .body { padding: var(--uui-size-layout-1); display: flex; flex-direction: column; gap: var(--uui-size-space-4); max-width: 960px; }
      .intro, .note, .muted, .empty { color: var(--uui-color-text-alt); margin: 0; }
      .intro-row { display: flex; gap: var(--uui-size-space-4); align-items: flex-start; flex-wrap: wrap; }
      .intro-row .intro { flex: 1 1 400px; }
      .notice { display: flex; gap: var(--uui-size-space-3); align-items: center; padding: var(--uui-size-space-4) var(--uui-size-space-5); border: 1px solid var(--uui-color-border); border-radius: var(--uui-border-radius); background: var(--uui-color-surface-alt); }
      .area-head { display: flex; align-items: center; gap: var(--uui-size-space-4); }
      .area-text { flex: 1; min-width: 0; }
      .area-text h2, .kind-head h2 { margin: 0; font-size: var(--uui-type-default-size); }
      .area-text p { margin: 2px 0 0; color: var(--uui-color-text-alt); font-size: 13px; }
      .area.off h2 { color: var(--uui-color-text-alt); }
      .state { font-size: 13px; color: var(--uui-color-text-alt); }
      .area-body { border-top: 1px solid var(--uui-color-divider); margin-top: var(--uui-size-space-4); padding: var(--uui-size-space-2) 0 0 64px; }
      .row { display: flex; gap: var(--uui-size-space-4); padding: var(--uui-size-space-3) 0; align-items: flex-start; flex-wrap: wrap; }
      .row + .row { border-top: 1px solid var(--uui-color-divider); }
      .row-label { width: 110px; font-weight: 600; padding-top: 4px; }
      .row-value { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: var(--uui-size-space-3); }
      .switch { width: 48px; height: 28px; border-radius: 999px; border: 0; background: var(--uui-color-border-emphasis); position: relative; flex: none; padding: 0; cursor: pointer; }
      .switch span { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 999px; background: #fff; transition: left 120ms; }
      .switch.on { background: var(--uui-color-selected); }
      .switch.on span { left: 23px; }
      .switch:disabled { cursor: default; opacity: 0.6; }
      .kind { background: var(--uui-color-surface); border: 1px solid var(--uui-color-border); border-radius: var(--uui-border-radius); padding: var(--uui-size-space-5); display: flex; flex-direction: column; gap: var(--uui-size-space-4); }
      .kind.off { background: var(--uui-color-surface-alt); border-style: dashed; }
      .kind.off .levels { opacity: 0.45; }
      .kind-head { display: flex; align-items: center; gap: var(--uui-size-space-3); flex-wrap: wrap; }
      .pill { font-size: 13px; background: var(--uui-color-divider); border-radius: 999px; padding: 2px 12px; }
      .link { background: none; border: 0; padding: 0; color: var(--uui-color-interactive); text-decoration: underline; cursor: pointer; font: inherit; }
      .levels { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--uui-size-space-2); align-items: stretch; }
      .level { display: flex; gap: var(--uui-size-space-2); align-items: flex-start; border: 1px solid var(--uui-color-border); border-radius: var(--uui-border-radius); padding: var(--uui-size-space-3); min-height: 44px; box-sizing: border-box; cursor: pointer; }
      .level.chosen { border-color: var(--uui-color-selected); background: var(--uui-color-surface-emphasis); }
      .level-text { display: flex; flex-direction: column; gap: 2px; }
      .level-text span { color: var(--uui-color-text-alt); font-size: 12px; }
      .custom { align-self: center; font-weight: 600; }
      .follow, .stack { display: flex; gap: var(--uui-size-space-2); flex-wrap: wrap; }
      .stack { flex-direction: column; }
      details summary { cursor: pointer; color: var(--uui-color-interactive); min-height: 32px; display: flex; align-items: center; }
      .verbs { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--uui-size-space-2) var(--uui-size-space-5); padding: var(--uui-size-space-3) 0; }
      .verb { display: flex; gap: var(--uui-size-space-2); align-items: center; min-height: 32px; }
      .exception { display: flex; gap: var(--uui-size-space-4); align-items: center; padding: var(--uui-size-space-3) 0; flex-wrap: wrap; }
      .exception + .exception { border-top: 1px solid var(--uui-color-divider); }
      .exception-text { flex: 1 1 300px; }
      .adding fieldset { border: 0; padding: 0; margin: 0 0 var(--uui-size-space-4); }
      .adding legend, .step-label { font-size: 13px; color: var(--uui-color-text-alt); margin-bottom: var(--uui-size-space-2); display: block; }
      .step { margin-bottom: var(--uui-size-space-4); display: flex; flex-direction: column; gap: var(--uui-size-space-2); }
      .summary { background: var(--uui-color-surface-alt); border-radius: var(--uui-border-radius); padding: var(--uui-size-space-3) var(--uui-size-space-4); margin: 0 0 var(--uui-size-space-4); }
      .actions { display: flex; gap: var(--uui-size-space-3); justify-content: flex-end; }
      .transfer { display: flex; gap: var(--uui-size-space-3); align-items: flex-start; padding: var(--uui-size-space-3) 0; }
      .transfer > span { display: flex; flex-direction: column; gap: 2px; }
      .transfer + .transfer { border-top: 1px solid var(--uui-color-divider); }
      .transfer.under { padding-left: 32px; }
      .transfer.warning { border: 1px solid var(--uui-color-warning); background: var(--uui-color-warning-standalone, #fff6e5); border-radius: var(--uui-border-radius); padding: var(--uui-size-space-3); }
      .people { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--uui-size-space-4); align-items: start; }
    `,
  ]
}

customElements.define('crombolo-group-editor', CromboloGroupEditorElement)
