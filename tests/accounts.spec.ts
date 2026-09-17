/** Account isolation: one account's connections and Catalog are unreachable from another. */

import { describe, expect, it } from 'vitest'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { createDataAgentAccounts, type DataAgentScopeOptions } from '../src/accounts.ts'
import { MissingPrincipalError, ownerKeyOf } from '../src/owner.ts'
import { apply as applyRoutes, Config as RoutesConfig } from '../src/routes.ts'

const ALICE = { source: 'dsh-passwords', id: '1', username: 'alice', role: 'user' }
const BOB = { source: 'dsh-passwords', id: '2', username: 'bob', role: 'user' }
const ADMIN = { source: 'dsh-passwords', id: '9', username: 'root', role: 'admin' }

const OPTIONS: DataAgentScopeOptions = {
  connectTimeoutMs: 1000,
  queryTimeoutMs: 1000,
  catalogQueryTimeoutMs: 1000,
  catalogMaxResultChars: 1024,
  maxResultChars: 1024,
  maxQueryChars: 1024,
  introspectMaxTables: 10,
  readonly: false,
  clients: {},
  catalogMaxAssetsPerRun: 10,
  catalogMaxTextChars: 1024,
  catalogPageSize: 10,
  catalogMaxPageSize: 20,
  catalogSchemaConcurrency: 1,
  catalogAssetConcurrency: 1,
  persistConnections: true,
  seeds: {},
}

/** One in-memory kv backend plus the opened-domain names it was asked for. */
function fixtureFacility() {
  const media = new Map<string, { version: number; tables: Record<string, Record<string, unknown>>; global: unknown }>()
  const opened: string[] = []
  const backend = {
    kv: {
      async open(descriptor: { name: string; version: number; tables: readonly string[] }) {
        opened.push(descriptor.name)
        const state = media.get(descriptor.name) ?? {
          version: descriptor.version,
          tables: Object.fromEntries(descriptor.tables.map(table => [table, {}])),
          global: null,
        }
        media.set(descriptor.name, state)
        return {
          async loadAll() { return { tables: state.tables, global: state.global } },
          async putRecord(table: string, key: string, value: unknown) { state.tables[table]![key] = value },
          async deleteRecord(table: string, key: string) { delete state.tables[table]![key] },
          async setGlobal(value: unknown) { state.global = value },
          async close() {},
        }
      },
    },
    async close() {},
  }
  const facility = new DomainFacility({
    storage: { backend: { get: () => backend } },
    emit() {},
    logger: { warn() {} },
  } as never, { backend: 'fixture' })
  return { facility, opened, media }
}

/**
 * Host Context face the accounts service and its scopes read.
 * @param principal - what the deployment's authentication returns for a request.
 * @param provider - whether a `requestPrincipal` provider is composed at all;
 * present-but-returning-undefined is an isolated deployment refusing one
 * request, while absent is an unisolated personal deployment.
 */
function fixtureContext(principal?: unknown, provider = principal !== undefined) {
  return {
    logger: { info() {}, warn() {}, error() {} },
    effect() { return () => {} },
    agents: {},
    llm: {},
    credentials: { async describe() { return { configured: true } } },
    get(name: string) {
      if (name === 'requestPrincipal') {
        return provider ? { authenticate: () => principal } : undefined
      }
      return undefined
    },
  }
}

const SQLITE = { type: 'sqlite' as const, database: '/tmp/alice.db', credentialMode: 'none' as const }

