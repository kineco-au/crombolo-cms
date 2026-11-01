/**
 * Crombolo: sections that moved into another section keep their addresses.
 * Bundles, once Umbraco's Packages section, is a tool in Settings, so a
 * bookmark or a link to `section/packages/...` opens the same screen there.
 */

const MOVED = /^(.*\/)?section\/packages(?:\/view\/([^/]+)(\/.*)?)?\/?$/;

/** Where an address in a moved section now is, or undefined when it did not move. */
export function umbMovedSectionPath(pathname: string, search = ''): string | undefined {
	const match = MOVED.exec(pathname);
	if (!match) return undefined;
	const [, base = '', view, rest = ''] = match;
	const tab = view === 'packages' ? 'marketplace' : view;
	return `${base}section/settings/dashboard/bundles${tab ? `/${tab}${rest}` : ''}${search}`;
}

/** Sends the address it is shown at to where that screen now is. */
export class UmbMovedSectionElement extends HTMLElement {
	override connectedCallback() {
		const to = umbMovedSectionPath(window.location.pathname, window.location.search);
		if (to) window.history.replaceState(null, '', to);
	}
}

if (!customElements.get('umb-moved-section')) customElements.define('umb-moved-section', UmbMovedSectionElement);
