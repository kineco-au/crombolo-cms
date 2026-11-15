/** The CMS's address, written into the app when it is built: CROMBOLO_URL. */
export const CMS = (process.env.CROMBOLO_URL ?? 'http://localhost:8080').replace(/\/+$/, '')

/** A media address on the CMS: the API writes them from the site's root. */
export const mediaUrl = (src: string) => (src.startsWith('/') ? `${CMS}${src}` : src)
