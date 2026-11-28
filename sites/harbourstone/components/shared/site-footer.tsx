import { usePage } from '@crombolo/crombolo'
import { Wordmark } from './site-header.tsx'

/** The footer, from the site's settings page, which editors change in Content. */
export function SiteFooter() {
  const { settings } = usePage()
  const address = settings?.text('address')
  const note = settings?.text('footerNote')
  return (
    <footer class="mt-20 border-t border-line text-sm text-muted">
      <div class="page-column flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 pt-8 pb-12">
        <p>
          <Wordmark plain /> {address}
        </p>
        {note ? <p>{note}</p> : null}
      </div>
    </footer>
  )
}
