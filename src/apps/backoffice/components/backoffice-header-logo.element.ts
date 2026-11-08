import { css, html, customElement } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UmbTextStyles } from '@umbraco-cms/backoffice/style';

/**
 * The backoffice header logo element. Crombolo: a link home, which is the Home view for
 * whoever has it and a user's first section for anyone else.
 * @cssprop --umb-header-logo-display - The display property of the header logo.
 * @cssprop --umb-header-logo-margin - The margin of the header logo.
 * @cssprop --umb-header-logo-width - The width of the header logo.
 * @cssprop --umb-header-logo-height - The height of the header logo.
 */
@customElement('umb-backoffice-header-logo')
export class UmbBackofficeHeaderLogoElement extends UmbLitElement {
	override render() {
		return html`
			<uui-button id="header-logo-button" look="primary" label="Home" compact href=${document.baseURI}>
				<umb-app-logo id="header-logo" loading="eager" override-theme="umb-dark-theme"></umb-app-logo>
			</uui-button>
		`;
	}

	static override styles = [
		UmbTextStyles,
		css`
			#header-logo-button {
				--uui-button-padding-top-factor: 1;
				--uui-button-padding-bottom-factor: 0.5;
				--uui-button-background-color: transparent;
				/* Crombolo: the logo is a link home, and does not light up as a button would. */
				--uui-button-background-color-hover: transparent;
				display: var(--umb-header-logo-display, inline);
				margin: var(--umb-header-logo-margin, 0 var(--uui-size-space-2) 0 0);
			}

			#header-logo > img {
				width: var(--umb-header-logo-width, auto);
				height: var(--umb-header-logo-height, 30px);
			}
		`,
	];
}

declare global {
	interface HTMLElementTagNameMap {
		'umb-backoffice-header-logo': UmbBackofficeHeaderLogoElement;
	}
}
