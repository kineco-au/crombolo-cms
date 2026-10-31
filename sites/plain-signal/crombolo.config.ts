import { defineConfig } from '@crombolo/crombolo'

export default defineConfig({
  siteName: 'Plain Signal',
  // The contact form is an island that reads its definition from the Delivery
  // API and posts it from the browser, so the API is on.
  deliveryApi: { enabled: true },
})
