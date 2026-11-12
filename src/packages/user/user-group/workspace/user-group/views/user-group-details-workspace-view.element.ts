import type { UmbUserGroupDetailModel } from '../../../types.js';
import { UMB_USER_GROUP_WORKSPACE_CONTEXT } from '../user-group-workspace.context-token.js';
import { css, customElement, html, nothing, state, when } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UmbTextStyles } from '@umbraco-cms/backoffice/style';
import type { UmbChangeEvent } from '@umbraco-cms/backoffice/event';
import type { UmbInputLanguageElement } from '@umbraco-cms/backoffice/language';
import type { UmbInputSectionElement } from '@umbraco-cms/backoffice/section';
import type { UmbWorkspaceViewElement } from '@umbraco-cms/backoffice/workspace';
import type { UUIBooleanInputEvent } from '@umbraco-cms/backoffice/external/uui';

import '../components/user-group-entity-type-permission-groups.element.js';
import '../components/user-group-workspace-users.element.js';
import '../../../components/input-user-group/user-group-input.element.js';

@customElement('umb-user-group-details-workspace-view')
export class UmbUserGroupDetailsWorkspaceViewElement extends UmbLitElement implements UmbWorkspaceViewElement {
	@state()
	private _unique?: UmbUserGroupDetailModel['unique'];

	@state()
	private _sections: UmbUserGroupDetailModel['sections'] = [];

	@state()
	private _languages: UmbUserGroupDetailModel['languages'] = [];

	@state()
	private _hasAccessToAllLanguages: UmbUserGroupDetailModel['hasAccessToAllLanguages'] = false;

	@state()
	private _documentStartNode?: UmbUserGroupDetailModel['documentStartNode'];

	@state()
	private _documentRootAccess: UmbUserGroupDetailModel['documentRootAccess'] = false;

	@state()
	private _elementStartNode?: UmbUserGroupDetailModel['elementStartNode'];

	@state()
	private _elementRootAccess: UmbUserGroupDetailModel['elementRootAccess'] = false;

	@state()
	private _mediaStartNode?: UmbUserGroupDetailModel['mediaStartNode'];

	@state()
	private _mediaRootAccess: UmbUserGroupDetailModel['mediaRootAccess'] = false;

	@state()
	private _owners: UmbUserGroupDetailModel['owners'] = [];

	@state()
	private _canManageMembers = false;

	@state()
	private _readOnly = true;

	@state()
	private _unownable = false;

	#alias = '';
	#fallbackPermissions: Array<string> = [];

