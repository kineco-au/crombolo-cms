import type { PageProps } from '@crombolo/crombolo'

const LABELS: Record<string, string> = { 'en-US': 'English', 'es-ES': 'Español' }

/** This page in each language it is published in, which `urls` knows; `<SeoHead>` tells search engines the same. */
export function LanguageSwitch({ model, urls, culture, dictionary }: PageProps) {
  const versions = urls.alternates(model).filter((version) => version.culture)
  if (versions.length < 2) return null
  return (
    <nav class="language-switch" aria-label={dictionary('nav.language')}>
      {versions.map((version) => {
        const iso = version.culture as string
        return (
          <a
            href={version.url}
            lang={iso}
            hreflang={iso}
            aria-current={iso === culture ? 'true' : undefined}
          >
            {LABELS[iso] ?? iso}
          </a>
        )
      })}
    </nav>
  )
}
