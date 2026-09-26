/**
 * Web adapter for the shared data-agent connection service.
 *
 * This entry owns only HTTP parsing/serialization. Connection validation,
 * credentials, persistence, metadata, query safety, and error semantics live
 * in `DataAgentConnections`, which is also consumed by TUI commands/tools.
 * @module @yejiming/dsh-data-agent/routes
 */
import type { Context } from '@deepseek-ai/cordis';
import type { DatabaseConnectionInput } from './connections.ts';
export declare const name = "data-agent-routes";
/** Headless profiles activate this row without waiting forever for webServer. */
export declare const inject: string[];
export declare const DATA_AGENT_PATH = "/plugins/data-agent";
/** Retained loader surface for backward compatibility; domain options live on the host row. */
export interface Config {
    connectTimeoutMs: number;
    introspectMaxTables: number;
    maxResultChars: number;
    queryTimeoutMs: number;
    maxQueryChars: number;
    readonly: boolean;
}
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
    connectTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    introspectMaxTables: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxResultChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    queryTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxQueryChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    readonly: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    connectTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    introspectMaxTables: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxResultChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    queryTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxQueryChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    readonly: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
}>>, "plain">;
export interface ConnectRequestBody extends DatabaseConnectionInput {
    sessionId: string;
}
/** Validate the Web wire shape while retaining temporary-password compatibility. */
export declare function validateConnectBody(value: unknown, cwd?: string): ConnectRequestBody;
/** Register Web routes only when both the webserver and shared service exist. */
export declare function apply(ctx: Context, _config: Config): void;
