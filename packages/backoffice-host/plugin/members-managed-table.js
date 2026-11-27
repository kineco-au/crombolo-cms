/**
 * The Members list (story 445): Umbraco's table, with a mark beside each member a
 * directory outside the site keeps. Overwrites `Umb.CollectionView.Member.Table`;
 * registered by `members-managed.js`.
 */
import { UMB_COLLECTION_CONTEXT } from '@umbraco-cms/backoffice/collection'
import { css, html } from '@umbraco-cms/backoffice/external/lit'
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element'
import { UmbMemberTypeItemRepository } from '@umbraco-cms/backoffice/member-type'
import { isManaged, LIST_MARK } from './members-managed.js'

const ORDER_BY = {
  memberName: 'name',
  memberUsername: 'username',
  memberEmail: 'email',
  memberType: 'memberType',
}

export default class CromboloMemberTableElement extends UmbLitElement {
  static properties = {
    _items: { state: true },
    _orderingColumn: { state: true },
    _orderingDesc: { state: true },
  }

  #collection
  #memberTypes = new UmbMemberTypeItemRepository(this)

  constructor() {
    super()
    this._items = []
    this._orderingColumn = 'memberUsername'
    this._orderingDesc = false
    this.consumeContext(UMB_COLLECTION_CONTEXT, (collection) => {
      this.#collection = collection
      if (!collection) return
      this.observe(collection.items, (items) => this.#build(items ?? []), 'crombolo-members')
      this.observe(
        collection.filter,
        (filter) => {
          const column = Object.entries(ORDER_BY).find(([, by]) => by === filter?.orderBy)?.[0]
          if (!column) return
          this._orderingColumn = column
          this._orderingDesc = filter.orderDirection === 'Descending'
        },
        'crombolo-members-order',
      )
    })
  }

  get #columns() {
    const term = (key) => this.localize.term(key)
    return [
      { name: term('general_name'), alias: 'memberName', allowSorting: true },
      { name: term('general_username'), alias: 'memberUsername', allowSorting: true },
      { name: term('general_email'), alias: 'memberEmail', allowSorting: true },
      { name: term('content_membertype'), alias: 'memberType', allowSorting: true },
      { name: term('member_kind'), alias: 'memberKind' },
      { name: '', alias: 'entityActions', align: 'right' },
    ]
  }

  #kind(kind) {
    if (kind === 'Api') return this.localize.term('member_memberKindApi')
    if (kind === 'ExternalOnly') return this.localize.term('member_memberKindExternalOnly')
    return this.localize.term('member_memberKindDefault')
  }

  async #build(members) {
    const { data: types } = await this.#memberTypes.requestItems(
      members.map((member) => member.memberType.unique),
    )
    this._items = members.map((member) => {
      const name = member.variants?.[0]?.name ?? member.username
      const type = types?.find((t) => t.unique === member.memberType.unique)
      return {
        id: member.unique,
        icon: type?.icon || 'icon-user',
        data: [
          {
            columnAlias: 'memberName',
            value: html`<a href=${`section/member-management/workspace/member/edit/${member.unique}`}
                >${name}</a
              >${
                isManaged(member)
                  ? html`<uui-tag class="mark" look="secondary" data-mark="member-managed"
                      >${LIST_MARK}</uui-tag
                    >`
                  : ''
              }`,
          },
          { columnAlias: 'memberUsername', value: member.username },
          { columnAlias: 'memberEmail', value: member.email },
          { columnAlias: 'memberType', value: type?.name },
          { columnAlias: 'memberKind', value: this.#kind(member.kind) },
          {
            columnAlias: 'entityActions',
            value: html`<umb-entity-actions-table-column-view
              .value=${{ entityType: member.entityType, unique: member.unique, name }}
            ></umb-entity-actions-table-column-view>`,
          },
        ],
      }
    })
  }

  #ordered(event) {
    const table = event.target
    const by = table.orderingColumn ? ORDER_BY[table.orderingColumn] : undefined
    if (!by) return
    this._orderingColumn = table.orderingColumn
    this._orderingDesc = table.orderingDesc
    this.#collection?.setFilter({
      orderBy: by,
      orderDirection: table.orderingDesc ? 'Descending' : 'Ascending',
    })
  }

  render() {
    return html`<umb-table
      .config=${{ allowSelection: false }}
      .columns=${this.#columns}
      .items=${this._items}
      .orderingColumn=${this._orderingColumn}
      .orderingDesc=${this._orderingDesc}
      @ordered=${this.#ordered}
    ></umb-table>`
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
    }
    .mark {
      margin-left: var(--uui-size-space-3, 9px);
    }
  `
}

customElements.define('crombolo-member-table', CromboloMemberTableElement)
