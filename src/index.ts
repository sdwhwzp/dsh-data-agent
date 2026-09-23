/**
 * Data Agent profile entry. The host row provides the
 * `dataAgentConnections` service (shared non-secret profile/binding storage;
 * temporary passwords stay process-local), seeds config connections (`connections`, `'*'` =
 * wildcard default), provides a separate versioned governance Catalog, installs the `data-agent` agent preset into
 * `$DSH_HOME/.agent-presets/`, and preloads the preset-scoped database tools
 * on every surface, while registering `/database` and `/catalog` only while
 * the current Cordis composition actually loads the dsh-tui plugin.
 *
 * The HTTP routes live in the separate `./routes` entry
 * (`@yejiming/dsh-data-agent/routes`, cordis row `data-agent-routes`) so
 * this row keeps working in headless profiles without a webserver. The
 * database implementations still have public `./tool` and `./command`
 * exports, but the shipped preset does not dynamically import those package
 * subpaths. Loading them here keeps Desktop on the same profile-startup path
 * as other UI bundles and avoids Electron ASAR package-resolution drift.
 * @module @yejiming/dsh-data-agent
 */

import { createHash } from 'node:crypto'
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-credentials'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as storageJsonPlugin from '@deepseek-ai/dsh-storage-json'
import type {} from '@deepseek-ai/dsh-subprocess'

/**
 * Preset ids whose sessions carry the database tools.
 *
 * One home for the fact: the host row decides it from config, and the sibling
 * routes row serves it to the browser so the Web workbench control appears in
 * exactly the sessions that can actually run SQL.
 */
export interface DataAgentPresets {
  /** Preset ids with the tool half mounted, owned preset first. */
  readonly ids: readonly string[]
}

/** The `dataAgentConnections` service face on the cordis context. */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Preset ids whose sessions carry the database tools. */
    dataAgentPresets: DataAgentPresets
    dataAgentConnections: DataAgentConnections
    dataAgentCatalog: DataAgentCatalog
    dataAgentCatalogScanner: DataAgentCatalogScanner
    dataAgentCatalogReview: DataAgentCatalogReview
  }
}
import z from 'schemastery'
import {
  type DataAgentConnections,
  type DatabaseConnection,
  type DatabaseType,
} from './connections.ts'
import { clientsSchema, type CliDatabaseType, type ClientConfig } from './clients.ts'
import {
  type DataAgentCatalog,
  type DataAgentCatalogReview,
  type DataAgentCatalogScanner,
} from './catalog.ts'
import {
  createDataAgentAccounts,
  type DataAgentScope,
} from './accounts.ts'
import { MissingPrincipalError } from './owner.ts'
import {
  DEFAULT_CATALOG_ASSET_CONCURRENCY,
  DEFAULT_CATALOG_MAX_ASSETS,
  DEFAULT_CATALOG_MAX_RESULT_CHARS,
  DEFAULT_CATALOG_MAX_TEXT_CHARS,
  DEFAULT_CATALOG_PAGE_SIZE,
  DEFAULT_CATALOG_QUERY_TIMEOUT_MS,
  DEFAULT_CATALOG_SCHEMA_CONCURRENCY,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_INTROSPECT_MAX_TABLES,
  DEFAULT_MAX_RESULT_CHARS,
  DEFAULT_MAX_QUERY_CHARS,
  DEFAULT_MAX_ROWS,
  DEFAULT_PRESET_ID,
  DEFAULT_QUERY_TIMEOUT_MS,
  MAX_CATALOG_PAGE_SIZE,
} from './defaults.ts'
import {
  apply as applyDatabaseCommand,
  type DataAgentCommandAdapterOptions,
} from './command.ts'
import { apply as applyDatabaseTools, type Config as ToolConfig } from './tool.ts'

