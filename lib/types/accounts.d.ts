/**
 * Per-account service scopes for an authenticated deployment.
 *
 * One account's connection profiles, session bindings, form drafts, live
 * connections and Catalog live in a scope of their own: a private pair of
 * storage domains plus the connection and Catalog services built on them.
 * Nothing is shared between scopes, so a caller holding another account's
 * session id, profile id or Catalog source id reads an empty store rather than
 * a foreign record — cross-account access is absent from the medium, not
 * filtered out of a result.
 *
 * A deployment without a `requestPrincipal` provider is not account-isolated
 * (personal Harness, dsh-tui, desktop). It keeps one shared scope over the
 * original unsuffixed domains, so its stored state and behavior are unchanged.
 * @module @yejiming/dsh-data-agent/accounts
 */
import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage } from 'node:http';
import { type DataAgentCatalog, type DataAgentCatalogReview, type DataAgentCatalogScanner } from './catalog.ts';
import type { ClientConfig } from './clients.ts';
import { type DataAgentConnections, type DatabaseConnection } from './connections.ts';
import { type DataAgentPrincipal } from './owner.ts';
/** Everything one account may reach. Never shared with another scope. */
export interface DataAgentScope {
    /** Connection store private to this account. */
    readonly connections: DataAgentConnections;
    /** Catalog read face private to this account. */
    readonly catalog: DataAgentCatalog;
    /** Catalog scan control private to this account. */
    readonly scanner: DataAgentCatalogScanner;
    /** Catalog human-review face private to this account. */
    readonly review: DataAgentCatalogReview;
}
/** Settings a scope's services need, resolved once by the host row. */
export interface DataAgentScopeOptions {
    connectTimeoutMs: number;
    queryTimeoutMs: number;
    catalogQueryTimeoutMs: number;
    catalogMaxResultChars: number;
    maxResultChars: number;
    maxQueryChars: number;
    introspectMaxTables: number;
    readonly: boolean;
    clients: Partial<Record<string, ClientConfig>>;
    catalogMaxAssetsPerRun: number;
    catalogMaxTextChars: number;
    catalogPageSize: number;
    catalogMaxPageSize: number;
    catalogSchemaConcurrency: number;
    catalogAssetConcurrency: number;
    /** Durable storage; false keeps every scope process-local. */
    persistConnections: boolean;
    /** Deployment connection seeds applied to every scope; never a real password. */
    seeds: Readonly<Record<string, DatabaseConnection>>;
}
/** Resolve the account owning each call, then serve it only its own scope. */
export interface DataAgentAccounts {
    /** Whether this deployment authenticates requests and therefore isolates accounts. */
    isolated(): boolean;
    /**
     * The scope of one already-authenticated principal.
     * @param principal - the verified caller, or undefined on an unisolated deployment.
     * @param operation - operation name shown when the call cannot be attributed.
     * @returns that account's scope.
     * @throws MissingPrincipalError when isolation is required and no identity was supplied.
     */
    forPrincipal(principal: DataAgentPrincipal | undefined, operation: string): Promise<DataAgentScope>;
    /**
     * The scope of one HTTP or upgrade request, authenticated here.
     * @param request - the carrier request whose headers carry the credential.
     * @param operation - operation name shown when authentication yields no identity.
     * @returns that account's scope.
     * @throws MissingPrincipalError when isolation is required and the request is anonymous.
     */
    forRequest(request: {
        headers: IncomingMessage['headers'];
    }, operation: string): Promise<DataAgentScope>;
    /**
     * The scope of the account that requested one model step.
     * @param execution - the tool execution, which carries the step's principal.
     * @param operation - operation name shown when the step carries no identity.
     * @returns that account's scope.
     * @throws MissingPrincipalError when isolation is required and the step is unattributed.
     */
    forExecution(execution: {
        principal?: DataAgentPrincipal;
    }, operation: string): Promise<DataAgentScope>;
    /**
     * The scope of the account driving the active Remote dispatch (slash commands).
     * @param operation - operation name shown when no dispatch identity is available.
     * @returns that account's scope.
     * @throws MissingPrincipalError when isolation is required and the dispatch is unattributed.
     */
    forDispatch(operation: string): Promise<DataAgentScope>;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Per-account data-agent scopes; see `@yejiming/dsh-data-agent/accounts`. */
        dataAgentAccounts: DataAgentAccounts;
    }
}
/**
 * Build the account resolver and its scope cache.
 *
 * Domains open lazily on an account's first call and stay open for the life of
 * the plugin: a scope owns live database connections and running Catalog scans,
 * so it cannot be discarded between requests.
 * @param ctx - the host row's Context, which owns storage and disposal.
 * @param options - resolved settings shared by every scope.
 * @param openDomain - opens one declared storage domain.
 * @returns the accounts service.
 */
export declare function createDataAgentAccounts(ctx: Context, options: DataAgentScopeOptions, openDomain: Context['storageDomain'] | undefined): DataAgentAccounts;
/**
 * The account scope owning one tool execution.
 *
 * A personal-Harness build carries the transport-verified principal of the
 * model step through tool dispatch; the public SDK's `ToolRunContext` does not
 * declare that deployment extension, so it is read structurally. An isolated
 * deployment refuses an unattributed execution rather than serving a shared
 * store.
 * @param ctx - the tool row's Context.
 * @param execution - the running tool execution.
 * @param toolName - tool name shown when the execution cannot be attributed.
 * @returns that account's scope.
 * @throws MissingPrincipalError when isolation is required and the step is unattributed.
 */
export declare function executionScope(ctx: Pick<Context, 'dataAgentAccounts'>, execution: object, toolName: string): Promise<DataAgentScope>;
/**
 * An accounts service that serves one fixed scope to every caller.
 *
 * For compositions that own their services directly and have exactly one
 * account: focused tests, and embedders that build the connection and Catalog
 * services themselves. A deployment serving several accounts must use
 * {@link createDataAgentAccounts}, which authenticates each call.
 * @param scope - the single scope every caller receives.
 * @returns an accounts service over that scope.
 */
export declare function fixedDataAgentAccounts(scope: DataAgentScope): DataAgentAccounts;
