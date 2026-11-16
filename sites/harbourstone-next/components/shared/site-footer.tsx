import { Wordmark } from './site-header.tsx'

export function SiteFooter() {
  return (
    <footer class="site-footer">
      <div class="site-footer__inner">
        <p>
          <Wordmark /> Distillery · Cove of Stenwick, Caithness
        </p>
        <p>This is a Crombolo demo site. Nothing here is for sale.</p>
      </div>
    </footer>
  )
}
