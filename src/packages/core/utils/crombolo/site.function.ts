/**
 * The site's name, as the page that hosts the back office states it in
 * `<meta name="application-name">`; Crombolo when it does not say.
 */
export function cromboloSiteName(doc: Document = document): string {
	const stated = doc.querySelector('meta[name="application-name"]')?.getAttribute('content');
	return stated?.trim() || 'Crombolo';
}

/** Whether a theme paints the back office dark: Dark, or Match my system on a dark computer. */
export function cromboloIsDarkTheme(alias: string | undefined, prefersDark = cromboloPrefersDark()): boolean {
	return (
		alias === 'Crombolo.Theme.Dark' || alias === 'umb-dark-theme' || (alias === 'Crombolo.Theme.System' && prefersDark)
	);
}

export function cromboloPrefersDark(): boolean {
	try {
		return window.matchMedia('(prefers-color-scheme: dark)').matches;
	} catch {
		return false;
	}
}
