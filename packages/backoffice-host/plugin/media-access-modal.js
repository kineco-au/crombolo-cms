/**
 * The Permissions dialog for a media folder or item (story 196): who may see
 * and change it, by member group, and for a folder what files added to it
 * later get. Registered by `media-access.js`.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { UmbModalBaseElement } from '@umbraco-cms/backoffice/modal'
import {
  bytesOf,
  FILE_READ_CHOICES,
  FILE_WRITE_CHOICES,
  groupRows,
  megabytesOf,
  NEW_READ_CHOICES,
  NEW_WRITE_CHOICES,
  PUBLIC_WARNING,
  readMediaAccess,
  requestFor,
  saveMediaAccess,
  summarise,
  usedByText,
} from './media-access.js'

export default class CromboloMediaAccessModalElement extends UmbModalBaseElement {
  static properties = {
    _state: { state: true },
    _form: { state: true },
    _busy: { state: true },
    _message: { state: true },
  }

  constructor() {
    super()
    this._state = undefined
    this._form = undefined
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
    this._form = {
      hasFile: state.hasFile,
      own: state.own
        ? { ...state.own, groups: groupRows(state.own, state.memberGroups) }
        : undefined,
      item: { readPolicy: state.item.readPolicy, writePolicy: state.item.writePolicy },
    }
  }

  #setOwn() {
    const from = this._state.inherited
    this._form = {
      ...this._form,
      own: {
        publicRead: from?.publicRead ?? false,
        groups: groupRows(from, this._state.memberGroups),
        newRead: from?.newRead ?? null,
        newWrite: from?.newWrite ?? null,
        memberTypes: [...(from?.memberTypes ?? [])],
        memberMaxBytes: from?.memberMaxBytes ?? null,
      },
    }
  }

  #tickType(id, on) {
    const types = this._form.own.memberTypes ?? []
    this.#change({ memberTypes: on ? [...types, id] : types.filter((t) => t !== id) })
  }

  #change(patch) {
    this._form = { ...this._form, own: { ...this._form.own, ...patch } }
  }

  #tick(name, which, on) {
    this.#change({
      groups: this._form.own.groups.map((g) => (g.name === name ? { ...g, [which]: on } : g)),
    })
  }

  async #save() {
    this._busy = true
    this._message = ''
    try {
      this.#show(await saveMediaAccess(this.data?.unique, requestFor(this._form)))
      this._submitModal()
    } catch (error) {
      this._message = error.message
    } finally {
      this._busy = false
    }
  }

  #choices(label, choices, value, onPick) {
    return html`<div class="choices" role="radiogroup" aria-label=${label}>
      <p class="label">${label}</p>
      ${choices.map(
        (choice) => html`<label>
          <input
            type="radio"
            .checked=${value === choice.value}
            @change=${() => onPick(choice.value)}
          />
          ${choice.label}
        </label>`,
      )}
      ${value === 'public' ? html`<p class="warning">${PUBLIC_WARNING}</p>` : nothing}
    </div>`
  }

  #renderRule() {
    const own = this._form.own
    if (!own) {
      const from = this._state.inherited
      return html`<uui-box headline="Who can see and change it">
        <p>
          ${
            from
              ? html`Follows the permissions set on <strong>${from.from.name}</strong>.`
              : 'Nothing above it sets permissions, so anyone with the link can see it.'
          }
        </p>
        <uui-button look="secondary" label="Set its own" @click=${() => this.#setOwn()}
          >Set its own</uui-button
        >
      </uui-box>`
    }
    return html`<uui-box headline="Who can see and change it">
      <label class="public">
        <input
          type="checkbox"
          .checked=${own.publicRead}
          @change=${(e) => this.#change({ publicRead: e.target.checked })}
        />
        Anyone with the link can see it
      </label>
      ${own.publicRead ? html`<p class="warning">${PUBLIC_WARNING}</p>` : nothing}
      ${
        own.groups.length === 0
          ? html`<p class="fine">This site has no member groups yet.</p>`
          : html`<table>
              <thead>
                <tr><th>Member group</th><th>Can see</th><th>Can change</th></tr>
              </thead>
              <tbody>
                ${own.groups.map(
                  (g) => html`<tr>
                    <td>${g.name}</td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label=${`${g.name} can see`}
                        .checked=${g.read}
                        @change=${(e) => this.#tick(g.name, 'read', e.target.checked)}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label=${`${g.name} can change`}
                        .checked=${g.write}
                        @change=${(e) => this.#tick(g.name, 'write', e.target.checked)}
                      />
                    </td>
                  </tr>`,
                )}
              </tbody>
            </table>`
      }
      ${
        this._state.inherited
          ? html`<uui-button
              look="secondary"
              label="Follow the folder above instead"
              @click=${() => {
                this._form = { ...this._form, own: undefined }
              }}
              >Follow the folder above instead</uui-button
            >`
          : nothing
      }
    </uui-box>
    ${
      this._form.hasFile
        ? nothing
        : html`<uui-box headline="Files added here later">
            ${this.#choices('Who can see them', NEW_READ_CHOICES, own.newRead, (v) =>
              this.#change({ newRead: v }),
            )}
            ${this.#choices('Who can change them', NEW_WRITE_CHOICES, own.newWrite, (v) =>
              this.#change({ newWrite: v }),
            )}
            <p class="fine">Files already here keep what they have.</p>
          </uui-box>
          <uui-box headline="File types members may upload here">
            <p class="fine">
              Members can add files only through a feature of this site that offers it. Nothing
              is accepted unless it is ticked here.
            </p>
            <div class="types">
              ${this._state.memberFileTypes.map(
                (type) => html`<label>
                  <input
                    type="checkbox"
                    .checked=${(own.memberTypes ?? []).includes(type.id)}
                    @change=${(e) => this.#tickType(type.id, e.target.checked)}
                  />
                  ${type.label}
                </label>`,
              )}
            </div>
            <label class="size">
              Largest file, in MB
              <input
                type="number"
                min="0"
                step="0.5"
                placeholder="No limit of its own"
                .value=${megabytesOf(own.memberMaxBytes)}
                @change=${(e) => this.#change({ memberMaxBytes: bytesOf(e.target.value) })}
              />
            </label>
          </uui-box>`
    }`
  }

  #renderFile() {
    if (!this._form.hasFile) return nothing
    const item = this._form.item
    const setItem = (patch) => {
      this._form = { ...this._form, item: { ...item, ...patch } }
    }
    const creator = this._state.item.creator
    return html`<uui-box headline="This file">
      ${
        creator
          ? html`<p>Added by ${creator.name ?? 'a member who is no longer here'}.</p>`
          : nothing
      }
      ${this.#choices('Who can see it', FILE_READ_CHOICES, item.readPolicy, (v) =>
        setItem({ readPolicy: v }),
      )}
      ${this.#choices('Who can change it', FILE_WRITE_CHOICES, item.writePolicy, (v) =>
        setItem({ writePolicy: v }),
      )}
    </uui-box>`
  }

  render() {
    const headline = this._state ? `Permissions for ${this._state.name}` : 'Permissions'
    return html`<umb-body-layout headline=${headline}>
      ${
        this._state && this._form
          ? html`<p class="summary">${summarise(this._state)}</p>
              <p class="fine">Editors who can open this in Media can always see it.</p>
              ${
                this._state.usedBy?.length
                  ? html`<p class="warning">${usedByText(this._state.usedBy)}</p>`
                  : nothing
              }
              ${this.#renderRule()} ${this.#renderFile()}`
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
    .choices label,
    .public {
      display: block;
      margin: var(--uui-size-space-2, 6px) 0;
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
