import { umbBlockAliasProblem } from './block-alias.function.js';
import { UMB_BLOCK_WORKSPACE_CONTEXT } from './index.js';
import { css, customElement, html, nothing, state } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';

@customElement('umb-block-workspace-editor')
export class UmbBlockWorkspaceEditorElement extends UmbLitElement {
	#context?: typeof UMB_BLOCK_WORKSPACE_CONTEXT.TYPE;

	constructor() {
		super();
		this.consumeContext(UMB_BLOCK_WORKSPACE_CONTEXT, (context) => {
			this.#context = context;
			this.observe(
				context?.layout,
				(layout) => {
					const alias = (layout as { alias?: unknown } | undefined)?.alias;
					this._alias = typeof alias === 'string' ? alias : '';
				},
				'observeBlockAlias',
			);
			this.observe(
				context?.name,
				(name) => {
					if (name) {
						this._headline = this.localize.string(name);
					}
				},
				'observeOwnerContentElementTypeName',
			);
			this.observe(
				context?.readOnlyGuard.isPermittedForObservableVariant(context.variantId),
				(isReadOnly) => {
					this._readOnly = isReadOnly;
				},
				'observeIsReadOnly',
			);
		});
	}

	@state()
	private _headline: string = '';

	@state()
	private _readOnly?: boolean;

	@state()
	private _alias = '';

	@state()
	private _aliasProblem?: string;

	// Crombolo (story 253): a block's alias, kept on its layout entry; an empty one is none.
	#onAlias(event: Event) {
		const alias = (event.target as HTMLInputElement).value.trim();
		this._alias = alias;
		this._aliasProblem = umbBlockAliasProblem(alias, this.#context?.getOtherBlockAliases() ?? []);
		if (this._aliasProblem) return;
		this.#context?.setPropertyValue('alias', alias === '' ? undefined : alias);
	}

	override render() {
		return html`<umb-workspace-editor
			><div slot="header">
				<h3 id="headline" title="${this._headline}" data-mark="layout-headline">${this._headline}</h3>
				${this._readOnly
					? html`<uui-tag look="secondary">${this.localize.term('general_readOnly')}</uui-tag>`
					: nothing}
				<uui-input
					id="alias"
					label="Alias"
					placeholder="Alias"
					title="A name to pick this block out by"
					.value=${this._alias}
					?readonly=${this._readOnly}
					@change=${this.#onAlias}></uui-input>
				${this._aliasProblem ? html`<span id="alias-problem">${this._aliasProblem}</span>` : nothing}
			</div></umb-workspace-editor
		>`;
	}

	static override readonly styles = [
		css`
			:host {
				display: block;
				width: 100%;
				height: 100%;
			}
			div {
				display: flex;
				align-items: center;
				gap: var(--uui-size-3);
			}
			#alias {
				margin-left: auto;
				width: 14em;
			}
			#alias-problem {
				color: var(--uui-color-danger);
				font-size: var(--uui-type-small-size);
			}
			#headline {
				display: block;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
				min-width: 0;
			}
		`,
	];
}

export default UmbBlockWorkspaceEditorElement;

declare global {
	interface HTMLElementTagNameMap {
		'umb-block-workspace-editor': UmbBlockWorkspaceEditorElement;
	}
}
