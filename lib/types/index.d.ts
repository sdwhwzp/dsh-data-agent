/**
 * Data Agent profile entry. The host row provides the
 * `dataAgentConnections` service (shared non-secret profile/binding storage;
 * temporary passwords stay process-local), seeds config connections (`connections`, `'*'` =
 * wildcard default), provides a separate versioned governance Catalog, installs the `data-agent` agent preset into
 * `$DSH_HOME/.agent-presets/`, and declares its preset-scoped database tools
 * on every surface, while registering `/database` and `/catalog` only while
 * the current Cordis composition actually loads the dsh-tui plugin.
 *
 * The HTTP routes live in the separate `./routes` entry
 * (`@yejiming/dsh-data-agent/routes`, cordis row `data-agent-routes`) so
 * this row keeps working in headless profiles without a webserver. The
 * database implementations still have public `./tool` and `./command`
 * exports. The preset registry loads them from absolute URLs beside this
 * artifact, so scoped activation never relies on resolving this package
 * again from a different host module root.
 * @module @yejiming/dsh-data-agent
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Preset ids whose sessions carry the database tools.
 *
 * One home for the fact: the host row decides it from config, and the sibling
 * routes row serves it to the browser so the Web workbench control appears in
 * exactly the sessions that can actually run SQL.
 */
export interface DataAgentPresets {
    /** Preset ids with the tool half mounted, owned preset first. */
    readonly ids: readonly string[];
}
/** The `dataAgentConnections` service face on the cordis context. */
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Preset ids whose sessions carry the database tools. */
        dataAgentPresets: DataAgentPresets;
        dataAgentConnections: DataAgentConnections;
        dataAgentCatalog: DataAgentCatalog;
        dataAgentCatalogScanner: DataAgentCatalogScanner;
        dataAgentCatalogReview: DataAgentCatalogReview;
    }
}
import { type DataAgentConnections, type DatabaseType } from './connections.ts';
import { type CliDatabaseType, type ClientConfig } from './clients.ts';
import { type DataAgentCatalog, type DataAgentCatalogReview, type DataAgentCatalogScanner } from './catalog.ts';
import type { Config as ToolConfig } from './tool.ts';
export type { CatalogServiceBundle, CatalogServiceOptions, CatalogStatusSummary, DataAgentCatalog, DataAgentCatalogReview, DataAgentCatalogScanner, StartCatalogScanInput, } from './catalog.ts';
export type { CatalogAssetDetail, CatalogAssetHead, CatalogAssetKind, CatalogAssetRevision, CatalogAssetStatus, CatalogCapability, CatalogDiffItem, CatalogDiffKind, CatalogDiffPage, CatalogEnrichment, CatalogEnrichmentStatus, CatalogIdentity, CatalogObservation, CatalogProgress, CatalogRelation, CatalogRun, CatalogRunStatus, CatalogScope, CatalogSearchFilters, CatalogSearchItem, CatalogSearchPage, CatalogSearchRequest, CatalogSemanticEntry, CatalogSemanticKind, CatalogSemanticRevision, CatalogSemanticStatus, CatalogSource, CatalogTechnicalPayload, MetricDefinition, MeaningDefinition, SemanticDefinition, TermDefinition, } from './catalog-types.ts';
/** Cordis plugin name (diagnostics only). */
export declare const name = "data-agent";
/** Services required before the profile entry can mount its preset layer. */
export declare const inject: string[];
/** Deployment overrides for one database type's CLI client. */
export type ClientsConfig = Partial<Record<CliDatabaseType, ClientConfig>>;
/**
 * One config-seeded connection. Deliberately password-free: passwords are a
 * memory-only / connect-time value, so only the /connect route may carry one.
 * The key `'*'` seeds the wildcard default used by any session without its
 * own connection (headless/keyless runs, deployments pinning one database).
 */
