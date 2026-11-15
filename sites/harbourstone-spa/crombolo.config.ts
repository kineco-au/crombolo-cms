import { defineConfig } from '@crombolo/crombolo'

/** Where visitors see the site: the single-page app in web/, beside the Next.js one on 3000. */
const APP = process.env.CROMBOLO_APP_URL ?? 'http://localhost:3001'

export default defineConfig({
  siteName: 'Harbourstone Distillery',
  // An installed extension runs once granted (story 310). The site's code grants
  // Simple Redirects exactly what it asks for; take it out to turn it off.
  extensions: {
    redirects: { grant: ['redirects.read', 'redirects.write', 'content.read'] },
  },
  // The app reads what the site publishes with no key, from any origin (story 348).
  deliveryApi: {
    preview: { url: `${APP}/preview?path={path}&token={token}` },
    memberAuthorization: {
      authorizationCodeFlow: {
        enabled: true,
        loginRedirectUrls: [`${APP}/signed-in`],
        logoutRedirectUrls: [`${APP}/`],
        // The one page this site still draws: a member signs in here, then goes back to the app.
        loginPage: '/login',
      },
    },
  },
  seo: { publicUrl: APP },
})
