/** Addresses in the back office, for links in e-mails and messages. */
import type { CromboloConfig } from './config.ts'

/** The back office's address, e.g. `https://site.example/crombolo`; undefined when the site's own is not set. */
export function backOfficeUrl(
  config: Pick<CromboloConfig, 'applicationUrl' | 'backOfficePath'>,
): string | undefined {
  return config.applicationUrl
    ? `${config.applicationUrl.replace(/\/$/, '')}${config.backOfficePath}`
    : undefined
}

/** A page's address in the back office, for a link in an e-mail. */
export function documentEditUrl(
  config: Pick<CromboloConfig, 'applicationUrl' | 'backOfficePath'>,
  key: string,
): string | undefined {
  const base = backOfficeUrl(config)
  return base ? `${base}/section/content/workspace/document/edit/${key}` : undefined
}