export type {
  CatalogServiceBundle,
  CatalogServiceOptions,
  CatalogStatusSummary,
  DataAgentCatalog,
  DataAgentCatalogReview,
  DataAgentCatalogScanner,
  StartCatalogScanInput,
} from './catalog.ts'
export type {
  CatalogAssetDetail,
  CatalogAssetHead,
  CatalogAssetKind,
  CatalogAssetRevision,
  CatalogAssetStatus,
  CatalogCapability,
  CatalogDiffItem,
  CatalogDiffKind,
  CatalogDiffPage,
  CatalogEnrichment,
  CatalogEnrichmentStatus,
  CatalogIdentity,
  CatalogObservation,
  CatalogProgress,
  CatalogRelation,
  CatalogRun,
  CatalogRunStatus,
  CatalogScope,
  CatalogSearchFilters,
  CatalogSearchItem,
  CatalogSearchPage,
  CatalogSearchRequest,
  CatalogSemanticEntry,
  CatalogSemanticKind,
  CatalogSemanticRevision,
  CatalogSemanticStatus,
  CatalogSource,
  CatalogTechnicalPayload,
  MetricDefinition,
  MeaningDefinition,
  SemanticDefinition,
  TermDefinition,
} from './catalog-types.ts'

/** Cordis plugin name (diagnostics only). */
export const name = 'data-agent'

/** Services required before the profile entry can mount its preset layer. */
export const inject = ['agentPresets', 'agents', 'commands', 'credentials', 'llm', 'subprocess', 'tools']

/** Deployment overrides for one database type's CLI client. */
export type ClientsConfig = Partial<Record<CliDatabaseType, ClientConfig>>

/**
 * One config-seeded connection. Deliberately password-free: passwords are a
 * memory-only / connect-time value, so only the /connect route may carry one.
 * The key `'*'` seeds the wildcard default used by any session without its
 * own connection (headless/keyless runs, deployments pinning one database).
 */
export interface SeededConnectionConfig {
  type: DatabaseType
  host?: string
  port?: number
  user?: string
  database: string
  /** Optional per-seed read-only guard. */
  readonly?: boolean
  /** ClickHouse only: use HTTPS with certificate verification. */
  secure?: boolean
  /** Safe credential reference. Real passwords are rejected by the schema. */
  passwordRef?: string
  password?: never
}

/** Required plugin configuration (loader schema with deployment defaults). */
export interface Config {
  /** Preset directory name installed under `$DSH_HOME/.agent-presets/`. */
  presetId: string
  /**
   * Further preset ids whose sessions also receive the database tools.
   *
   * Each named preset must already exist; this package installs and owns only
   * {@link Config.presetId}. These presets receive the tool half ALONE — not
   * the `/database` and `/catalog` commands, and not the inherited-tool
   * restriction that makes the owned preset a closed data surface — so a
   * general-purpose preset keeps its own tools and gains SQL beside them.
   */
  additionalToolPresets: string[]
  /** Whether to self-install the preset on startup (idempotent). */
  installPreset: boolean
  /** The profile declares preset /tool and /command rows instead of legacy standing mounts. */
  profileManagedPresets: boolean
  /** Deadline for one /connect connectivity check, milliseconds. */
  connectTimeoutMs: number
  /** Cap on the table list returned by /connect and /status. */
  introspectMaxTables: number
  /** Deadline for one database-tool query, milliseconds. */
  queryTimeoutMs: number
  /** Deadline for one package-owned system-catalog metadata query. */
  catalogQueryTimeoutMs: number
  /** Per-stream capture budget for one package-owned system-catalog query. */
  catalogMaxResultChars: number
  /** Maximum schemas and table/view details processed concurrently. */
  catalogSchemaConcurrency: number
  catalogAssetConcurrency: number
  /** Hard technical asset bound for one scan. */
  catalogMaxAssetsPerRun: number
  /** Maximum normalized database/human text field length. */
  catalogMaxTextChars: number
  /** Default and maximum Catalog list/detail page sizes. */
  catalogPageSize: number
  catalogMaxPageSize: number
  /** In-memory cap on database-tool captured output. */
  maxResultChars: number
  /** Maximum structured rows returned by one database read tool call. */
  maxRows: number
  /** Maximum SQL text accepted by the shared Web query adapter. */
  maxQueryChars: number
  /** Default read-only guard: true rejects write statements in database tools and /query. */
  readonly: boolean
  /** Persist non-secret profiles/bindings through DSH storage-domain. */
  persistConnections: boolean
  /** CLI client overrides keyed by database type. */
  clients: ClientsConfig
  /** Config-seeded connections keyed by session id (`'*'` = wildcard default). */
  connections: Record<string, SeededConnectionConfig>
}

