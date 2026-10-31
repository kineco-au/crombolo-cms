import { UMB_AUTH_CONTEXT } from '../auth.context.token.js';
import type { UmbModalAppAuthConfig, UmbModalAppAuthValue } from './umb-app-auth-modal.token.js';
import { UmbModalBaseElement } from '@umbraco-cms/backoffice/modal';
import { customElement, html } from '@umbraco-cms/backoffice/external/lit';

import '../components/umb-auth-view.element.js';

@customElement('umb-app-auth-modal')
export class UmbAppAuthModalElement extends UmbModalBaseElement<UmbModalAppAuthConfig, UmbModalAppAuthValue> {
	#succeeded = false;
	#onSuccess = () => {
		// A sign-in reports success twice, through the auth context and through the
		// view's callback; the second would land on a closed modal.
		if (this.#succeeded) return;
		this.#succeeded = true;
		this.value = { success: true };
		this._submitModal();
	};

	override connectedCallback() {
		super.connectedCallback();
		// Close this modal when another tab restores the session via BroadcastChannel.
		this.consumeContext(UMB_AUTH_CONTEXT, (ctx) => {
			this.observe(ctx?.isAuthorized, (isAuthorized) => {
				if (isAuthorized) this.#onSuccess();
			});
		});
	}

	override render() {
		return html`<umb-auth-view
			.userLoginState=${this.data?.userLoginState ?? 'loggingIn'}
			.onSuccess=${this.#onSuccess}></umb-auth-view>`;
	}
}

export default UmbAppAuthModalElement;

declare global {
	interface HTMLElementTagNameMap {
		'umb-app-auth-modal': UmbAppAuthModalElement;
	}
}
