import type { ApiMediaWithCrops } from '@crombolo/next-integration'
import { cromboloImage } from '@crombolo/next-integration/image-loader'
import Image from 'next/image'

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
  const picture = cromboloImage(media)
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