describe('data-agent account isolation', () => {
  it('derives a distinct owner key per identity source and id', () => {
    expect(ownerKeyOf(ALICE, 'test')).not.toBe(ownerKeyOf(BOB, 'test'))
    expect(ownerKeyOf({ source: 'other', id: '1' }, 'test')).not.toBe(ownerKeyOf(ALICE, 'test'))
    expect(ownerKeyOf(ALICE, 'test')).toBe(ownerKeyOf({ ...ALICE, username: 'renamed' }, 'test'))
    expect(() => ownerKeyOf(undefined, 'connect')).toThrow(MissingPrincipalError)
    expect(() => ownerKeyOf({ source: '  ', id: '1' }, 'connect')).toThrow(MissingPrincipalError)
  })

  it('opens one private pair of storage domains per account', async () => {
    const storage = fixtureFacility()
    const accounts = createDataAgentAccounts(fixtureContext(ALICE) as never, OPTIONS, storage.facility as never)
    await accounts.forPrincipal(ALICE, 'test')
    await accounts.forPrincipal(BOB, 'test')

    expect(storage.opened).toEqual([
      `data_agent_connections_${ownerKeyOf(ALICE, 'test')}`,
      `data_agent_catalog_${ownerKeyOf(ALICE, 'test')}`,
      `data_agent_connections_${ownerKeyOf(BOB, 'test')}`,
      `data_agent_catalog_${ownerKeyOf(BOB, 'test')}`,
    ])
    // The unsuffixed names stay reserved for deployments without accounts, so
    // an existing single-account install needs no migration.
    expect(storage.opened).not.toContain('data_agent_connections')
    expect(storage.opened).not.toContain('data_agent_catalog')
  })

  it('reuses one scope per account rather than rebuilding it per call', async () => {
    const storage = fixtureFacility()
    const accounts = createDataAgentAccounts(fixtureContext(ALICE) as never, OPTIONS, storage.facility as never)
    const first = await accounts.forPrincipal(ALICE, 'test')
    const second = await accounts.forPrincipal({ ...ALICE, username: 'renamed' }, 'test')
    expect(second).toBe(first)
    expect(storage.opened).toHaveLength(2)
  })

  it('keeps one account’s live connection invisible to every other account', async () => {
    const storage = fixtureFacility()
    const accounts = createDataAgentAccounts(fixtureContext(ALICE) as never, OPTIONS, storage.facility as never)
    const alice = await accounts.forPrincipal(ALICE, 'test')
    const bob = await accounts.forPrincipal(BOB, 'test')
    const admin = await accounts.forPrincipal(ADMIN, 'test')

    alice.connections.set('shared-session-id', SQLITE)

    expect(alice.connections.get('shared-session-id')?.database).toBe('/tmp/alice.db')
    // The same session id in another account selects nothing: the record is
    // absent from the store that lookup reads, not filtered out of its result.
    expect(bob.connections.get('shared-session-id')).toBeUndefined()
    expect(bob.connections.has('shared-session-id')).toBe(false)
    // An administrator is an account like any other here; the role widens
    // nothing, because being able to see must not become being able to write.
    expect(admin.connections.get('shared-session-id')).toBeUndefined()
  })

  it('keeps one account’s Catalog sources out of every other listing', async () => {
    const storage = fixtureFacility()
    const accounts = createDataAgentAccounts(fixtureContext(ALICE) as never, OPTIONS, storage.facility as never)
    const alice = await accounts.forPrincipal(ALICE, 'test')
    const bob = await accounts.forPrincipal(BOB, 'test')

    const aliceSources = storage.media.get(`data_agent_catalog_${ownerKeyOf(ALICE, 'test')}`)!.tables.sources!
    const bobSources = storage.media.get(`data_agent_catalog_${ownerKeyOf(BOB, 'test')}`)!.tables.sources!
    expect(aliceSources).not.toBe(bobSources)

    aliceSources['profile-a'] = {
      id: 'profile-a', profileId: 'profile-a', type: 'sqlite', name: 'Alice', database: 'alice.db',
      credentialConfigured: false,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    }
    // Neither live Catalog can reach the other's medium, so a source id one
    // account knows resolves to nothing in the other.
    expect(bob.catalog.listSources()).toEqual([])
    expect(bob.catalog.status('profile-a')).toBeUndefined()
    expect(alice.catalog.listSources()).toEqual([])
  })

  it('refuses an unattributed call instead of serving a shared store', async () => {
    const storage = fixtureFacility()
    const accounts = createDataAgentAccounts(fixtureContext(ALICE) as never, OPTIONS, storage.facility as never)
    expect(accounts.isolated()).toBe(true)
    await expect(accounts.forPrincipal(undefined, '/database')).rejects.toThrow(MissingPrincipalError)
    await expect(accounts.forExecution({}, 'sql-query')).rejects.toThrow(MissingPrincipalError)
    await expect(accounts.forDispatch('/catalog')).rejects.toThrow(MissingPrincipalError)
    // The same refusal on the carrier: a provider that authenticates nobody.
    const anonymous = createDataAgentAccounts(
      fixtureContext(undefined, true) as never, OPTIONS, storage.facility as never,
    )
    await expect(anonymous.forRequest({ headers: {} }, 'route')).rejects.toThrow(MissingPrincipalError)
  })

  it('keeps the original single store when no deployment authenticates requests', async () => {
    const storage = fixtureFacility()
    const accounts = createDataAgentAccounts(fixtureContext() as never, OPTIONS, storage.facility as never)
    expect(accounts.isolated()).toBe(false)
    const shared = await accounts.forPrincipal(undefined, 'startup')
    expect(await accounts.forRequest({ headers: {} }, 'route')).toBe(shared)
    expect(await accounts.forDispatch('/database')).toBe(shared)
    expect(storage.opened).toEqual(['data_agent_connections', 'data_agent_catalog'])
  })
})

