import type { PageProps } from '@crombolo/crombolo'
import { Flag } from './flag.tsx'

const LABELS: Record<string, string> = { 'en-US': 'English', 'es-ES': 'Español' }

/** This page in each language it is published in, which `urls` knows; `<SeoHead>` tells search engines the same. */
export function LanguageSwitch({ model, urls, culture, dictionary }: PageProps) {
  const versions = urls.alternates(model).filter((version) => version.culture)
  if (versions.length < 2) return null
  const current = culture ?? (versions[0]?.culture as string)
  return (
    <details class="relative flex-none">
      <summary
        class="flex cursor-pointer list-none items-center gap-1.5 rounded border border-line bg-white px-2 py-1.5 after:translate-y-0.5 after:border-4 after:border-transparent after:border-t-current [&::-webkit-details-marker]:hidden"
        aria-label={`${dictionary('nav.language')}: ${LABELS[current] ?? current}`}
      >
        <Flag culture={current} />
      </summary>
      <nav
        class="absolute top-full right-0 z-10 mt-1 grid min-w-36 rounded border border-line bg-white p-1 shadow-lg"
        aria-label={dictionary('nav.language')}
      >
        {versions.map((version) => {
          const iso = version.culture as string
          return (
            <a
              class="flex items-center gap-2 rounded px-2 py-1.5 text-green no-underline hover:bg-panel aria-[current=true]:font-semibold"
              href={version.url}
              lang={iso}
              hreflang={iso}
              aria-current={iso === culture ? 'true' : undefined}
            >
              <Flag culture={iso} />
              {LABELS[iso] ?? iso}
            </a>
          )
        })}
      </nav>
    </details>
  )
}
