import type { ApiMediaWithCrops } from '@crombolo/delivery-client'
import Image from 'next/image'
import { imageOf } from '@/lib/content'

/** A picked image through `next/image`; the CMS resizes it from the loader's query. */
export function Picture({
  media,
  className,
  sizes,
  priority,
}: {
  media: ApiMediaWithCrops | undefined
  className?: string
  sizes?: string
  priority?: boolean
}) {
  if (!media) return null
  const picture = imageOf(media)
  return (
    <Image
      src={picture.src}
      alt={picture.alt}
      width={picture.width || 1200}
      height={picture.height || 800}
      className={className}
      sizes={sizes ?? '(min-width: 64rem) 50vw, 100vw'}
      priority={priority}
    />
  )
}