/** Drive the real route handler with whatever principal the deployment reports. */
async function routeFixture(principal?: unknown, provider = principal !== undefined) {
  const storage = fixtureFacility()
  const base = fixtureContext(principal, provider)
  const accounts = createDataAgentAccounts(base as never, OPTIONS, storage.facility as never)
  let handler!: (req: unknown, res: unknown) => Promise<void>
  const ctx: Record<string, unknown> = {
    ...base,
    dataAgentAccounts: accounts,
    dataAgentConnections: {},
    dataAgentCatalog: {},
    dataAgentCatalogScanner: {},
    dataAgentCatalogReview: {},
    webServer: { register(route: { handler: typeof handler }) { handler = route.handler; return () => {} } },
    inject(_deps: string[], callback: (scope: unknown) => void) { callback(ctx) },
    effect(callback: () => unknown) { callback(); return () => {} },
  }
  applyRoutes(ctx as never, RoutesConfig({}))
  const request = async (url: string): Promise<{ status: number; body: Record<string, unknown> }> => {
    let status = 0
    let body = ''
    await handler(
      { method: 'GET', url, headers: {}, once() {}, on() {} },
      { writeHead(code: number) { status = code }, end(text: string) { body = text }, on() {} },
    )
    return { status, body: JSON.parse(body) as Record<string, unknown> }
  }
  return { accounts, request }
}

describe('data-agent routes under account isolation', () => {
  it('refuses an anonymous request with 401 rather than reading a shared store', async () => {
    const fixture = await routeFixture(undefined, true)
    // A deployment that authenticates requests but hands this one no identity.
    const answer = await fixture.request('/plugins/data-agent/status?sessionId=s1')
    expect(answer.status).toBe(401)
    expect(String(answer.body.error)).toContain('已登录账号')
  })

  it('serves each account only its own session state for the same session id', async () => {
    const alice = await routeFixture(ALICE)
    const aliceScope = await alice.accounts.forPrincipal(ALICE, 'test')
    aliceScope.connections.set('s1', SQLITE)
    const owned = await alice.request('/plugins/data-agent/status?sessionId=s1')
    expect(owned.status).toBe(200)
    expect(owned.body.connected).toBe(true)

    // Same session id, different signed-in account: nothing to see.
    const bob = await routeFixture(BOB)
    const foreign = await bob.request('/plugins/data-agent/status?sessionId=s1')
    expect(foreign.status).toBe(200)
    expect(foreign.body).toEqual({ connected: false, reconnectRequired: false })
  })
})
