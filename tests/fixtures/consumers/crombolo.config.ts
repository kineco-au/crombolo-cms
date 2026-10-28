/** A site's config, written against `@crombolo/crombolo` only (story 173). */
import { defineConfig } from '@crombolo/crombolo'
import { greetings } from './bundle.ts'

export default defineConfig({ siteName: 'Consumer', bundles: [greetings()] })