/** Loader schema with deployment defaults (no library defaults). */
export const Config = z.object({
  presetId: z.string().default(DEFAULT_PRESET_ID),
  additionalToolPresets: z.array(z.string()).default([]),
  installPreset: z.boolean().default(true),
  profileManagedPresets: z.boolean().default(false),
  connectTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_CONNECT_TIMEOUT_MS),
  introspectMaxTables: z.number().step(1).min(1).default(DEFAULT_INTROSPECT_MAX_TABLES),
  queryTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_QUERY_TIMEOUT_MS),
  catalogQueryTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_CATALOG_QUERY_TIMEOUT_MS),
  catalogMaxResultChars: z.number().step(1).min(1024).default(DEFAULT_CATALOG_MAX_RESULT_CHARS),
  catalogSchemaConcurrency: z.number().step(1).min(1).max(16).default(DEFAULT_CATALOG_SCHEMA_CONCURRENCY),
  catalogAssetConcurrency: z.number().step(1).min(1).max(32).default(DEFAULT_CATALOG_ASSET_CONCURRENCY),
  catalogMaxAssetsPerRun: z.number().step(1).min(1).max(1_000_000).default(DEFAULT_CATALOG_MAX_ASSETS),
  catalogMaxTextChars: z.number().step(1).min(256).max(4_096).default(DEFAULT_CATALOG_MAX_TEXT_CHARS),
  catalogPageSize: z.number().step(1).min(1).max(MAX_CATALOG_PAGE_SIZE).default(DEFAULT_CATALOG_PAGE_SIZE),
  catalogMaxPageSize: z.number().step(1).min(1).max(MAX_CATALOG_PAGE_SIZE).default(MAX_CATALOG_PAGE_SIZE),
  maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
  maxRows: z.number().step(1).min(1).default(DEFAULT_MAX_ROWS),
  maxQueryChars: z.number().step(1).min(1024).default(DEFAULT_MAX_QUERY_CHARS),
  readonly: z.boolean().default(false),
  persistConnections: z.boolean().default(true),
  clients: clientsSchema,
  connections: z.dict(z.object({
    type: z.union([
      z.const('mysql'), z.const('postgres'), z.const('sqlite'), z.const('oracle'), z.const('hive'),
      z.const('impala'), z.const('clickhouse'), z.const('doris'), z.const('sqlserver'),
    ]),
    host: z.string(),
    port: z.natural(),
    user: z.string(),
    database: z.string(),
    readonly: z.boolean(),
    secure: z.boolean(),
    passwordRef: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
    password: z.never().hidden(),
  })).default({}),
})

/**
 * Resolve the harness home the same way `@deepseek-ai/dsh-paths` does:
 * `$DSH_HOME` (non-blank) else `~/.dsh`, normalized absolute.
 */
export function resolveDshHome(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.DSH_HOME
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  return resolve(selected.startsWith('~/') ? join(homedir(), selected.slice(2)) : selected)
}

/**
 * Install the packaged `preset/data-agent/` directory into
 * `$DSH_HOME/.agent-presets/<presetId>/`. Idempotent: an existing target is
 * normally left untouched. Exact package-owned legacy compositions are
 * migrated once when their runtime contract changes; user-edited compositions
 * are never overwritten. `installPreset: false` never calls this. Best-effort
 * — a failure logs a warning with manual install instructions instead of
 * failing the boot.
 */
export async function installPreset(ctx: Context, presetId: string): Promise<boolean> {
  const targetDir = join(resolveDshHome(), '.agent-presets', presetId)
  const sourceDir = fileURLToPath(new URL('../preset/data-agent/', import.meta.url))
  try {
    await access(targetDir)
    return await synchronizeExistingPreset(ctx, targetDir, sourceDir, presetId)
  } catch {
    // Not present — fall through to install.
  }
  try {
    await mkdir(targetDir, { recursive: true })
    await cp(sourceDir, targetDir, { recursive: true })
    ctx.logger.info('data-agent: installed preset "%s" to %s', presetId, targetDir)
    return true
  } catch (error) {
    ctx.logger.warn(
      'data-agent: failed to install preset "%s" to %s (%s); '
      + 'copy preset/data-agent/ manually to enable the 数据模式 preset',
      presetId, targetDir, error instanceof Error ? error.message : String(error),
    )
    return false
  }
}

