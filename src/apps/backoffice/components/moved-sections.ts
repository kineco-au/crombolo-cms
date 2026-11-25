/**
 * Crombolo: sections that moved keep their addresses. Bundles, once Umbraco's
 * Packages section, is a tool in Settings, so a bookmark or a link to
 * `section/packages/...` opens the same screen there. Media, Forms, Library and
 * Translation are places under Content (stories 385, 419), at `section/content/...`;
 * Approvals, a place there once, is a section of its own again (story 419). Users are in
 * Settings (story 429).
 */

/** Each section that moved: its old pathname, and its new one. */
export const UMB_MOVED_UNDER_CONTENT: Record<string, string> = {
	media: 'content/media',
	forms: 'content/forms',
	workflow: 'approvals',
	library: 'content/library',
	translation: 'content/translation',
	'content/approvals': 'approvals',
	'user-management': 'settings/users',
};

const MOVED = /^(.*\/)?section\/packages(?:\/view\/([^/]+)(\/.*)?)?\/?$/;

/** Where an address in a moved section now is, or undefined when it did not move. */
export function umbMovedSectionPath(pathname: string, search = ''): string | undefined {
	const under = /^(.*\/)?section\/(media|forms|workflow|library|translation|user-management|content\/approvals)(\/.*)?$/.exec(pathname);
	if (under) return `${under[1] ?? ''}section/${UMB_MOVED_UNDER_CONTENT[under[2]]}${under[3] ?? ''}${search}`;
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