	#checkOwnable() {
		this._unownable =
			this.#alias.toLowerCase() === 'admin' ||
			this.#fallbackPermissions.some((verb) => verb.startsWith('Crombolo.Remote.'));
	}

	#workspaceContext?: typeof UMB_USER_GROUP_WORKSPACE_CONTEXT.TYPE;

	constructor() {
		super();

		this.consumeContext(UMB_USER_GROUP_WORKSPACE_CONTEXT, (instance) => {
			this.#workspaceContext = instance;
			this.#observeUserGroup();
		});
	}

	#observeUserGroup() {
		this.observe(this.#workspaceContext?.unique, (value) => (this._unique = value ?? undefined), '_observeUnique');
		this.observe(this.#workspaceContext?.sections, (value) => (this._sections = value ?? []), '_observeSections');
		this.observe(this.#workspaceContext?.languages, (value) => (this._languages = value ?? []), '_observeLanguages');
		this.observe(
			this.#workspaceContext?.hasAccessToAllLanguages,
			(value) => (this._hasAccessToAllLanguages = value ?? false),
			'_observeHasAccessToAllLanguages',
		);

		this.observe(
			this.#workspaceContext?.documentRootAccess,
			(value) => (this._documentRootAccess = value ?? false),
			'_observeDocumentRootAccess',
		);

		this.observe(
			this.#workspaceContext?.documentStartNode,
			(value) => (this._documentStartNode = value),
			'_observeDocumentStartNode',
		);

		this.observe(
			this.#workspaceContext?.elementRootAccess,
			(value) => (this._elementRootAccess = value ?? false),
			'_observeElementRootAccess',
		);

		this.observe(
			this.#workspaceContext?.elementStartNode,
			(value) => (this._elementStartNode = value),
			'_observeElementStartNode',
		);

		this.observe(
			this.#workspaceContext?.mediaRootAccess,
			(value) => (this._mediaRootAccess = value ?? false),
			'_observeMediaRootAccess',
		);

		this.observe(
			this.#workspaceContext?.mediaStartNode,
			(value) => (this._mediaStartNode = value),
			'_observeMediaStartNode',
		);

		this.observe(this.#workspaceContext?.owners, (value) => (this._owners = value ?? []), '_observeOwners');
		this.observe(
			this.#workspaceContext?.canManageMembers,
			(value) => (this._canManageMembers = value ?? false),
			'_observeCanManageMembers',
		);
		this.observe(this.#workspaceContext?.readOnly, (value) => (this._readOnly = value ?? true), '_observeReadOnly');
		this.observe(
			this.#workspaceContext?.alias,
			(value) => {
				this.#alias = value ?? '';
				this.#checkOwnable();
			},
			'_observeAliasForOwners',
		);
		this.observe(
			this.#workspaceContext?.fallbackPermissions,
			(value) => {
				this.#fallbackPermissions = value ?? [];
				this.#checkOwnable();
			},
			'_observeFallbackPermissionsForOwners',
		);
	}

	#onOwnersChange(event: UmbChangeEvent) {
		event.stopPropagation();
		const target = event.target as HTMLElement & { selection: Array<string> };
		this.#workspaceContext?.updateProperty(
			'owners',
			target.selection.map((unique) => ({ unique })),
		);
	}

	#onSectionsChange(event: UmbChangeEvent) {
		event.stopPropagation();
		const target = event.target as UmbInputSectionElement;
		// TODO make contexts method
		this.#workspaceContext?.updateProperty('sections', target.selection);
	}

	#onAllowAllLanguagesChange(event: UUIBooleanInputEvent) {
		event.stopPropagation();
		const target = event.target;
		// TODO make contexts method
		this.#workspaceContext?.updateProperty('hasAccessToAllLanguages', target.checked);
	}

	#onLanguagePermissionChange(event: UmbChangeEvent) {
		event.stopPropagation();
		const target = event.target as UmbInputLanguageElement;
		// TODO make contexts method
		this.#workspaceContext?.updateProperty('languages', target.selection);
	}

	#onAllowAllDocumentsChange(event: UUIBooleanInputEvent) {
		event.stopPropagation();
		const target = event.target;
		// TODO make contexts method
		this.#workspaceContext?.updateProperty('documentRootAccess', target.checked);
		this.#workspaceContext?.updateProperty('documentStartNode', null);
	}

	#onDocumentStartNodeChange(event: CustomEvent) {
		event.stopPropagation();
		// TODO: get back to this when documents have been decoupled from users.
		// The event target is deliberately set to any to avoid an import cycle with documents.
		const target = event.target as any;
		const selected = target.selection?.[0];
		// TODO make contexts method
		this.#workspaceContext?.updateProperty('documentStartNode', selected ? { unique: selected } : null);
	}

	#onAllowAllElementsChange(event: UUIBooleanInputEvent) {
		event.stopPropagation();
		const target = event.target;
		// TODO make contexts method
		this.#workspaceContext?.updateProperty('elementRootAccess', target.checked);
		this.#workspaceContext?.updateProperty('elementStartNode', null);
	}

	#onElementStartNodeChange(event: CustomEvent & { target: { selection: Array<string> } }) {
		event.stopPropagation();
		// TODO: get back to this when elements have been decoupled from users.
		const target = event.target;
		const selected = target.selection?.[0];
		// TODO make contexts method
		this.#workspaceContext?.updateProperty('elementStartNode', selected ? { unique: selected } : null);
	}

	#onAllowAllMediaChange(event: UUIBooleanInputEvent) {
		event.stopPropagation();
		const target = event.target;
		// TODO make contexts method
		this.#workspaceContext?.updateProperty('mediaRootAccess', target.checked);
		this.#workspaceContext?.updateProperty('mediaStartNode', null);
	}

	#onMediaStartNodeChange(event: CustomEvent) {
		event.stopPropagation();
		// TODO: get back to this when media have been decoupled from users.
		// The event target is deliberately set to any to avoid an import cycle with media.
		const target = event.target as any;
		const selected = target.selection?.[0];
		// TODO make contexts method
		this.#workspaceContext?.updateProperty('mediaStartNode', selected ? { unique: selected } : null);
	}

	override render() {
		if (!this._unique) return nothing;

		return html`
			<div id="main">
				<umb-stack>
					${this.#renderReadOnlyNotice()}
					<uui-box>
						<div slot="headline"><umb-localize key="user_assignAccess"></umb-localize></div>

						<umb-property-layout
							label=${this.localize.term('main_sections')}
							description=${this.localize.term('user_sectionsHelp')}>
							<umb-input-section
								slot="editor"
								?readonly=${this._readOnly}
								.selection=${this._sections}
								@change=${this.#onSectionsChange}></umb-input-section>
						</umb-property-layout>

						${this.#renderLanguageAccess()} ${this.#renderDocumentAccess()} ${this.#renderMediaAccess()}
						${this.#renderElementAccess()}
					</uui-box>

					${this.#renderPermissionGroups()}
				</umb-stack>
				<umb-stack>
					${this.#renderOwners()}
					<umb-user-group-workspace-users ?readonly=${!this._canManageMembers}></umb-user-group-workspace-users>
				</umb-stack>
			</div>
		`;
	}

	// Crombolo (story 302): what a group grants is an administrator's; its owners choose who is in it.
	#renderReadOnlyNotice() {
		if (!this._readOnly) return nothing;
		return html`<div id="read-only" role="status">
			<umb-icon name="icon-lock"></umb-icon>
			<span>
				${this._canManageMembers
					? "Only an administrator can change what this group allows. You can choose who's in it."
					: 'Only an administrator can change this group.'}
			</span>
		</div>`;
	}

	#renderOwners() {
		if (this._readOnly && this._owners.length === 0) return nothing;
		if (this._unownable && this._owners.length === 0)
			return html`<uui-box headline="Owners">
				<p id="owners-help">
					${this.#alias.toLowerCase() === 'admin'
						? 'The administrators group never has owners: only an administrator can make someone an administrator.'
						: "This group can't have owners, because it can move sites or install code. Only an administrator can add people to it."}
				</p>
			</uui-box>`;
		return html`<uui-box headline="Owners">
			<p id="owners-help">Owners can manage group members</p>
			<umb-user-group-input
				?readonly=${this._readOnly}
				.selection=${this._owners.map((owner) => owner.unique)}
				@change=${this.#onOwnersChange}></umb-user-group-input>
		</uui-box>`;
	}

	#renderLanguageAccess() {
		return html`
			<umb-property-layout
				label=${this.localize.term('treeHeaders_languages')}
				description=${this.localize.term('user_languagesHelp')}>
				<div slot="editor">
					<uui-toggle
						style="margin-bottom: var(--uui-size-space-3);"
						label=${this.localize.term('user_allowAccessToAllLanguages')}
						?readonly=${this._readOnly}
						.checked=${this._hasAccessToAllLanguages}
						@change=${this.#onAllowAllLanguagesChange}></uui-toggle>

					${when(
						this._hasAccessToAllLanguages === false,
						() => html`
							<umb-input-language
								?readonly=${this._readOnly}
								.selection=${this._languages}
								@change=${this.#onLanguagePermissionChange}></umb-input-language>
						`,
					)}
				</div>
			</umb-property-layout>
		`;
	}

	#renderDocumentAccess() {
		return html`
			<umb-property-layout
				label=${this.localize.term('defaultdialogs_selectContentStartNode')}
				description=${this.localize.term('user_startnodehelp')}>
				<div slot="editor">
					<uui-toggle
						style="margin-bottom: var(--uui-size-space-3);"
						label=${this.localize.term('user_allowAccessToAllDocuments')}
						?readonly=${this._readOnly}
						.checked=${this._documentRootAccess}
						@change=${this.#onAllowAllDocumentsChange}></uui-toggle>
				</div>
				${when(
					this._documentRootAccess === false,
					() => html`
						<umb-input-document
							slot="editor"
							?readonly=${this._readOnly}
							max="1"
							.selection=${this._documentStartNode?.unique ? [this._documentStartNode.unique] : []}
							@change=${this.#onDocumentStartNodeChange}>
						</umb-input-document>
					`,
				)}
			</umb-property-layout>
		`;
	}

	#renderElementAccess() {
		return html`
			<umb-property-layout
				label=${this.localize.term('user_selectElementStartNode')}
				description=${this.localize.term('user_selectElementStartNodeDescription')}>
				<div slot="editor">
					<uui-toggle
						style="margin-bottom: var(--uui-size-space-3);"
						label=${this.localize.term('user_allowAccessToAllElements')}
						?readonly=${this._readOnly}
						.checked=${this._elementRootAccess}
						@change=${this.#onAllowAllElementsChange}></uui-toggle>
				</div>
				${when(
					this._elementRootAccess === false,
					() => html`
						<umb-input-element
							slot="editor"
							?readonly=${this._readOnly}
							max="1"
							.selection=${this._elementStartNode?.unique ? [this._elementStartNode.unique] : []}
							?folderOnly=${true}
							@change=${this.#onElementStartNodeChange}>
						</umb-input-element>
					`,
				)}
			</umb-property-layout>
		`;
	}

	#renderMediaAccess() {
		return html`
			<umb-property-layout
				label=${this.localize.term('defaultdialogs_selectMediaStartNode')}
				description=${this.localize.term('user_mediastartnodehelp')}>
				<div slot="editor">
					<uui-toggle
						style="margin-bottom: var(--uui-size-space-3);"
						label=${this.localize.term('user_allowAccessToAllMedia')}
						?readonly=${this._readOnly}
						.checked=${this._mediaRootAccess}
						@change=${this.#onAllowAllMediaChange}></uui-toggle>
				</div>
				${when(
					this._mediaRootAccess === false,
					() => html`
						<umb-input-media
							slot="editor"
							?readonly=${this._readOnly}
							max="1"
							folder-filter="foldersOnly"
							.selection=${this._mediaStartNode?.unique ? [this._mediaStartNode.unique] : []}
							@change=${this.#onMediaStartNodeChange}>
						</umb-input-media>
					`,
				)}
			</umb-property-layout>
		`;
	}

	#renderPermissionGroups() {
		// Crombolo: the permission editors have no read-only state of their own, so they are shown but not usable
		return html`<umb-user-group-entity-type-permission-groups
			?inert=${this._readOnly}
			class=${this._readOnly ? 'read-only' : ''}></umb-user-group-entity-type-permission-groups>`;
	}

	static override styles = [
		UmbTextStyles,
		css`
			:host {
				display: block;
				height: 100%;
			}

			#main {
				display: grid;
				grid-template-columns: 1fr 350px;
				gap: var(--uui-size-layout-1);
				padding: var(--uui-size-layout-1);
			}

			uui-input {
				width: 100%;
			}

			#read-only {
				display: flex;
				gap: var(--uui-size-space-3);
				align-items: center;
				padding: var(--uui-size-space-4) var(--uui-size-space-5);
				border: 1px solid var(--uui-color-border);
				border-radius: var(--uui-border-radius);
				background: var(--uui-color-surface-alt);
			}

			#owners-help {
				margin: 0 0 var(--uui-size-space-4);
				color: var(--uui-color-text-alt);
			}

			.read-only {
				opacity: 0.85;
			}
		`,
	];
}

export { UmbUserGroupDetailsWorkspaceViewElement as element };

declare global {
	interface HTMLElementTagNameMap {
		'umb-user-group-details-workspace-view': UmbUserGroupDetailsWorkspaceViewElement;
	}
}
