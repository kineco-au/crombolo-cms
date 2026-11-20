/**
 * Story 380: where a site requires a workspace, the back office sends each
 * Management API request in the person's own, unless it names another.
 */
import { describe, expect, test } from 'bun:test'
import {
  WORKSPACE_HEADER,
  withOwnWorkspace,
} from '../packages/backoffice-host/plugin/own-workspace.js'

const API = 'http://local/umbraco/management/api/v1/document/0b8f5a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'

describe('the back office in a person’s own workspace', () => {
  test('names it on a Management API request', () => {
    const sent = withOwnWorkspace(new Request(API, { method: 'PUT' }))
    expect(sent.headers.get(WORKSPACE_HEADER)).toBe('mine')
  })

  test('keeps a workspace the request names, and leaves other requests alone', () => {
    const named = withOwnWorkspace(new Request(API, { headers: { [WORKSPACE_HEADER]: 'abc' } }))
    expect(named.headers.get(WORKSPACE_HEADER)).toBe('abc')
    const other = withOwnWorkspace(new Request('http://local/umbraco/crombolo/api/overview'))
    expect(other.headers.has(WORKSPACE_HEADER)).toBe(false)
  })
})
