import { UMB_WEBHOOK_ROOT_WORKSPACE_PATH } from '../../constants.js';
import { UMB_WEBHOOK_WORKSPACE_CONTEXT } from './webhook-workspace.context-token.js';
import { html, customElement, state, css } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UmbTextStyles } from '@umbraco-cms/backoffice/style';

@customElement('umb-webhook-workspace-editor')
export class UmbWebhookWorkspaceEditorElement extends UmbLitElement {
	#workspaceContext?: typeof UMB_WEBHOOK_WORKSPACE_CONTEXT.TYPE;

	@state()
	private _name = '';

	constructor() {
		super();

		this.consumeContext(UMB_WEBHOOK_WORKSPACE_CONTEXT, (context) => {
			this.#workspaceContext = context;
			this.observe(this.#workspaceContext?.name, (name) => (this._name = name ?? ''));
		});
	}

	// Crombolo: the name and description are fields in the Details view, so the header
	// shows the name only, as a heading.
	override render() {
		return html`
			<umb-entity-detail-workspace-editor back-path=${UMB_WEBHOOK_ROOT_WORKSPACE_PATH}>
				<h3 id="header" slot="header">${this._name || this.localize.term('webhooks_addWebhook')}</h3>
			</umb-entity-detail-workspace-editor>
		`;
	}

	static override styles = [
		UmbTextStyles,
		css`
			#header {
				margin: 0;
				font-size: var(--uui-type-h5-size);
			}
		`,
	];
}

export default UmbWebhookWorkspaceEditorElement;

declare global {
	interface HTMLElementTagNameMap {
		'umb-webhook-workspace-editor': UmbWebhookWorkspaceEditorElement;
	}
}
