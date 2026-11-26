/**
 * A section a site or an extension declares (story 431), as the back office loads it: the
 * section, a grant of its own, laid out by the plugin's `site-section.js`, which draws its
 * places in the row under the header and each place's menu beside the screen.
 */
import { PLUGIN_PATH_PLACEHOLDER } from './paths.ts'

/** One screen in a place's menu: an element to load, or an extension's described screen. */
export interface DeclaredScreen {
  alias: string
  label: string
  icon?: string
  element?: string
  screen?: { bundle: string; screen: string }
}

export interface DeclaredPlace {
  alias: string
  label: string
  menu: readonly DeclaredScreen[]
}

export interface DeclaredSection {
  /** Its manifest alias, which is what a group is given. */
  alias: string
  /** Its address under `section/`. */
  pathname: string
  label: string
  places: readonly DeclaredPlace[]
}

/** The element that lays out every declared section. */
export const SECTION_LAYOUT_ELEMENT = `${PLUGIN_PATH_PLACEHOLDER}/site-section.js`

/** Where the site's built back-office code is served, below the plugin's path. */
export const SITE_CODE_SEGMENT = 'site'

/** A declared section's manifests: the section, and its layout. */
export function sectionManifests(section: DeclaredSection, weight = 30): unknown[] {
  return [
    {
      type: 'section',
      alias: section.alias,
      name: section.label,
      weight,
      meta: {
        label: section.label,
        pathname: section.pathname,
        cromboloPlaces: section.places.map((place) => ({
          alias: place.alias,
          label: place.label,
          menu: place.menu.map((screen) => ({
            alias: screen.alias,
            label: screen.label,
            ...(screen.icon ? { icon: screen.icon } : {}),
            ...(screen.element ? { element: screen.element } : {}),
            ...(screen.screen ? { screen: screen.screen } : {}),
          })),
        })),
      },
    },
    {
      type: 'sectionLayout',
      alias: `${section.alias}.Layout`,
      name: `${section.label} layout`,
      forSection: section.alias,
      element: SECTION_LAYOUT_ELEMENT,
    },
  ]
}
