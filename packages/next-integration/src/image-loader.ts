/**
 * `next/image` for crombolo media (story 208): the CMS resizes, so the loader
 * writes its imaging query rather than Next's optimiser doing the work.
 *
 * ```ts
 * // next.config.ts
 * images: { loader: 'custom', loaderFile: './lib/image-loader.ts' }
 * // lib/image-loader.ts
 * export { default } from '@crombolo/next-integration/image-loader'
 * ```
 */
import type { ApiCrop, ApiFocalPoint } from '@crombolo/delivery-client'

export interface ImageLoaderProps {
  src: string
  width: number
  quality?: number
}

/** Adds the width, quality and a modern format to a media address, keeping a crop it carries. */
export default function cromboloImageLoader({ src, width, quality }: ImageLoaderProps): string {
  const [path, query = ''] = src.split('?')
  const params = new URLSearchParams(query)
  params.set('width', String(width))
  if (!params.has('quality')) params.set('quality', String(quality ?? 75))
  if (!params.has('format')) params.set('format', 'webp')
  return `${path}?${params.toString()}`
}

/** What a picked image needs for `<Image>`: an address carrying its crop or focal point, and its size. */
export function cromboloImage(
  media: {
    url: string
    width: number | null
    height: number | null
    name: string
    focalPoint?: ApiFocalPoint | null
    crops?: ApiCrop[] | null
  },
  options: { crop?: string; alt?: string } = {},
): { src: string; width: number; height: number; alt: string } {
  const params = new URLSearchParams()
  const crop = options.crop ? media.crops?.find((c) => c.alias === options.crop) : undefined
  let width = media.width ?? 0
  let height = media.height ?? 0
  if (crop) {
    width = crop.width
    height = crop.height
    if (crop.coordinates) {
      const { x1, y1, x2, y2 } = crop.coordinates
      params.set('cc', [x1, y1, x2, y2].join(','))
    } else if (media.focalPoint)
      params.set('rxy', `${media.focalPoint.left},${media.focalPoint.top}`)
  } else if (media.focalPoint) params.set('rxy', `${media.focalPoint.left},${media.focalPoint.top}`)
  const query = params.toString()
  return {
    src: query ? `${media.url}?${query}` : media.url,
    width,
    height,
    alt: options.alt ?? media.name,
  }
}
