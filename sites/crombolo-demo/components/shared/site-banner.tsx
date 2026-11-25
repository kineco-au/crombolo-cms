import { usePage } from '@crombolo/crombolo'

/** The notice above the header, from the site's settings page. */
export function SiteBanner() {
  const { settings } = usePage()
  const banner = settings?.text('banner')
  return banner ? <p class="site-banner">{banner}</p> : null
}
