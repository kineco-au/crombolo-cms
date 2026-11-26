/**
 * Where a section a site or an extension declares is (story 431): its place and screen
 * by the address, and the address of each. Pure, so each is tested on its own.
 */

/**
 * @typedef {{ alias: string, label: string, icon?: string, element?: string, screen?: { bundle: string, screen: string } }} DeclaredScreen
 * @typedef {{ alias: string, label: string, menu: DeclaredScreen[] }} DeclaredPlace
 * @typedef {{ alias: string, pathname: string, label: string, places: DeclaredPlace[] }} DeclaredSection
 */

/**
 * A declared section from its manifest, or undefined for any other section.
 *
 * @param {{ alias: string, meta?: { label?: string, pathname?: string, cromboloPlaces?: DeclaredPlace[] } } | undefined} manifest
 * @returns {DeclaredSection | undefined}
 */
export function declaredSection(manifest) {
  const places = manifest?.meta?.cromboloPlaces
  if (!Array.isArray(places) || places.length === 0 || !manifest?.meta?.pathname) return undefined
  return {
    alias: manifest.alias,
    pathname: manifest.meta.pathname,
    label: manifest.meta.label ?? manifest.alias,
    places,
  }
}

/**
 * The section, place and screen a path below the back office is at; the first place and
 * its first screen where the path names none, or one that is not there.
 *
 * @param {string} path e.g. `section/observations/records/review`
 * @param {DeclaredSection[]} sections
 */
export function locate(path, sections) {
  const found = /^section\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/.exec(path)
  if (!found) return undefined
  const section = sections.find((candidate) => candidate.pathname === found[1])
  if (!section) return undefined
  const place = section.places.find((p) => p.alias === found[2]) ?? section.places[0]
  const screen = place.menu.find((s) => s.alias === found[3]) ?? place.menu[0]
  return { section, place, screen }
}

/**
 * A screen's address below the back office; a place's first screen when none is given.
 *
 * @param {DeclaredSection} section
 * @param {DeclaredPlace} place
 * @param {DeclaredScreen} [screen]
 */
export const screenPath = (section, place, screen) =>
  `section/${section.pathname}/${place.alias}/${(screen ?? place.menu[0]).alias}`

/**
 * What the back office loads for a screen: the site's element, or the back office's own
 * drawing an extension's described screen.
 *
 * @param {DeclaredSection} section
 * @param {DeclaredScreen} screen
 */
export const screenManifest = (section, screen) => ({
  type: 'cromboloSectionScreen',
  alias: `${section.alias}.${screen.alias}`,
  name: screen.label,
  element: screen.element,
  ...(screen.screen ? { meta: { cromboloScreen: screen.screen } } : {}),
})

/**
 * Story 437: the site's panels, as Access lists them: each a grant of its own, by the
 * alias its manifest names.
 *
 * @param {Array<{ meta?: { cromboloGrant?: { alias: string, label: string } } }>} manifests
 */
export const panelAreas = (manifests) =>
  manifests.flatMap((manifest) => {
    const grant = manifest.meta?.cromboloGrant
    return grant
      ? [{ section: grant.alias, label: grant.label, line: 'A panel beside every section.' }]
      : []
  })
