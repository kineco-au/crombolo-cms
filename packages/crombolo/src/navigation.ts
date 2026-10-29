/**
 * Ending a page early, mirroring `next/navigation` (story 206): each function
 * throws, from any component, layout or block, and the page answers its status.
 */
export {
  badRequest,
  forbidden,
  foundAt,
  gone,
  movedPermanentlyTo,
  notFound,
  permanentRedirect,
  redirect,
  rethrow,
  seeOther,
  unauthorized,
  unprocessableContent,
} from '@crombolo/render/navigation'

// Decision 8 of story 209: a browser that loads this has been handed server code.
if (typeof document !== 'undefined')
  throw new Error(
    "@crombolo/crombolo/navigation only runs on the server; a 'use client' component cannot import it.",
  )
