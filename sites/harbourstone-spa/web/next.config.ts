import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants'

/**
 * Static files, built once (`output: 'export'`): the browser reads every page from
 * the CMS, so publishing needs no rebuild. `next dev` serves any address instead,
 * which an export cannot.
 */
export default function config(phase: string): NextConfig {
  return {
    output: phase === PHASE_DEVELOPMENT_SERVER ? undefined : 'export',
    // The CMS's address, written into the app when it is built.
    env: { CROMBOLO_URL: process.env.CROMBOLO_URL ?? 'http://localhost:8080' },
    // The CMS resizes images itself, from the query the loader writes.
    images: { loader: 'custom', loaderFile: './lib/image-loader.ts' },
    transpilePackages: ['@crombolo/delivery-client'],
  }
}
