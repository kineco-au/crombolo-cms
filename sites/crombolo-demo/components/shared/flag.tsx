const FLAGS: Record<string, string> = {
  'en-US':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" aria-hidden="true"><path fill="#012169" d="M0 0h60v40H0z"/><path stroke="#fff" stroke-width="8" d="m0 0 60 40M60 0 0 40"/><path stroke="#c8102e" stroke-width="3" d="m0 0 60 40M60 0 0 40"/><path stroke="#fff" stroke-width="13" d="M30 0v40M0 20h60"/><path stroke="#c8102e" stroke-width="8" d="M30 0v40M0 20h60"/></svg>',
  'es-ES':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" aria-hidden="true"><path fill="#aa151b" d="M0 0h60v40H0z"/><path fill="#f1bf00" d="M0 10h60v20H0z"/></svg>',
}

/** The flag a language is shown by, drawn rather than an emoji, which Windows has none of; its code where it has none. */
export function Flag({ culture }: { culture: string }) {
  const flag = FLAGS[culture]
  return flag ? (
    <span
      class="block *:block *:w-6 *:border *:border-line"
      setInnerHTML={{ __html: flag, dangerously: true }}
    />
  ) : (
    <span class="text-sm">{culture}</span>
  )
}
