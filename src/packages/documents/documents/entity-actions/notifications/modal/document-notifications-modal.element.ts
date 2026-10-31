import { UmbDocumentItemRepository } from '../../../item/index.js';
import { UmbDocumentNotificationsRepository } from '../repository/document-notifications.repository.js';
import type { UmbDocumentNotificationsModalData } from './document-notifications-modal.token.js';
import type { UmbEntityUnique } from '@umbraco-cms/backoffice/entity';
import type { GetDocumentByIdNotificationsResponse } from '@umbraco-cms/backoffice/external/backend-api';
import { css, customElement, html, nothing, repeat, state } from '@umbraco-cms/backoffice/external/lit';
import { umbCromboloHooks } from '@umbraco-cms/backoffice/extension-registry';
import { UmbModalBaseElement } from '@umbraco-cms/backoffice/modal';
import { UmbTextStyles } from '@umbraco-cms/backoffice/style';

type UmbDocumentNotificationSettings = GetDocumentByIdNotificationsResponse;

@customElement('umb-document-notifications-modal')
export class UmbDocumentNotificationsModalElement extends UmbModalBaseElement<
	UmbDocumentNotificationsModalData,
	never
> {
	#unique?: UmbEntityUnique;
	#documentNotificationsRepository = new UmbDocumentNotificationsRepository(this);

	@state()
	private _settings: UmbDocumentNotificationSettings = [];

	@state()
	private _documentName = '';

	/** Why notifications cannot be chosen on this site, such as having no e-mail (story 045). */
	@state()
	private _unavailable?: string;

	override firstUpdated() {
		this.#unique = this.data?.unique;
		umbCromboloHooks
			.notificationsUnavailable?.()
			.then((reason) => (this._unavailable = reason))
			.catch(() => {});
		this.#readNotificationSettings();
		this.#getDocumentName();
	}

	async #getDocumentName() {
		if (!this.#unique) return;
		// Should this be done here or in the action file?
		const { data } = await new UmbDocumentItemRepository(this).requestItems([this.#unique]);
		if (!data) return;
		const item = data[0];
		//TODO How do we ensure we get the correct variant?
		this._documentName = item.variants[0]?.name;
	}

	async #readNotificationSettings() {
		if (!this.#unique) return;
		const { data } = await this.#documentNotificationsRepository.readNotifications(this.#unique);

		if (!data) return;
		this._settings = data;
	}

	async #updateNotificationSettings() {
		if (!this.#unique) return;

		const subscribedActionIds = this._settings.filter((x) => x.subscribed).map((x) => x.actionId);
		const { error } = await this.#documentNotificationsRepository.updateNotifications(
			this.#unique,
			this._documentName,
			{
				subscribedActionIds,
			},
		);

		if (error) return;
		this._submitModal();
	}

	async #updateSubscription(actionId: string) {
		this._settings = this._settings.map((setting) => {
			if (setting.actionId === actionId) {
				const subscribed = !setting.subscribed;
				return { ...setting, subscribed };
			}
			return setting;
		});
	}

	override render() {
		return html`
			<umb-body-layout headline=${this.localize.term('notifications_notifications')}>
				<uui-box .headline=${this.localize.term('notifications_editNotifications', this._documentName)}>
					${this._unavailable
						? html`<p class="unavailable" role="status">${this._unavailable}</p>`
						: nothing}
					${repeat(
						this._settings,
						(setting) => setting.actionId,
						(setting) => {
							const localizationKey = `actions_${setting.alias}`;
							const localization = this.localize.termOrDefault(localizationKey, setting.alias);
							return html`<uui-toggle
								id=${setting.actionId}
								@change=${() => this.#updateSubscription(setting.actionId)}
								.label=${localization}
								?disabled=${!!this._unavailable}
								?checked=${setting.subscribed}></uui-toggle>`;
						},
					)}
				</uui-box>
				<umb-footer-layout slot="footer">
					<uui-button
						slot="actions"
						look="secondary"
						label=${this.localize.term('general_cancel')}
						@click=${this._rejectModal}></uui-button>
					<uui-button
						slot="actions"
						look="primary"
						color="positive"
						?disabled=${!!this._unavailable}
						label=${this.localize.term('buttons_save')}
						@click=${this.#updateNotificationSettings}></uui-button>
				</umb-footer-layout>
			</umb-body-layout>
		`;
	}

	static override readonly styles = [
		UmbTextStyles,
		css`
			.unavailable {
				margin: 0 0 var(--uui-size-space-4);
				color: var(--uui-color-text-alt);
			}
			uui-toggle {
				display: block;
			}
		`,
	];
}

export default UmbDocumentNotificationsModalElement;

declare global {
	interface HTMLElementTagNameMap {
		'umb-document-notifications-modal': UmbDocumentNotificationsModalElement;
	}
}
