/**
 * Account attribution for durable connection and Catalog state.
 *
 * A DSH deployment may serve several accounts from one Host process. A
 * connection profile names a real database, retains its credential reference,
 * and the agent can run `sql-write` and `sql-cmd` through it, so one account's
 * profiles, bindings, drafts and Catalog must never be reachable from another.
 *
 * Isolation is structural rather than filtered: each account owns a private
 * pair of storage domains and a private service instance (see `./accounts.ts`),
 * so no query path can return another account's record even if it forgets a
 * predicate. This module owns only the identity half — deciding whether the
 * deployment is account-isolated at all, and deriving the stable key that
 * selects an account's domains.
 *
 * A deployment is account-isolated exactly when it composes a
 * `requestPrincipal` provider (the authenticated Web gateway). A personal
 * Harness, dsh-tui, and the desktop application compose none and keep the
 * single shared store they have always had.
 * @module @yejiming/dsh-data-agent/owner
 */
import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
/**
 * The part of the Host's authenticated principal this package needs.
 *
 * Declared structurally because the public SDK does not expose this personal
 * deployment's authentication extension. The Host's verified principal is
 * assignable to these fields.
 */
export interface DataAgentPrincipal {
    readonly source: string;
    readonly id: string;
    readonly username?: string;
    readonly role?: string;
}
/**
 * Opaque per-account key selecting one account's storage domains.
 *
 * {@link LOCAL_OWNER_KEY} is not a key of this type: an unisolated deployment
 * uses the original unsuffixed domains, so the two cannot collide.
 */
export type OwnerKey = string;
/** Domain-name suffix marking the single store of an unisolated deployment. */
export declare const LOCAL_OWNER_KEY = "local";
/** Raised when an account-isolated deployment cannot attribute a call. */
export declare class MissingPrincipalError extends Error {
    /**
     * @param operation - operation name shown to the caller.
     */
    constructor(operation: string);
}
/**
 * Whether this deployment serves more than one account.
 *
 * Read live rather than cached at mount: the provider is composed by a sibling
 * plugin row whose activation order is not guaranteed, and a deployment that
 * gains authentication must not keep serving a shared store.
 * @param ctx - any Context on the Host tree.
 * @returns true when a request-authentication provider is composed.
 */
export declare function accountIsolated(ctx: Pick<Context, 'get'>): boolean;
/**
 * Derive the durable key of one principal.
 *
 * Both halves are hashed because ids are unique only within their source: two
 * identity providers may both issue `7`. The digest — not the raw identity —
 * becomes a storage-domain name, so an account id can never shape a file path.
 * @param principal - the authenticated principal.
 * @returns the 64-character hex key selecting this account's domains.
 * @throws MissingPrincipalError when the principal carries no usable identity.
 */
export declare function ownerKeyOf(principal: DataAgentPrincipal | undefined, operation: string): OwnerKey;
/**
 * Authenticate one HTTP or upgrade request through the deployment provider.
 * @param ctx - any Context on the Host tree.
 * @param request - the carrier request, which the provider reads headers from.
 * @param operation - operation name shown when authentication yields no identity.
 * @returns the authenticated principal.
 * @throws MissingPrincipalError when the provider is absent or returns none.
 */
export declare function requestPrincipal(ctx: Pick<Context, 'get'>, request: {
    headers: IncomingMessage['headers'];
}, operation: string): Promise<DataAgentPrincipal>;
/**
 * Recover the principal of the active Remote dispatch.
 *
 * Slash commands reach their handler through the Remote gateway, which binds
 * the verified caller to the dispatch's async context. `CommandInvocation`
 * itself carries no identity, so this is the only attribution a command has.
 * @param ctx - any Context on the Host tree.
 * @returns the dispatching principal, or undefined outside Remote dispatch.
 */
export declare function dispatchPrincipal(ctx: Pick<Context, 'get'>): DataAgentPrincipal | undefined;
