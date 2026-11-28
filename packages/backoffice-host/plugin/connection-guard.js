/**
 * The server stopped answering: a dialog over the back office, the page dimmed and
 * blurred behind it, that tries again every few seconds and on its button, and closes
 * itself once the server answers. Reads that failed meanwhile are asked again then;
 * writes are not resent (`connection-guard-model.js`).
 */
import { connectionGuardedFetch } from './connection-guard-model.js'
import { actionElement } from './dialog-actions.js'
import { useDialogStyles } from './dialog-styles.js'

/** Seconds between tries while the dialog is open. */
export const RETRY_SECONDS = 5

export const WORDS = {
  title: 'Lost connection to the server',
  body: "The back office can't reach the server. Anything you were looking at comes back once it answers. If you were saving, save again once you're reconnected.",
  retry: 'Try to reconnect',
  trying: 'Trying…',
  next: (seconds) => `Trying again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
}

const backOffice = () =>
  new URL(
    document.querySelector('base')?.getAttribute('href') ?? '/umbraco/',
    location.href,
  ).href.replace(/\/$/, '')

/** A lost connection, shown once however many requests notice it, and its recovery. */
export function createConnection(send) {
  let back
  let resolveBack
  let box
  let timer
  let countdown = 0

  const status = () => `${backOffice()}/management/api/v1/server/status`

  const answering = async () => {
    try {
      const response = await send(status(), { cache: 'no-store', credentials: 'include' })
      return response.ok
    } catch {
      return false
    }
  }

  const close = () => {
    clearInterval(timer)
    timer = undefined
    box?.close()
    box = undefined
    const resolve = resolveBack
    back = undefined
    resolveBack = undefined
    resolve?.()
  }

  const attempt = async () => {
    const button = box?.querySelector('uui-button')
    const note = box?.querySelector('.next')
    if (button) {
      button.disabled = true
      button.setAttribute('label', WORDS.trying)
    }
    if (await answering()) return close()
    if (button) {
      button.disabled = false
      button.setAttribute('label', WORDS.retry)
    }
    countdown = RETRY_SECONDS
    if (note) note.textContent = WORDS.next(countdown)
  }

  const open = () => {
    useDialogStyles()
    box = document.createElement('dialog')
    box.className = 'crombolo-dialog crombolo-connection-dialog'
    box.setAttribute('aria-label', WORDS.title)
    // Laid out as every other dialog is, with the title bar, and no Close: only the
    // server answering closes it.
    const layout = document.createElement('uui-dialog-layout')
    layout.headline = WORDS.title
    const body = document.createElement('p')
    body.textContent = WORDS.body
    const next = document.createElement('p')
    next.className = 'next'
    next.setAttribute('aria-live', 'polite')
    const button = actionElement({ kind: 'primary', label: WORDS.retry, onClick: attempt })
    layout.append(body, next, button)
    box.append(layout)
    // Only the server answering closes it.
    box.addEventListener('cancel', (event) => event.preventDefault())
    document.body.append(box)
    box.showModal()
    countdown = RETRY_SECONDS
    box.querySelector('.next').textContent = WORDS.next(countdown)
    timer = setInterval(() => {
      if (!box || box.querySelector('uui-button')?.disabled) return
      countdown -= 1
      if (countdown <= 0) void attempt()
      else box.querySelector('.next').textContent = WORDS.next(countdown)
    }, 1000)
  }

  return {
    /** Says the connection is lost; answers a promise settled when it is back. */
    lost() {
      if (!back) {
        back = new Promise((resolve) => {
          resolveBack = resolve
        })
        open()
      }
      return back
    },
    /** Checks now, as when the browser says it is online again. */
    check: () => (back ? attempt() : undefined),
  }
}

export const onInit = () => {
  const send = window.fetch.bind(window)
  const connection = createConnection(send)
  window.fetch = connectionGuardedFetch(send, connection, location.origin)
  window.addEventListener('offline', () => void connection.lost())
  window.addEventListener('online', () => void connection.check())
}