/** SHA-256 values of unmodified package-owned compositions safe to migrate. */
const LEGACY_MANAGED_PRESET_SHA256 = new Set([
  // 0.0.9: imported /tool and /command dynamically.
  'bae875a90d638ea78715030246b0f8a9f1a2c3359ca61febb6ceb59d0fcd930a',
  // 0.0.11 before HTML artifacts: described render-analysis as Web-only.
  'd3c6f4049580069eec1c6b7de101f12c7fb30482ad317434afb69afb08a91fc6',
  // 0.0.13 before the governance Catalog tools/persona contract.
  '11c4b5ef62c5934d1dc7133950bd78622dd68dc4e1075b5f24d0789011d6da9d',
  // 0.0.12: offline HTML persona, before the database dialect guidance.
  '1e42e007ad4cac04af95a67a5af1b7a0b02cc0f78e21d2da35461309db8dc9db',
  // 0.1.0–0.1.4: Catalog persona with only the legacy text config key.
  '2c5a8fc07dd49d0c10d6d10f0056da2d84575f47b47d4b28bc0e37f7d166413a',
])

/** Public for regression tests of the non-destructive preset migration gate. */
export function isLegacyManagedPreset(source: string): boolean {
  return LEGACY_MANAGED_PRESET_SHA256.has(createHash('sha256').update(source).digest('hex'))
}

/** Upgrade only exact package-owned legacy compositions; preserve every edited preset. */
async function synchronizeExistingPreset(
  ctx: Context,
  targetDir: string,
  sourceDir: string,
  presetId: string,
): Promise<boolean> {
  const composition = join(targetDir, 'agent.cordis.yml')
  try {
    const current = await readFile(composition, 'utf8')
    if (isLegacyManagedPreset(current)) {
      const replacement = await readFile(join(sourceDir, 'agent.cordis.yml'), 'utf8')
      await writeFile(composition, replacement, 'utf8')
      ctx.logger.info(
        'data-agent: migrated package-owned preset at %s to the current runtime contract',
        composition,
      )
      return true
    }
    if (current.includes('@yejiming/dsh-data-agent/tool') || current.includes('@yejiming/dsh-data-agent/command')) {
      ctx.logger.warn(
        'data-agent: user-edited preset at %s still imports /tool or /command dynamically; '
        + 'remove those rows so the profile-preloaded preset capabilities can activate in DSH Desktop',
        composition,
      )
      return false
    }
    ctx.logger.info('data-agent: preset "%s" already present at %s, skipping install', presetId, targetDir)
    return true
  } catch (error) {
    ctx.logger.warn(
      'data-agent: could not inspect existing preset %s (%s); it was not overwritten',
      composition,
      error instanceof Error ? error.message : String(error),
    )
    return false
  }
}

/** Exact profile-local package installation command used by diagnostics/docs. */
export function profileInstallCommand(profile: string): string {
  return `dsh plugin --profile ${profile} add @yejiming/dsh-data-agent`
}

/** Actionable diagnostic for a roster-visible preset whose profile lacks this package. */
export function missingProfileDependencyMessage(profile: string): string {
  return `data-agent preset is visible, but its profile-preloaded capabilities are absent from profile "${profile}". Run: ${profileInstallCommand(profile)}`
}

/** Tool configuration inherited by the profile-preloaded preset capabilities. */
type PresetCapabilitiesConfig = Pick<
  ToolConfig,
  'queryTimeoutMs' | 'maxResultChars' | 'maxRows' | 'maxQueryChars' | 'readonly' | 'clients'
>

/**
 * Register the statically imported database tools and surface adapters under the exact
 * standing key owned by the data-agent preset. Selecting the preset performs
 * no package import and only links the agent scope to this key.
 */