export interface SeededConnectionConfig {
    type: DatabaseType;
    host?: string;
    port?: number;
    user?: string;
    database: string;
    /** Optional per-seed read-only guard. */
    readonly?: boolean;
    /** ClickHouse only: use HTTPS with certificate verification. */
    secure?: boolean;
    /** Safe credential reference. Real passwords are rejected by the schema. */
    passwordRef?: string;
    password?: never;
}
/** Required plugin configuration (loader schema with deployment defaults). */
export interface Config {
    /** Preset directory name installed under `$DSH_HOME/.agent-presets/`. */
    presetId: string;
    /**
     * Further preset ids whose sessions also receive the database tools.
     *
     * The profile must declare a /tool row in each named preset and enable
     * profileManagedPresets; this package installs and owns only
     * {@link Config.presetId}. These presets receive the tool half ALONE — not
     * the `/database` and `/catalog` commands, and not the inherited-tool
     * restriction that makes the owned preset a closed data surface — so a
     * general-purpose preset keeps its own tools and gains SQL beside them.
     */
    additionalToolPresets: string[];
    /** Whether to self-install the preset on startup (idempotent). */
    installPreset: boolean;
    /** The profile declares preset /tool and /command rows instead of legacy standing mounts. */
    profileManagedPresets: boolean;
    /** Deadline for one /connect connectivity check, milliseconds. */
    connectTimeoutMs: number;
    /** Cap on the table list returned by /connect and /status. */
    introspectMaxTables: number;
    /** Deadline for one database-tool query, milliseconds. */
    queryTimeoutMs: number;
    /** Deadline for one package-owned system-catalog metadata query. */
    catalogQueryTimeoutMs: number;
    /** Per-stream capture budget for one package-owned system-catalog query. */
    catalogMaxResultChars: number;
    /** Maximum schemas and table/view details processed concurrently. */
    catalogSchemaConcurrency: number;
    catalogAssetConcurrency: number;
    /** Hard technical asset bound for one scan. */
    catalogMaxAssetsPerRun: number;
    /** Maximum normalized database/human text field length. */
    catalogMaxTextChars: number;
    /** Default and maximum Catalog list/detail page sizes. */
    catalogPageSize: number;
    catalogMaxPageSize: number;
    /** In-memory cap on database-tool captured output. */
    maxResultChars: number;
    /** Maximum structured rows returned by one database read tool call. */
    maxRows: number;
    /** Maximum SQL text accepted by the shared Web query adapter. */
    maxQueryChars: number;
    /** Default read-only guard: true rejects write statements in database tools and /query. */
    readonly: boolean;
    /** Persist non-secret profiles/bindings through DSH storage-domain. */
    persistConnections: boolean;
    /** CLI client overrides keyed by database type. */
    clients: ClientsConfig;
    /** Config-seeded connections keyed by session id (`'*'` = wildcard default). */
    connections: Record<string, SeededConnectionConfig>;
}
/** Loader schema with deployment defaults (no library defaults). */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
    presetId: import("@deepseek-ai/schemastery").default<string, string, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    additionalToolPresets: import("@deepseek-ai/schemastery").default<string[], string[], Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    installPreset: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    profileManagedPresets: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    connectTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    introspectMaxTables: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    queryTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogQueryTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogMaxResultChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogSchemaConcurrency: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogAssetConcurrency: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogMaxAssetsPerRun: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogMaxTextChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogPageSize: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogMaxPageSize: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxResultChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxRows: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxQueryChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    readonly: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    persistConnections: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    clients: import("@deepseek-ai/schemastery").default<import("@deepseek-ai/cosmokit").Dict<{
        command?: string | null | undefined;
        args?: string[] | null | undefined;
        searchPaths?: string[] | null | undefined;
    } & import("cosmokit").Dict, "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "doris" | "sqlserver">, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        command: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        args: import("@deepseek-ai/schemastery").default<string[], string[], "plain">;
        searchPaths: import("@deepseek-ai/schemastery").default<string[], string[], "plain">;
    }>>, "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "doris" | "sqlserver">, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    connections: import("@deepseek-ai/schemastery").default<import("@deepseek-ai/cosmokit").Dict<{
        type?: "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver" | null | undefined;
        host?: string | null | undefined;
        port?: number | null | undefined;
        user?: string | null | undefined;
        database?: string | null | undefined;
        readonly?: boolean | null | undefined;
        secure?: boolean | null | undefined;
        passwordRef?: string | null | undefined;
        password?: null | undefined;
    } & import("cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        type: import("@deepseek-ai/schemastery").default<"mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver", "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver", "plain">;
        host: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        port: import("@deepseek-ai/schemastery").default<number, number, "plain">;
        user: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        database: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        readonly: import("@deepseek-ai/schemastery").default<boolean, boolean, "plain">;
        secure: import("@deepseek-ai/schemastery").default<boolean, boolean, "plain">;
        passwordRef: import("@deepseek-ai/schemastery").default<string, string, Mode>;
        password: import("@deepseek-ai/schemastery").default<never, never, Mode>;
    }>>, string>, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    presetId: import("@deepseek-ai/schemastery").default<string, string, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    additionalToolPresets: import("@deepseek-ai/schemastery").default<string[], string[], Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    installPreset: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    profileManagedPresets: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    connectTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    introspectMaxTables: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    queryTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogQueryTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogMaxResultChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogSchemaConcurrency: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogAssetConcurrency: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogMaxAssetsPerRun: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogMaxTextChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogPageSize: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    catalogMaxPageSize: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxResultChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxRows: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxQueryChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    readonly: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    persistConnections: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    clients: import("@deepseek-ai/schemastery").default<import("@deepseek-ai/cosmokit").Dict<{
        command?: string | null | undefined;
        args?: string[] | null | undefined;
        searchPaths?: string[] | null | undefined;
    } & import("cosmokit").Dict, "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "doris" | "sqlserver">, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        command: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        args: import("@deepseek-ai/schemastery").default<string[], string[], "plain">;
        searchPaths: import("@deepseek-ai/schemastery").default<string[], string[], "plain">;
    }>>, "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "doris" | "sqlserver">, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    connections: import("@deepseek-ai/schemastery").default<import("@deepseek-ai/cosmokit").Dict<{
        type?: "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver" | null | undefined;
        host?: string | null | undefined;
        port?: number | null | undefined;
        user?: string | null | undefined;
        database?: string | null | undefined;
        readonly?: boolean | null | undefined;
        secure?: boolean | null | undefined;
        passwordRef?: string | null | undefined;
        password?: null | undefined;
    } & import("cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        type: import("@deepseek-ai/schemastery").default<"mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver", "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver", "plain">;
        host: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        port: import("@deepseek-ai/schemastery").default<number, number, "plain">;
        user: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        database: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        readonly: import("@deepseek-ai/schemastery").default<boolean, boolean, "plain">;
        secure: import("@deepseek-ai/schemastery").default<boolean, boolean, "plain">;
        passwordRef: import("@deepseek-ai/schemastery").default<string, string, Mode>;
        password: import("@deepseek-ai/schemastery").default<never, never, Mode>;
    }>>, string>, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
}>>, "plain">;
/**
 * Resolve the harness home the same way `@deepseek-ai/dsh-paths` does:
 * `$DSH_HOME` (non-blank) else `~/.dsh`, normalized absolute.
 */
