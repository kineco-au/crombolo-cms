import { defineConfig } from '@crombolo/crombolo'
import { redirects } from '@crombolo/simple-redirects'

/** The reference site. Everything unset here comes from the environment or a default. */
export default defineConfig({
  siteName: 'Crombolo',
  /**
   * The redirects bundle's server half. Installing the package puts its screen in
   * the backoffice; this line is what lets it answer a request, and it is here
   * rather than discovered precisely so that a bundle cannot start serving
   * without someone committing it (`docs/bundles.md`).
   */
  bundles: [redirects()],
})
