import { defineConfig } from '@crombolo/crombolo'

/** Where visitors see the site: the Next.js app in web/. */
const APP = process.env.CROMBOLO_APP_URL ?? 'http://localhost:3000'

export default defineConfig({
  siteName: 'Harbourstone Distillery',
  // An installed extension runs once granted (story 310). The site's code grants
  // Simple Redirects exactly what it asks for; take it out to turn it off.
  extensions: {
    redirects: { grant: ['redirects.read', 'redirects.write', 'content.read'] },
  },
  // The Next.js app in web/ reads the site through the Delivery API (story 208).
  // The key is CROMBOLO_DELIVERY_API_KEY, in .env.
  deliveryApi: {
    enabled: true,
    // The contact form posts from the app's pages straight to this site.
    cors: { allowedOrigins: [APP] },
    preview: { url: `${APP}/api/crombolo/preview?path={path}&token={token}` },
    memberAuthorization: {
      authorizationCodeFlow: {
        enabled: true,
        loginRedirectUrls: [`${APP}/api/crombolo/callback`],
        logoutRedirectUrls: [`${APP}/`],
        // A page on this site holding the member login form; add one before members sign in.
        loginPage: '/login',
      },
    },
  },
  seo: { publicUrl: APP },
})
