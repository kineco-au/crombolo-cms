import { Wordmark } from './site-header'

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p>
          <Wordmark /> Distillery · Cove of Stenwick, Caithness
        </p>
        <p>A demonstration site. Nothing here is real, and nothing here is for sale.</p>
      </div>
    </footer>
  )
}
