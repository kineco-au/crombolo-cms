import { mediaUrl } from './address'

/** `next/image` for the CMS's media: the CMS resizes, from the width, quality and format asked for. */
export default function imageLoader({
  src,
  width,
  quality,
}: {
  src: string
  width: number
  quality?: number
}): string {
  const [path = '', query = ''] = src.split('?')
  const params = new URLSearchParams(query)
  params.set('width', String(width))
  if (!params.has('quality')) params.set('quality', String(quality ?? 75))
  if (!params.has('format')) params.set('format', 'webp')
  return `${mediaUrl(path)}?${params.toString()}`
}