export async function mountPresetCapabilities(
  ctx: Context,
  key: ScopeKey,
  scopeTag: symbol,
  config: PresetCapabilitiesConfig,
  commandOptions: DataAgentCommandAdapterOptions = {},
): Promise<void> {
  // Do not call createScope() from this package. A linked/profile package may
  // resolve a second copy of dsh-scope while Desktop's registries use the copy
  // inside app.asar; their private symbols would differ and the registrations
  // would be mistaken for global ones. Reuse the exact tag from the standing
  // scope that AgentPresets created with the host singleton instead.
  const scoped = ctx.extend({ [scopeTag]: key })
  applyDatabaseTools(scoped, config)
  applyDatabaseCommand(scoped, commandOptions)
}

/** Install one scope's services on the Context seats consumers inject. */
function provideScope(ctx: Context, scope: DataAgentScope): void {
  ctx.provide('dataAgentConnections', scope.connections)
  ctx.provide('dataAgentCatalog', scope.catalog)
  ctx.provide('dataAgentCatalogScanner', scope.scanner)
  ctx.provide('dataAgentCatalogReview', scope.review)
}

/**
 * A service seat that names no account.
 *
 * Reading any member throws: an account-isolated deployment has no account-free
 * connection store or Catalog, and a caller reaching for one has skipped
 * `ctx.dataAgentAccounts`. A Proxy rather than an object literal so a member
 * added to the service later cannot silently become an unattributed seam.
 * Symbols and the promise/inspection probes Cordis and Node perform on any
 * provided value pass through to the empty target, because those are not
 * service use and must not fail a `ctx.provide` or a console inspection.
 * @param service - context property name, for the refusal message.
 * @returns a stand-in satisfying the service type.
 */
function accountGuard<T extends object>(service: string): T {
  const probes = new Set(['then', 'toJSON', 'inspect', 'constructor'])
  return new Proxy({} as T, {
    get(target, member, receiver) {
      if (typeof member === 'symbol' || probes.has(member)) return Reflect.get(target, member, receiver)
      throw new MissingPrincipalError(`ctx.${service}.${member}`)
    },
  })
}

/** Occupy the account-free seats on an isolated deployment so `ctx.inject` resolves. */
function provideAccountGuards(ctx: Context): void {
  ctx.provide('dataAgentConnections', accountGuard<DataAgentConnections>('dataAgentConnections'))
  ctx.provide('dataAgentCatalog', accountGuard<DataAgentCatalog>('dataAgentCatalog'))
  ctx.provide('dataAgentCatalogScanner', accountGuard<DataAgentCatalogScanner>('dataAgentCatalogScanner'))
  ctx.provide('dataAgentCatalogReview', accountGuard<DataAgentCatalogReview>('dataAgentCatalogReview'))
}

/**
 * Mount the tool half alone into one preset this package does not own.
 *
 * Deliberately narrower than {@link mountPresetCapabilities}: no `/database`
 * or `/catalog` command, and no inherited-tool restriction. A general-purpose
 * preset must keep every tool it already composes and merely gain SQL beside
 * them, whereas the owned data preset is a closed surface by design.
 * @param ctx - host Context that already provides the data-agent services.
 * @param presetId - an existing preset that should also reach the database.
 * @param config - the resolved tool-half settings.
 * @throws when the preset does not exist, rather than silently skipping it.
 */
export async function mountPresetTools(
  ctx: Context,
  presetId: string,
  config: PresetCapabilitiesConfig,
): Promise<void> {
  const key = await ctx.agentPresets.standingKeyFor(presetId)
  const scopeTag = await standingScopeTag(ctx, presetId, key)
  applyDatabaseTools(ctx.extend({ [scopeTag]: key }), config)
}

interface StandingScopeRecord {
  key: ScopeKey
  scope: { ctx: Context }
}

