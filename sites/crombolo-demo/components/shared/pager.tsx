/** Older and newer links, kept out of the way on a list that fits one page. */
export function Pager({
  page,
  pages,
  href,
  labels,
}: {
  page: number
  pages: number
  href: (page: number) => string
  labels: { newer: string; older: string; position: string }
}) {
  if (pages < 2) return null
  return (
    <nav class="pager" aria-label={labels.position}>
      {page > 1 ? <a href={href(page - 1)}>{labels.newer}</a> : <span />}
      <span>{labels.position}</span>
      {page < pages ? <a href={href(page + 1)}>{labels.older}</a> : <span />}
    </nav>
  )
}
