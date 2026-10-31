import { defineConfig } from '@crombolo/crombolo'
import { redirects } from '@crombolo/simple-redirects'
import * as bottlings from '#actions/bottlings.ts'

export default defineConfig({
  siteName: 'Harbourstone Distillery',
  // Installing a bundle gives you its backoffice screen. This line is what lets
  // its endpoints answer a request, so remove it to turn one off.
  bundles: [redirects()],
  // Server actions a page's forms post to (story 219): each export is one.
  actions: { bottlings },
})
