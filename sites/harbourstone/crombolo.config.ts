import { defineConfig } from '@crombolo/crombolo'
import * as bottlings from '#actions/bottlings.ts'

export default defineConfig({
  siteName: 'Harbourstone Distillery',
  // An installed extension runs once granted (story 310). The site's code grants
  // Simple Redirects exactly what it asks for; take it out to turn it off.
  extensions: {
    redirects: { grant: ['backoffice.code', 'redirects.read', 'redirects.write', 'content.read'] },
  },
  // Server actions a page's forms post to (story 219): each export is one.
  actions: { bottlings },
})
