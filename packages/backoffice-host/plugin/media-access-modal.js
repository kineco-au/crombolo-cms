/**
 * The Permissions dialog for a media folder or item (story 205): whether it
 * inherits the folder above's Public Access, or who may read and change it, by
 * group or individual member. Registered by `media-access.js`.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbModalBaseElement } from '@umbraco-cms/backoffice/modal'
import '@umbraco-cms/backoffice/member'
import {
  bytesOf,
  describeAccess,
  formFor,
  inheritedForm,
  megabytesOf,
  PUBLIC_NOTE,
  READ_MODES,
  readMediaAccess,
  requestFor,
  saveMediaAccess,
  usedByText,
  WRITE_MODES,
} from './media-access.js'

export default class CromboloMediaAccessModalElement extends UmbModalBaseElement {
  static properties = {
    _state: { state: true },
    _form: { state: true },
    _changed: { state: true },
    _busy: { state: true },
    _message: { state: true },
  }

  constructor() {
    super()
    this._state = undefined
    this._form = undefined
    this._changed = false
    this._busy = false
    this._message = ''
  }

  connectedCallback() {
    super.connectedCallback()
    this.#load()
  }

  async #load() {
    try {
      this.#show(await readMediaAccess(this.data?.unique))
    } catch (error) {
      this._message = error.message
    }
  }

  #show(state) {
    this._state = state
    this._form = formFor(state)
    this._changed = false
  }

  /** Any edit gives the item settings of its own, starting from those it inherited. */
  #change(patch) {
    this._form = { ...this._form, inherit: false, ...patch }
    this._changed = true
  }

  #setInherit(on) {
    if (on) {
      this._form = inheritedForm(this._state)
      this._changed = true
    } else this.#change({})
  }

  #setMode(action, mode) {
    this.#change({ [action]: mode, ...(action === 'read' ? { allMembers: false } : {}) })
  }

  #tick(name, action, on) {
    this.#change({
      groups: this._form.groups.map((g) => (g.name === name ? { ...g, [action]: on } : g)),
      ...(action === 'read' ? { allMembers: false } : {}),
    })
  }

  #setMembers(action, keys) {
    const selected = new Set(keys)
    const members = this._form.members.map((m) => ({ ...m, [action]: selected.has(m.key) }))
    for (const key of keys)
      if (!members.some((m) => m.key === key))
        members.push({ key, read: action === 'read', write: action === 'write' })
    this.#change({ members, ...(action === 'read' ? { allMembers: false } : {}) })
  }

  #tickType(id, on) {
    const types = this._form.memberTypes
    this.#change({ memberTypes: on ? [...types, id] : types.filter((t) => t !== id) })
  }

  async #save() {
    if (!this._changed) return this._submitModal()
    this._busy = true
    this._message = ''
    try {
      this.#show(await saveMediaAccess(this.data?.unique, requestFor(this._form, this._state.item)))
      this._submitModal()
    } catch (error) {
      this._message = error.message
    } finally {
      this._busy = false
    }
  }

  #toggle(label, modes, value, onPick) {
    const locked = this._form.inherit
    return html`<p class="label" id=${`${label}-label`}>${label}</p>
      <uui-button-group role="radiogroup" aria-labelledby=${`${label}-label`}>
        ${modes.map(
          (mode) => html`<uui-button
            role="radio"
            aria-checked=${value === mode.value ? 'true' : 'false'}
            label=${mode.label}
            look=${value === mode.value ? 'primary' : 'outline'}
            ?disabled=${locked}
            @click=${() => onPick(mode.value)}
            >${mode.label}</uui-button
          >`,
        )}
      </uui-button-group>`
  }

  #access(action) {
    const form = this._form
    const mode = form[action]
    const label = action === 'read' ? 'Read' : 'Write'
    const members = form.members.filter((m) => m[action]).map((m) => m.key)
    return html`<section class="access" aria-label=${label}>
      ${this.#toggle(label, action === 'read' ? READ_MODES : WRITE_MODES, mode, (v) => this.#setMode(action, v))}
      ${mode === 'public' ? html`<p class="fine">${PUBLIC_NOTE}</p>` : nothing}
      ${mode === 'private' ? html`<p class="fine">Only back-office users with the required permissions.</p>` : nothing}
      ${
        mode === 'custom'
          ? html`<div class="custom">
        ${action === 'read' && form.allMembers ? html`<p>All signed-in members currently have read access. Choose groups or members to replace that setting.</p>` : nothing}
        <h4>Member groups</h4>
        ${
          form.groups.length
            ? form.groups.map(
                (g) =>
                  html`<label><input type="checkbox" .checked=${g[action]} ?disabled=${form.inherit}
                    @change=${(e) => this.#tick(g.name, action, e.target.checked)} />${g.name}</label>`,
              )
            : html`<p>No member groups are available.</p>`
        }
        <h4>Members</h4>
        <umb-input-member .selection=${members} ?readonly=${form.inherit}
          @change=${(e) => this.#setMembers(action, e.target.selection ?? [])}></umb-input-member>
      </div>`
          : nothing
      }
    </section>`
  }

  #renderRule() {
    const form = this._form
    return html`<uui-box headline="Public Access">
        ${
          this._state.hasParent
            ? html`<label class="inherit"><input type="checkbox" .checked=${form.inherit}
                @change=${(e) => this.#setInherit(e.target.checked)} />Inherit parent permissions</label>`
            : nothing
        }
        ${this.#access('read')}${this.#access('write')}
        ${
          form.newRead === 'creator' || form.newWrite === 'creator'
            ? html`<p class="fine">Files members add here can only be seen or changed by the member who added them, as set before.</p>`
            : nothing
        }
      </uui-box>
      ${
        !this._state.hasFile
          ? html`<uui-box headline="Member uploads">
        ${form.inherit ? html`<p class="fine">Inherited from the folder above. Changing these gives this folder permissions of its own.</p>` : nothing}
        <h4>File types members may upload here</h4>
        ${(this._state.memberFileTypes ?? []).map(
          (type) => html`<label class="public"><input type="checkbox"
          .checked=${form.memberTypes.includes(type.id)}
          @change=${(e) => this.#tickType(type.id, e.target.checked)} />${type.label}</label>`,
        )}
        <label>Largest file, in MB<input type="number" min="0" step="0.5"
          .value=${megabytesOf(form.memberMaxBytes)}
          @change=${(e) => this.#change({ memberMaxBytes: bytesOf(e.target.value) })} /></label>
      </uui-box>`
          : nothing
      }`
  }

  render() {
    const headline = this._state ? `Permissions for ${this._state.name}` : 'Permissions'
    return html`<umb-body-layout headline=${headline}>
      ${
        this._state && this._form
          ? html`<p class="summary">${describeAccess(this._form, this._state)}</p>
              <p class="fine">Editors who can open this in Media can always see it.</p>
              ${
                this._state.usedBy?.length
                  ? html`<p class="warning">${usedByText(this._state.usedBy)}</p>`
                  : nothing
              }
              ${this.#renderRule()}`
          : this._message
            ? nothing
            : html`<uui-loader></uui-loader>`
      }
      ${this._message ? html`<p class="problem" role="alert">${this._message}</p>` : nothing}
      <uui-button slot="actions" label="Cancel" @click=${() => this._rejectModal()}
        >Cancel</uui-button
      >
      <uui-button
        slot="actions"
        look="primary"
        color="positive"
        label="Save"
        ?disabled=${this._busy || !this._form}
        @click=${() => this.#save()}
        >Save</uui-button
      >
    </umb-body-layout>`
  }

  static styles = css`
    uui-box {
      margin-bottom: var(--uui-size-space-5, 18px);
    }
    table {
      border-collapse: collapse;
      margin: var(--uui-size-space-3, 9px) 0;
    }
    th,
    td {
      padding: var(--uui-size-space-2, 6px) var(--uui-size-space-4, 12px);
      text-align: left;
    }
    .types {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
      gap: var(--uui-size-space-2, 6px);
      margin-bottom: var(--uui-size-space-4, 12px);
    }
    .size input {
      margin-left: var(--uui-size-space-3, 9px);
      width: 8rem;
    }
    .inherit,
    .custom label,
    .public {
      display: block;
      margin: var(--uui-size-space-2, 6px) 0;
    }
    .inherit {
      font-weight: bold;
      margin-bottom: var(--uui-size-space-4, 12px);
    }
    uui-button-group {
      margin: var(--uui-size-space-2, 6px) 0;
    }
    .access + .access {
      margin-top: var(--uui-size-space-5, 18px);
      border-top: 1px solid var(--uui-color-border, #ddd);
      padding-top: var(--uui-size-space-3, 9px);
    }
    .label {
      font-weight: bold;
      margin-bottom: 0;
    }
    .fine {
      color: var(--uui-color-text-alt, #555);
    }
    .warning {
      color: var(--uui-color-warning-standalone, #8a5a00);
    }
    .problem {
      color: var(--uui-color-danger, #b00);
    }
  `
}

customElements.define('crombolo-media-access-modal', CromboloMediaAccessModalElement)
