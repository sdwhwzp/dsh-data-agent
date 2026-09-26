/**
 * The data-agent tool half (`@yejiming/dsh-data-agent/tool`): mounted ONLY by
 * the data-agent agent preset (`preset/data-agent/agent.cordis.yml`), never
 * by the host composition. It consumes the host's `subprocess` service and
 * the host-provided account, connection, and Catalog services, so it needs no
 * realm and satisfies the preset guard (a preset row that only consumes).
 *
 * Tool surface:
 * - `sql-query`: read-only statements, structured `{ columns, rows, ... }`;
 * - `sql-write`: one write/management statement per call, explicit autocommit;
 * - `sql-cmd`: the raw-terminal compatibility tool.
 *
 * Execution model (see `src/query.ts`): the SQL text travels on the client's
 * stdin, argv carries flags only, credentials go through environment entries
 * (`MYSQL_PWD` / `PGPASSWORD`), and the caller's signal plus an internal
 * deadline share one AbortController that drives the process-tree terminate
 * escalation. Output is bounded per stream and marked `truncated`.
 * @module @yejiming/dsh-data-agent/tool
 */
import type { Context } from '@deepseek-ai/cordis';
import { type ClientConfig } from './clients.ts';
/** Cordis plugin name (diagnostics only). */
export declare const name = "data-agent-tool";
/** Services required before the tool can register. */
export declare const inject: string[];
/** Tool-half configuration (loader schema with the same defaults as the host). */
export interface Config {
    /** Deadline for one sql-cmd / sql-query / sql-write query, milliseconds. */
    queryTimeoutMs: number;
    /** In-memory cap on captured output. */
    maxResultChars: number;
    /** Enforced read-query row cap (dialect rewrite + structured truncation). */
    maxRows: number;
    /** Maximum SQL text length accepted per dataset statement. */
    maxQueryChars: number;
    /** Read-only guard: true rejects write statements. */
    readonly: boolean;
    /** CLI client overrides keyed by database type. */
    clients: Partial<Record<string, ClientConfig>>;
}
/** Loader schema with deployment defaults (no library defaults). */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
    queryTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxResultChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxRows: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxQueryChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    readonly: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    clients: import("@deepseek-ai/schemastery").default<import("@deepseek-ai/cosmokit").Dict<{
        command?: string | null | undefined;
        args?: string[] | null | undefined;
        searchPaths?: string[] | null | undefined;
    } & import("cosmokit").Dict, "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "doris" | "sqlserver">, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        command: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        args: import("@deepseek-ai/schemastery").default<string[], string[], "plain">;
        searchPaths: import("@deepseek-ai/schemastery").default<string[], string[], "plain">;
    }>>, "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "doris" | "sqlserver">, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    queryTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxResultChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxRows: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    maxQueryChars: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    readonly: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    clients: import("@deepseek-ai/schemastery").default<import("@deepseek-ai/cosmokit").Dict<{
        command?: string | null | undefined;
        args?: string[] | null | undefined;
        searchPaths?: string[] | null | undefined;
    } & import("cosmokit").Dict, "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "doris" | "sqlserver">, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        command: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        args: import("@deepseek-ai/schemastery").default<string[], string[], "plain">;
        searchPaths: import("@deepseek-ai/schemastery").default<string[], string[], "plain">;
    }>>, "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "doris" | "sqlserver">, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
}>>, "plain">;
/**
 * Mount the data-agent database tools: `sql-query` (structured read-only),
 * `sql-write` (explicit write semantics), and `sql-cmd` (raw compatibility).
 * @param ctx - the preset-scoped agent context.
 * @param config - validated loader configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