export declare function resolveDshHome(env?: Record<string, string | undefined>): string;
/**
 * Install the packaged `preset/data-agent/` directory into
 * `$DSH_HOME/.agent-presets/<presetId>/`. Idempotent: an existing target is
 * normally left untouched. Exact package-owned legacy compositions are
 * migrated once when their runtime contract changes; user-edited compositions
 * are never overwritten. `installPreset: false` never calls this. Best-effort
 * — a failure logs a warning with manual install instructions instead of
 * failing the boot.
 */
export declare function installPreset(ctx: Context, presetId: string): Promise<boolean>;
/** Public for regression tests of the non-destructive preset migration gate. */
export declare function isLegacyManagedPreset(source: string): boolean;
/** Exact profile-local package installation command used by diagnostics/docs. */
export declare function profileInstallCommand(profile: string): string;
/** Actionable diagnostic for a roster-visible preset whose profile lacks this package. */
export declare function missingProfileDependencyMessage(profile: string): string;
/** Tool configuration inherited by the registry-owned preset capabilities. */
type PresetCapabilitiesConfig = Pick<ToolConfig, 'queryTimeoutMs' | 'maxResultChars' | 'maxRows' | 'maxQueryChars' | 'readonly' | 'clients'>;
/**
 * Declare the preset through the host registry. The registry owns its scope,
 * revision lifetime and blank-session rebinding; no private scope tags are read.
 * Absolute artifact URLs keep scoped entries beside this installed package even
 * when the host and plugin use different module-resolution roots (Desktop).
 */
export declare function registerPreset(ctx: Context, presetId: string, config: PresetCapabilitiesConfig): Promise<void>;
/**
 * Mount the data-agent profile row: connection store, config-seeded
 * connections, preset installation, and registry-owned preset capabilities.
 * HTTP routes are the sibling `data-agent-routes` row (`./routes`).
 * @param ctx - host cordis context.
 * @param config - validated loader configuration.
 */
export declare function apply(ctx: Context, config: Config): Promise<void>;
