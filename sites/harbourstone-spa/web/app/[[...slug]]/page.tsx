import { Suspense } from 'react'
import { App } from '@/components/app'

/** Built once, as `index.html`; a static host answers every other address with it too. */
export function generateStaticParams() {
  return [{ slug: [] }]
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  )
}
