import { css, html, customElement } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';

@customElement('umb-backoffice-header')
export class UmbBackofficeHeaderElement extends UmbLitElement {
	override render() {
		return html`
			<div id="appHeader">
				<umb-backoffice-header-logo></umb-backoffice-header-logo>
				<umb-backoffice-header-sections></umb-backoffice-header-sections>
				<umb-backoffice-header-apps></umb-backoffice-header-apps>
			</div>
			<!-- Crombolo: the menu under Content (story 289), a row of its own under the header. -->
			<crombolo-content-strip></crombolo-content-strip>
		`;
	}

	static override readonly styles = [
		css`
			:host {
				width: 100%;
			}

			#appHeader {
				--uui-focus-outline-color: var(--uui-color-header-contrast-emphasis);
				/* Crombolo: buttons in the header (search, help, the user) draw in its ink, whatever the accent carries. */
				--uui-color-default-contrast: var(--uui-color-header-contrast-emphasis);
				background-color: var(--umb-header-background-color, var(--uui-color-header-surface));
				/* Crombolo: an inset line, so the header stays 60px tall. */
				box-shadow: inset 0 -1px 0 var(--crombolo-header-line, transparent);
				display: flex;
				align-items: center;
				justify-content: space-between;
				padding: 0 var(--uui-size-space-5);
			}

			umb-backoffice-header-sections {
				flex: 1 1 auto;
			}
		`,
	];
}

declare global {
	interface HTMLElementTagNameMap {
		'umb-backoffice-header': UmbBackofficeHeaderElement;
	}
}
