import { memberHandlers } from '@crombolo/next-integration/route-handlers'
import { crombolo } from './crombolo'

const app = process.env.CROMBOLO_APP_URL ?? 'http://localhost:3000'

/** Sign-in and sign-out; both addresses are registered in the CMS's crombolo.config.ts. */
export const members = memberHandlers(crombolo, {
  redirectUri: `${app}/api/crombolo/callback`,
  postLogoutRedirectUri: `${app}/`,
})
