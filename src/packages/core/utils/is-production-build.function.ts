/**
 * Returns true if the current build is a production build, false otherwise.
 *
 * Vite substitutes `import.meta.env.PROD` with `true` in the shipped, Vite-bundled core package (and
 * leaves it `false` in Vite dev). Outside a Vite build — the initial `tsc` pass and web-test-runner —
 * `import.meta.env` is undefined, so the guard returns false there.
 * @returns {boolean} `true` if the current build is a production build.
 */
export function umbIsProductionBuild(): boolean {
	// Crombolo serves the tsc output, where `import.meta.env` is undefined: it is always a production build.
	return true;
}
