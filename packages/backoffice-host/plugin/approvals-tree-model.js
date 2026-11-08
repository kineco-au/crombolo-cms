/**
 * What the tree beside Approvals lists under Pending (`approvals-tree.js`): every
 * request still pending, those waiting on the reader first and marked so, each
 * group in the order the requests were sent. Pure.
 */

/**
 * @param {{ key: string, state: string }[] | undefined} pending every request in flight
 * @param {{ key: string }[] | undefined} mine those waiting on a stage the reader may decide
 * @returns {Array<{ key: string, mine: boolean }>}
 */
export function pendingForTree(pending, mine) {
  const waitingOnMe = new Set((mine ?? []).map((request) => request.key))
  const open = (pending ?? []).filter(
    (request) => request.state === 'waiting' || request.state === 'scheduled',
  )
  return [
    ...open.filter((request) => waitingOnMe.has(request.key)),
    ...open.filter((request) => !waitingOnMe.has(request.key)),
  ].map((request) => ({ ...request, mine: waitingOnMe.has(request.key) }))
}
