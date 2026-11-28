import { Wordmark } from './site-header.tsx'

export function SiteFooter() {
  return (
    <footer class="mt-20 border-t border-line text-sm text-muted">
      <div class="page-column flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 pt-8 pb-12">
        <p>
          <Wordmark plain /> Distillery · Cove of Stenwick, Caithness
        </p>
        <p>This is a Crombolo demo site. Nothing here is for sale.</p>
      </div>
    </footer>
  )
}
