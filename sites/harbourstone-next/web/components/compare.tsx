'use client'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useId, useMemo, useState } from 'react'

export interface Bottling {
  id: string
  title: string
  href: string
  kind: string
  productType: string
  abv: string
  age: string
  batch: string
  summary: string
  bottle?: { src: string; width: number; height: number; alt: string }
  notes: Array<{ aspect: string; note: string }>
}

/** How many sit side by side. */
export const MOST = 4

const ASPECT_ORDER = ['Nose', 'Palate', 'Finish']

interface Row {
  label: string
  value: (bottling: Bottling) => string
}

const FACTS: Row[] = [
  { label: 'Kind', value: (b) => b.kind },
  { label: 'Product type', value: (b) => b.productType },
  { label: 'ABV', value: (b) => b.abv },
  { label: 'Age', value: (b) => (b.age ? `${b.age} years` : '') },
  { label: 'Batch', value: (b) => b.batch },
  { label: 'Summary', value: (b) => b.summary },
]

/** The tasting rows: every aspect any bottling has, nose then palate then finish. */
function aspectRows(bottlings: readonly Bottling[]): Row[] {
  const aspects = [...new Set(bottlings.flatMap((b) => b.notes.map((n) => n.aspect)))].sort(
    (a, b) => (ASPECT_ORDER.indexOf(a) + 1 || 99) - (ASPECT_ORDER.indexOf(b) + 1 || 99),
  )
  return aspects.map((aspect) => ({
    label: aspect,
    value: (b) => b.notes.find((n) => n.aspect === aspect)?.note ?? '',
  }))
}

/** Whether the chosen bottlings differ on a row: what is worth reading across. */
const differs = (row: Row, chosen: readonly Bottling[]) =>
  chosen.length > 1 && new Set(chosen.map(row.value)).size > 1

const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort()

/**
 * The bottlings side by side, chosen in the browser (story 208). The choice is
 * kept in the address as `?compare=a,b`, so a link reopens it and Back steps
 * through each change.
 */
export function Compare({ bottlings }: { bottlings: Bottling[] }) {
  const router = useRouter()
  const path = usePathname()
  const params = useSearchParams()
  const ids = useId()
  const [kind, setKind] = useState('')
  const [productType, setProductType] = useState('')

  const byId = useMemo(() => new Map(bottlings.map((b) => [b.id, b])), [bottlings])
  const inAddress = params.get('compare') ?? ''
  const fromAddress = (value: string) =>
    value
      .split(',')
      .filter((id) => byId.has(id))
      .slice(0, MOST)
  // Held here as well as in the address, so a second click before the address
  // updates builds on the first; Back and a shared link set it from the address.
  const [chosenIds, setChosenIds] = useState(() => fromAddress(inAddress))
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the address, not the lookup.
  useEffect(() => setChosenIds(fromAddress(inAddress)), [inAddress])
  const chosen = chosenIds.map((id) => byId.get(id) as Bottling)
  const rows = [...FACTS, ...aspectRows(chosen)]
  const listed = bottlings.filter(
    (b) => (!kind || b.kind === kind) && (!productType || b.productType === productType),
  )

  const choose = (next: string[]) => {
    setChosenIds(next)
    const query = new URLSearchParams(params.toString())
    if (next.length > 0) query.set('compare', next.join(','))
    else query.delete('compare')
    const search = query.toString()
    router.push(search ? `${path}?${search}` : path, { scroll: false })
  }
  const toggle = (id: string) =>
    choose(chosenIds.includes(id) ? chosenIds.filter((c) => c !== id) : [...chosenIds, id])

  return (
    <div className="compare">
      <section className="compare__picker" aria-labelledby={`${ids}-pick`}>
        <h2 id={`${ids}-pick`}>Choose up to {MOST}</h2>
        <div className="compare__filters">
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Any</option>
              {unique(bottlings.map((b) => b.kind)).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Product type
            <select value={productType} onChange={(e) => setProductType(e.target.value)}>
              <option value="">Any</option>
              {unique(bottlings.map((b) => b.productType)).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <ul className="compare__choices">
          {listed.map((b) => {
            const on = chosenIds.includes(b.id)
            const full = !on && chosenIds.length >= MOST
            return (
              <li key={b.id}>
                <button
                  type="button"
                  className={on ? 'compare__choice compare__choice--on' : 'compare__choice'}
                  aria-pressed={on}
                  disabled={full}
                  title={full ? `Up to ${MOST} at once: remove one first` : undefined}
                  onClick={() => toggle(b.id)}
                >
                  <span className="compare__choice-name">{b.title}</span>
                  <span className="eyebrow">{[b.kind, b.abv].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            )
          })}
          {listed.length === 0 ? <li>No bottling matches those filters.</li> : null}
        </ul>
        <p className="compare__status" role="status">
          {chosen.length === 0 ? 'Nothing chosen yet.' : `${chosen.length} of ${MOST} chosen.`}{' '}
          {chosen.length > 0 ? (
            <button type="button" className="compare__clear" onClick={() => choose([])}>
              Clear
            </button>
          ) : null}
        </p>
      </section>

      {chosen.length > 0 ? (
        <section aria-labelledby={`${ids}-table`}>
          <h2 id={`${ids}-table`} className="visually-hidden">
            Side by side
          </h2>
          {chosen.length > 1 ? (
            <p className="compare__legend">
              <span className="compare__differs-key" /> Rows where they differ are marked.
            </p>
          ) : null}
          <div className="compare__table-wrap">
            <table className="compare__table">
              <thead>
                <tr>
                  <td />
                  {chosen.map((b) => (
                    <th key={b.id} scope="col">
                      {b.bottle ? (
                        <Image
                          src={b.bottle.src}
                          alt={b.bottle.alt}
                          width={b.bottle.width || 760}
                          height={b.bottle.height || 1140}
                          sizes="12rem"
                        />
                      ) : null}
                      <Link href={b.href}>{b.title}</Link>
                      <button
                        type="button"
                        className="compare__remove"
                        onClick={() => toggle(b.id)}
                        aria-label={`Remove ${b.title}`}
                      >
                        Remove
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.label}
                    className={differs(row, chosen) ? 'compare__differs' : undefined}
                  >
                    <th scope="row">{row.label}</th>
                    {chosen.map((b) => (
                      <td key={b.id}>{row.value(b) || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="compare__cards">
            {chosen.map((b) => (
              <li key={b.id} className="compare__card">
                <h3>
                  <Link href={b.href}>{b.title}</Link>
                </h3>
                <dl>
                  {rows.map((row) => (
                    <div
                      key={row.label}
                      className={differs(row, chosen) ? 'compare__differs' : undefined}
                    >
                      <dt>{row.label}</dt>
                      <dd>{row.value(b) || '—'}</dd>
                    </div>
                  ))}
                </dl>
                <button type="button" className="compare__remove" onClick={() => toggle(b.id)}>
                  Remove {b.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