/** Read the host-owned scope tag from AgentPresets' already-created standing mount. */
async function standingScopeTag(ctx: Context, presetId: string, key: ScopeKey): Promise<symbol> {
  // AgentPresets intentionally exposes only the standing key. The cached scope
  // is the one host-owned object that also carries the singleton-private tag;
  // reading it avoids manufacturing an incompatible tag in linked profiles.
  const registry = ctx.agentPresets as unknown as {
    standing?: Map<string, Promise<StandingScopeRecord>>
  }
  const pending = registry.standing?.get(presetId)
  if (pending === undefined) {
    throw new Error(`data-agent: preset "${presetId}" has no standing scope after standingKeyFor()`)
  }
  const standing = await pending
  if (standing.key !== key) {
    throw new Error(`data-agent: preset "${presetId}" standing scope changed during profile preload`)
  }
  const tag = Object.getOwnPropertySymbols(standing.scope.ctx)
    .find(candidate => Reflect.get(standing.scope.ctx, candidate) === key)
  if (tag === undefined) {
    throw new Error(`data-agent: preset "${presetId}" standing context exposes no scope tag`)
  }
  return tag
}

/**
 * Mount the data-agent profile row: connection store, config-seeded
 * connections, preset installation, and profile-preloaded preset capabilities.
 * HTTP routes are the sibling `data-agent-routes` row (`./routes`).
 * @param ctx - host cordis context.
 * @param config - validated loader configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (config.catalogPageSize > config.catalogMaxPageSize) {
    throw new Error('data-agent: catalogPageSize cannot exceed catalogMaxPageSize')
  }
  const resolved: Required<Config> = {
    presetId: config.presetId,
    additionalToolPresets: config.additionalToolPresets,
    installPreset: config.installPreset,
    profileManagedPresets: config.profileManagedPresets,
    connectTimeoutMs: config.connectTimeoutMs,
    introspectMaxTables: config.introspectMaxTables,
    queryTimeoutMs: config.queryTimeoutMs,
    catalogQueryTimeoutMs: config.catalogQueryTimeoutMs,
    catalogMaxResultChars: config.catalogMaxResultChars,
    catalogSchemaConcurrency: config.catalogSchemaConcurrency,
    catalogAssetConcurrency: config.catalogAssetConcurrency,
    catalogMaxAssetsPerRun: config.catalogMaxAssetsPerRun,
    catalogMaxTextChars: config.catalogMaxTextChars,
    catalogPageSize: config.catalogPageSize,
    catalogMaxPageSize: config.catalogMaxPageSize,
    maxResultChars: config.maxResultChars,
    maxRows: config.maxRows,
    maxQueryChars: config.maxQueryChars,
    readonly: config.readonly,
    persistConnections: config.persistConnections,
    clients: config.clients,
    connections: config.connections,
  }

  if (resolved.profileManagedPresets && resolved.installPreset) {
    throw new Error('data-agent: profileManagedPresets requires installPreset=false')
  }
  if (resolved.additionalToolPresets.includes(resolved.presetId)) {
    throw new Error(`data-agent: additionalToolPresets repeats the owned preset "${resolved.presetId}"`)
  }
  const presetReady = resolved.installPreset
    ? await installPreset(ctx, resolved.presetId)
    : false

  if (!resolved.persistConnections) {
    ctx.logger.warn('data-agent: persistConnections=false; connection and Catalog state are process-local and cannot restore across Web/TUI')
  }

  // Config seeds remain runtime-only deployment defaults. They accept a
  // reference but never a real password and preserve wildcard fallback.
  const seeds: Record<string, DatabaseConnection> = {}
  for (const [sessionId, spec] of Object.entries(resolved.connections)) {
    seeds[sessionId] = {
      type: spec.type,
      database: spec.type === 'sqlite' ? resolve(process.cwd(), spec.database) : spec.database,
      ...spec.host !== undefined ? { host: spec.host } : {},
      ...spec.port !== undefined ? { port: spec.port } : {},
      ...spec.user !== undefined ? { user: spec.user } : {},
      ...spec.passwordRef !== undefined ? { passwordRef: spec.passwordRef } : {},
      ...spec.readonly !== undefined ? { readonly: spec.readonly } : {},
      ...spec.secure !== undefined ? { secure: spec.secure } : {},
    }
  }

  const accounts = createDataAgentAccounts(ctx, {
    connectTimeoutMs: resolved.connectTimeoutMs,
    queryTimeoutMs: resolved.queryTimeoutMs,
    catalogQueryTimeoutMs: resolved.catalogQueryTimeoutMs,
    catalogMaxResultChars: resolved.catalogMaxResultChars,
    maxResultChars: resolved.maxResultChars,
    maxQueryChars: resolved.maxQueryChars,
    introspectMaxTables: resolved.introspectMaxTables,
    readonly: resolved.readonly,
    clients: resolved.clients,
    catalogMaxAssetsPerRun: resolved.catalogMaxAssetsPerRun,
    catalogMaxTextChars: resolved.catalogMaxTextChars,
    catalogPageSize: resolved.catalogPageSize,
    catalogMaxPageSize: resolved.catalogMaxPageSize,
    catalogSchemaConcurrency: resolved.catalogSchemaConcurrency,
    catalogAssetConcurrency: resolved.catalogAssetConcurrency,
    persistConnections: resolved.persistConnections,
    seeds,
  }, resolved.persistConnections ? await ensureStorageDomain(ctx) : undefined)
  ctx.provide('dataAgentAccounts', accounts)

  // An unisolated deployment keeps the single account-free services it has
  // always had. An account-isolated one has no account-free instance to hand
  // out: every caller names its account through `ctx.dataAgentAccounts`, and
  // these seats exist only so `ctx.inject` still resolves.
  if (accounts.isolated()) {
    provideAccountGuards(ctx)
  } else {
    const shared = await accounts.forPrincipal(undefined, 'startup')
    provideScope(ctx, shared)
  }

  if (resolved.profileManagedPresets) {
    ctx.provide('dataAgentPresets', { ids: [resolved.presetId, ...resolved.additionalToolPresets] })
    return
  }

  const toolConfig: PresetCapabilitiesConfig = {
    queryTimeoutMs: resolved.queryTimeoutMs,
    maxResultChars: resolved.maxResultChars,
    maxRows: resolved.maxRows,
    maxQueryChars: resolved.maxQueryChars,
    readonly: resolved.readonly,
    clients: resolved.clients,
  }
  const mounted: string[] = []
  if (presetReady) {
    const standingKey = await ctx.agentPresets.standingKeyFor(resolved.presetId)
    const scopeTag = await standingScopeTag(ctx, resolved.presetId, standingKey)
    await mountPresetCapabilities(ctx, standingKey, scopeTag, toolConfig)
    mounted.push(resolved.presetId)
  }
  for (const presetId of resolved.additionalToolPresets) {
    if (presetId === resolved.presetId) {
      throw new Error(`data-agent: additionalToolPresets repeats the owned preset "${presetId}"`)
    }
    // Fails loud: a named preset that does not exist is a misconfiguration, and
    // silently skipping it would leave that preset's sessions with a Web
    // workbench control and no tool able to use the connection it makes.
    await mountPresetTools(ctx, presetId, toolConfig)
    mounted.push(presetId)
  }
  ctx.provide('dataAgentPresets', { ids: mounted })
}

/**
 * Reuse a surface-provided storage stack (Web) or mount the same JSON stack
 * when an interactive profile such as dsh-tui does not ship one.
 */
async function ensureStorageDomain(ctx: Context): Promise<Context['storageDomain']> {
  const existing = ctx.get('storageDomain')
  if (existing !== undefined) return existing

  ctx.logger.info('data-agent: storageDomain is absent; mounting the JSON storage stack for this profile')
  let storage = ctx.get('storage')
  if (storage === undefined) {
    await ctx.plugin(Storage)
    storage = ctx.get('storage')
  }
  if (storage === undefined) throw new Error('data-agent: failed to mount DSH storage hub')

  if (!storage.backend.names().includes('json')) {
    await ctx.plugin(storageJsonPlugin, { root: join(resolveDshHome(), 'storages') })
  }
  let facility = ctx.get('storageDomain')
  if (facility === undefined) {
    await ctx.plugin(storageDomainPlugin, { backend: 'json' })
    facility = ctx.get('storageDomain')
  }
  if (facility === undefined) throw new Error('data-agent: failed to mount DSH storage-domain facility')
  return facility
}
