export function SiteFooter({ siteName }: { siteName: string }) {
  return (
    <footer class="border-t border-line text-sm text-muted">
      <div class="mx-auto max-w-6xl px-5 py-6">
        <p>{siteName} · Built with Crombolo</p>
      </div>
    </footer>
  )
}
