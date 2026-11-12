import { UMB_USER_WORKSPACE_CONTEXT } from '../../user-workspace.context-token.js';
import type { UmbUserDetailModel } from '../../../../types.js';
import { css, customElement, html, state } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UmbTextStyles } from '@umbraco-cms/backoffice/style';
import type { UmbReferenceByUnique } from '@umbraco-cms/backoffice/models';
import { UmbUserGroupCollectionRepository, type UmbUserGroupInputElement } from '@umbraco-cms/backoffice/user-group';
import { UMB_CURRENT_USER_CONTEXT } from '@umbraco-cms/backoffice/current-user';

@customElement('umb-user-workspace-assign-access')
export class UmbUserWorkspaceAssignAccessElement extends UmbLitElement {
	@state()
	private _userGroupUniques: UmbUserDetailModel['userGroupUniques'] = [];

	@state()
	private _documentStartNodeUniques: UmbUserDetailModel['documentStartNodeUniques'] = [];

	@state()
	private _documentRootAccess: UmbUserDetailModel['hasDocumentRootAccess'] = false;

	@state()
	private _elementStartNodeUniques: UmbUserDetailModel['elementStartNodeUniques'] = [];

	@state()
	private _elementRootAccess: UmbUserDetailModel['hasElementRootAccess'] = false;

	@state()
	private _mediaStartNodeUniques: UmbUserDetailModel['mediaStartNodeUniques'] = [];

	@state()
	private _mediaRootAccess: UmbUserDetailModel['hasMediaRootAccess'] = false;

	// Crombolo (story 302): anyone but an administrator may add or take away only the groups they own
	@state()
	private _ownedGroupUniques?: Array<string>;

	#workspaceContext?: typeof UMB_USER_WORKSPACE_CONTEXT.TYPE;

	constructor() {
		super();

		this.consumeContext(UMB_CURRENT_USER_CONTEXT, (currentUser) => {
			this.observe(
				currentUser?.isAdmin,
				async (isAdmin) => {
					if (isAdmin !== false) {
						this._ownedGroupUniques = undefined;
						return;
					}
					const { data } = await new UmbUserGroupCollectionRepository(this).requestCollection({ skip: 0, take: 1000 });
					this._ownedGroupUniques = data?.items.map((group) => group.unique) ?? [];
				},
				'_observeIsAdmin',
			);
		});

		this.consumeContext(UMB_USER_WORKSPACE_CONTEXT, (instance) => {
			this.#workspaceContext = instance;

			this.observe(
				this.#workspaceContext?.userGroupUniques,
				(value) => (this._userGroupUniques = value ?? []),
				'_observeUserGroupAccess',
			);

			this.observe(
				this.#workspaceContext?.hasDocumentRootAccess,
				(value) => (this._documentRootAccess = value ?? false),
				'_observeDocumentRootAccess',
			);

			this.observe(
				this.#workspaceContext?.documentStartNodeUniques,
				(value) => (this._documentStartNodeUniques = value ?? []),
				'_observeDocumentStartNode',
			);

			this.observe(
				this.#workspaceContext?.hasElementRootAccess,
				(value) => (this._elementRootAccess = value ?? false),
				'_observeElementRootAccess',
			);

			this.observe(
				this.#workspaceContext?.elementStartNodeUniques,
				(value) => (this._elementStartNodeUniques = value ?? []),
				'_observeElementStartNode',
			);

			this.observe(
				this.#workspaceContext?.hasMediaRootAccess,
				(value) => (this._mediaRootAccess = value ?? false),
				'_observeMediaRootAccess',
			);

			this.observe(
				this.#workspaceContext?.mediaStartNodeUniques,
				(value) => (this._mediaStartNodeUniques = value ?? []),
				'_observeMediaStartNode',
			);
		});
	}

	#onUserGroupsChange(event: CustomEvent) {
		event.stopPropagation();
		const target = event.target as UmbUserGroupInputElement;
		const selection: Array<UmbReferenceByUnique> = target.selection.map((unique) => {
			return { unique };
		});
		// TODO make contexts method
		this.#workspaceContext?.updateProperty('userGroupUniques', selection);
	}

	override render() {
		return html`
			<uui-box>
				<div slot="headline"><umb-localize key="user_assignAccess">Assign Access</umb-localize></div>
				<div id="assign-access">
					<!-- Crombolo (story 339): where a user works is their groups'; the Access box shows it -->
					${this.#renderGroupAccess()}
				</div>
			</uui-box>
		`;
	}

	#renderGroupAccess() {
		return html`
			<umb-property-layout
				label=${this.localize.term('general_groups')}
				description=${this.localize.term('user_groupsHelp')}>
				<div slot="editor">
					<umb-user-group-input
						.removable=${this._ownedGroupUniques}
						.selection=${this._userGroupUniques.map((reference) => reference.unique)}
						@change=${this.#onUserGroupsChange}></umb-user-group-input>
					${this._ownedGroupUniques
						? html`<p class="owned-help">You can add people to the groups you own, or take them out of them.</p>`
						: ''}
				</div>
			</umb-property-layout>
		`;
	}

	static override styles = [
		UmbTextStyles,
		css`
			:host {
				display: block;
			}

			.owned-help {
				margin: var(--uui-size-space-3) 0 0;
				color: var(--uui-color-text-alt);
			}
		`,
	];
}

declare global {
	interface HTMLElementTagNameMap {
		'umb-user-workspace-assign-access': UmbUserWorkspaceAssignAccessElement;
	}
}
