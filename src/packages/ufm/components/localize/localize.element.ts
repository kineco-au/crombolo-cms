import { UmbUfmElementBase } from '../ufm-element-base.js';
import { customElement, property } from '@umbraco-cms/backoffice/external/lit';
import { umbCromboloHooks } from '@umbraco-cms/backoffice/extension-registry';

@customElement('ufm-localize')
export class UmbUfmLocalizeElement extends UmbUfmElementBase {
	@property()
	public set alias(value: string | undefined) {
		if (!value) return;
		this.#alias = value;
		this.value = this.localize.term(value);
		// Crombolo: a name the back office has no term for may be a dictionary item's (story 297).
		if (this.value === value && umbCromboloHooks.dictionaryWord) {
			umbCromboloHooks.dictionaryWord(value).then((word) => {
				if (word !== undefined && this.#alias === value) this.value = word;
			});
		}
	}
	public get alias(): string | undefined {
		return this.#alias;
	}
	#alias?: string;
}

export { UmbUfmLocalizeElement as element };

declare global {
	interface HTMLElementTagNameMap {
		'ufm-localize': UmbUfmLocalizeElement;
	}
}
