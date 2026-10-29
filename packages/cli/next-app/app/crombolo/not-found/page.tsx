import { notFound } from 'next/navigation'

/** Where the proxy sends an address the CMS answers nothing at, so it is a real 404. */
export default function Missing() {
  notFound()
}
