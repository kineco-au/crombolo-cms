import type { NextConfig } from 'next'

const config: NextConfig = {
  // `'use cache'`: pages are kept and the CMS's webhook says when to clear them.
  cacheComponents: true,
  partialPrefetching: true,
  // `unauthorized()` and `forbidden()`, for members-only pages.
  experimental: { authInterrupts: true },
  // The CMS resizes images itself, from the query the loader writes.
  images: { loader: 'custom', loaderFile: './lib/image-loader.ts' },
  transpilePackages: ['@crombolo/next-integration'],
}

export default config
