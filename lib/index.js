import { _ as clientsSchema, c as DEFAULT_CATALOG_MAX_RESULT_CHARS, d as DEFAULT_CONNECT_TIMEOUT_MS, f as DEFAULT_MAX_QUERY_CHARS, h as DEFAULT_QUERY_TIMEOUT_MS, l as DEFAULT_CATALOG_MAX_TEXT_CHARS, m as DEFAULT_PRESET_ID, p as DEFAULT_MAX_RESULT_CHARS, s as DEFAULT_CATALOG_MAX_ASSETS, u as DEFAULT_CATALOG_QUERY_TIMEOUT_MS } from "./connections-DduzJNBj.js";
import { n as MissingPrincipalError } from "./owner-kTkUtpJv.js";
import { t as createDataAgentAccounts } from "./accounts-T6KnP7CC.js";
import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryListProblem } from "@deepseek-ai/dsh-agent-preset-registry";
import Storage from "@deepseek-ai/dsh-storage";
import * as storageDomainPlugin from "@deepseek-ai/dsh-storage-domain";
import * as storageJsonPlugin from "@deepseek-ai/dsh-storage-json";
import z from "schemastery";
import yaml from "js-yaml";
//#region src/index.ts
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
/** Cordis plugin name (diagnostics only). */
const name = "data-agent";
/** Services required before the profile entry can mount its preset layer. */
const inject = [
	"agentPresets",
	"agents",
	"commands",
	"credentials",
	"llm",
	"subprocess",
	"tools"
];
/** Loader schema with deployment defaults (no library defaults). */
const Config = z.object({
	presetId: z.string().default(DEFAULT_PRESET_ID),
	additionalToolPresets: z.array(z.string()).default([]),
	installPreset: z.boolean().default(true),
	profileManagedPresets: z.boolean().default(false),
	connectTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_CONNECT_TIMEOUT_MS),
	introspectMaxTables: z.number().step(1).min(1).default(500),
	queryTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_QUERY_TIMEOUT_MS),
	catalogQueryTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_CATALOG_QUERY_TIMEOUT_MS),
	catalogMaxResultChars: z.number().step(1).min(1024).default(DEFAULT_CATALOG_MAX_RESULT_CHARS),
	catalogSchemaConcurrency: z.number().step(1).min(1).max(16).default(2),
	catalogAssetConcurrency: z.number().step(1).min(1).max(32).default(4),
	catalogMaxAssetsPerRun: z.number().step(1).min(1).max(1e6).default(DEFAULT_CATALOG_MAX_ASSETS),
	catalogMaxTextChars: z.number().step(1).min(256).max(4096).default(DEFAULT_CATALOG_MAX_TEXT_CHARS),
	catalogPageSize: z.number().step(1).min(1).max(200).default(50),
	catalogMaxPageSize: z.number().step(1).min(1).max(200).default(200),
	maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
	maxRows: z.number().step(1).min(1).default(100),
	maxQueryChars: z.number().step(1).min(1024).default(DEFAULT_MAX_QUERY_CHARS),
	readonly: z.boolean().default(false),
	persistConnections: z.boolean().default(true),
	clients: clientsSchema,
	connections: z.dict(z.object({
		type: z.union([
			z.const("mysql"),
			z.const("postgres"),
			z.const("sqlite"),
			z.const("oracle"),
			z.const("hive"),
			z.const("impala"),
			z.const("clickhouse"),
			z.const("doris"),
			z.const("sqlserver")
		]),
		host: z.string(),
		port: z.natural(),
		user: z.string(),
		database: z.string(),
		readonly: z.boolean(),
		secure: z.boolean(),
		passwordRef: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
		password: z.never().hidden()
	})).default({})
});
/**
* Resolve the harness home the same way `@deepseek-ai/dsh-paths` does:
* `$DSH_HOME` (non-blank) else `~/.dsh`, normalized absolute.
*/
function resolveDshHome(env = process.env) {
	const fromEnv = env.DSH_HOME;
	const selected = fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), ".dsh");
	return resolve(selected.startsWith("~/") ? join(homedir(), selected.slice(2)) : selected);
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
async function installPreset(ctx, presetId) {
	const targetDir = join(resolveDshHome(), ".agent-presets", presetId);
	const sourceDir = fileURLToPath(new URL("../preset/data-agent/", import.meta.url));
	try {
		await access(targetDir);
		return await synchronizeExistingPreset(ctx, targetDir, sourceDir, presetId);
	} catch {}
	try {
		await mkdir(targetDir, { recursive: true });
		await cp(sourceDir, targetDir, { recursive: true });
		ctx.logger.info("data-agent: installed preset \"%s\" to %s", presetId, targetDir);
		return true;
	} catch (error) {
		ctx.logger.warn("data-agent: failed to install preset \"%s\" to %s (%s); copy preset/data-agent/ manually to enable the 数据模式 preset", presetId, targetDir, error instanceof Error ? error.message : String(error));
		return false;
	}
}
/** SHA-256 values of unmodified package-owned compositions safe to migrate. */
const LEGACY_MANAGED_PRESET_SHA256 = /* @__PURE__ */ new Set([
	"899d351670bac68fdc385467cc71d646a0fc426c58f3dd8b181d679d1a9d5709",
	"bae875a90d638ea78715030246b0f8a9f1a2c3359ca61febb6ceb59d0fcd930a",
	"d3c6f4049580069eec1c6b7de101f12c7fb30482ad317434afb69afb08a91fc6",
	"11c4b5ef62c5934d1dc7133950bd78622dd68dc4e1075b5f24d0789011d6da9d",
	"1e42e007ad4cac04af95a67a5af1b7a0b02cc0f78e21d2da35461309db8dc9db",
	"2c5a8fc07dd49d0c10d6d10f0056da2d84575f47b47d4b28bc0e37f7d166413a"
]);
/** Public for regression tests of the non-destructive preset migration gate. */
function isLegacyManagedPreset(source) {
	return LEGACY_MANAGED_PRESET_SHA256.has(createHash("sha256").update(source).digest("hex"));
}
/** Upgrade only exact package-owned legacy compositions; preserve every edited preset. */
async function synchronizeExistingPreset(ctx, targetDir, sourceDir, presetId) {
	const composition = join(targetDir, "agent.cordis.yml");
	try {
		if (isLegacyManagedPreset(await readFile(composition, "utf8"))) {
			const replacement = await readFile(join(sourceDir, "agent.cordis.yml"), "utf8");
			await writeFile(composition, replacement, "utf8");
			ctx.logger.info("data-agent: migrated package-owned preset at %s to the current runtime contract", composition);
			return true;
		}
		ctx.logger.info("data-agent: preset \"%s\" already present at %s, skipping install", presetId, targetDir);
		return true;
	} catch (error) {
		ctx.logger.warn("data-agent: could not inspect existing preset %s (%s); it was not overwritten", composition, error instanceof Error ? error.message : String(error));
		return false;
	}
}
/** Exact profile-local package installation command used by diagnostics/docs. */
function profileInstallCommand(profile) {
	return `dsh plugin --profile ${profile} add @yejiming/dsh-data-agent`;
}
/** Actionable diagnostic for a roster-visible preset whose profile lacks this package. */
function missingProfileDependencyMessage(profile) {
	return `data-agent preset is visible, but its profile-preloaded capabilities are absent from profile "${profile}". Run: ${profileInstallCommand(profile)}`;
}
/**
* Declare the preset through the host registry. The registry owns its scope,
* revision lifetime and blank-session rebinding; no private scope tags are read.
* Absolute artifact URLs keep scoped entries beside this installed package even
* when the host and plugin use different module-resolution roots (Desktop).
*/
async function registerPreset(ctx, presetId, config) {
	const directory = join(resolveDshHome(), ".agent-presets", presetId);
	const plugins = yaml.load(await readFile(join(directory, "agent.cordis.yml"), "utf8"));
	const problem = entryListProblem(plugins, `data-agent preset ${presetId}`);
	if (problem !== void 0) throw new Error(problem);
	const metadata = yaml.load(await readFile(join(directory, "preset.yml"), "utf8"));
	if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error(`data-agent: preset "${presetId}" metadata must be an object`);
	const fields = metadata;
	for (const field of ["name", "description"]) if (fields[field] !== void 0 && typeof fields[field] !== "string") throw new Error(`data-agent: preset "${presetId}" ${field} must be a string`);
	if (fields.order !== void 0 && (typeof fields.order !== "number" || !Number.isFinite(fields.order))) throw new Error(`data-agent: preset "${presetId}" order must be a finite number`);
	const rows = plugins.map((row) => ({ ...row }));
	for (const [entry, entryConfig] of [["tool", config], ["command", void 0]]) {
		const specifier = `@yejiming/dsh-data-agent/${entry}`;
		const existing = rows.find((row) => row.name === specifier);
		const name = new URL(`./${entry}.js`, import.meta.url).href;
		if (existing !== void 0) existing.name = name;
		else rows.push({
			id: `data-agent-${entry}`,
			name,
			...entryConfig === void 0 ? {} : { config: entryConfig }
		});
	}
	const dispose = await ctx.agentPresets.register({
		id: presetId,
		...typeof fields.name === "string" ? { name: fields.name } : {},
		...typeof fields.description === "string" ? { description: fields.description } : {},
		...typeof fields.order === "number" ? { order: fields.order } : {},
		plugins: rows
	});
	ctx.effect(() => dispose, "data-agent: unregister preset definition");
}
/** Install one scope's services on the Context seats consumers inject. */
function provideScope(ctx, scope) {
	ctx.provide("dataAgentConnections", scope.connections);
	ctx.provide("dataAgentCatalog", scope.catalog);
	ctx.provide("dataAgentCatalogScanner", scope.scanner);
	ctx.provide("dataAgentCatalogReview", scope.review);
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
function accountGuard(service) {
	const probes = /* @__PURE__ */ new Set([
		"then",
		"toJSON",
		"inspect",
		"constructor"
	]);
	return new Proxy({}, { get(target, member, receiver) {
		if (typeof member === "symbol" || probes.has(member)) return Reflect.get(target, member, receiver);
		throw new MissingPrincipalError(`ctx.${service}.${member}`);
	} });
}
/** Occupy the account-free seats on an isolated deployment so `ctx.inject` resolves. */
function provideAccountGuards(ctx) {
	ctx.provide("dataAgentConnections", accountGuard("dataAgentConnections"));
	ctx.provide("dataAgentCatalog", accountGuard("dataAgentCatalog"));
	ctx.provide("dataAgentCatalogScanner", accountGuard("dataAgentCatalogScanner"));
	ctx.provide("dataAgentCatalogReview", accountGuard("dataAgentCatalogReview"));
}
/**
* Mount the data-agent profile row: connection store, config-seeded
* connections, preset installation, and registry-owned preset capabilities.
* HTTP routes are the sibling `data-agent-routes` row (`./routes`).
* @param ctx - host cordis context.
* @param config - validated loader configuration.
*/
async function apply(ctx, config) {
	if (config.catalogPageSize > config.catalogMaxPageSize) throw new Error("data-agent: catalogPageSize cannot exceed catalogMaxPageSize");
	const resolved = {
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
		connections: config.connections
	};
	if (resolved.profileManagedPresets && resolved.installPreset) throw new Error("data-agent: profileManagedPresets requires installPreset=false");
	if (resolved.additionalToolPresets.includes(resolved.presetId)) throw new Error(`data-agent: additionalToolPresets repeats the owned preset "${resolved.presetId}"`);
	if (!resolved.profileManagedPresets && resolved.additionalToolPresets.length > 0) throw new Error("data-agent: additionalToolPresets requires profileManagedPresets=true and declarative /tool rows");
	const presetReady = resolved.installPreset ? await installPreset(ctx, resolved.presetId) : false;
	if (!resolved.persistConnections) ctx.logger.warn("data-agent: persistConnections=false; connection and Catalog state are process-local and cannot restore across Web/TUI");
	const seeds = {};
	for (const [sessionId, spec] of Object.entries(resolved.connections)) seeds[sessionId] = {
		type: spec.type,
		database: spec.type === "sqlite" ? resolve(process.cwd(), spec.database) : spec.database,
		...spec.host !== void 0 ? { host: spec.host } : {},
		...spec.port !== void 0 ? { port: spec.port } : {},
		...spec.user !== void 0 ? { user: spec.user } : {},
		...spec.passwordRef !== void 0 ? { passwordRef: spec.passwordRef } : {},
		...spec.readonly !== void 0 ? { readonly: spec.readonly } : {},
		...spec.secure !== void 0 ? { secure: spec.secure } : {}
	};
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
		seeds
	}, resolved.persistConnections ? await ensureStorageDomain(ctx) : void 0);
	ctx.provide("dataAgentAccounts", accounts);
	if (accounts.isolated()) provideAccountGuards(ctx);
	else provideScope(ctx, await accounts.forPrincipal(void 0, "startup"));
	if (resolved.profileManagedPresets) {
		ctx.provide("dataAgentPresets", { ids: [resolved.presetId, ...resolved.additionalToolPresets] });
		return;
	}
	const toolConfig = {
		queryTimeoutMs: resolved.queryTimeoutMs,
		maxResultChars: resolved.maxResultChars,
		maxRows: resolved.maxRows,
		maxQueryChars: resolved.maxQueryChars,
		readonly: resolved.readonly,
		clients: resolved.clients
	};
	const mounted = [];
	if (presetReady) {
		await registerPreset(ctx, resolved.presetId, toolConfig);
		mounted.push(resolved.presetId);
	}
	ctx.provide("dataAgentPresets", { ids: mounted });
}
/**
* Reuse a surface-provided storage stack (Web) or mount the same JSON stack
* when an interactive profile such as dsh-tui does not ship one.
*/
async function ensureStorageDomain(ctx) {
	const existing = ctx.get("storageDomain");
	if (existing !== void 0) return existing;
	ctx.logger.info("data-agent: storageDomain is absent; mounting the JSON storage stack for this profile");
	let storage = ctx.get("storage");
	if (storage === void 0) {
		await ctx.plugin(Storage);
		storage = ctx.get("storage");
	}
	if (storage === void 0) throw new Error("data-agent: failed to mount DSH storage hub");
	if (!storage.backend.names().includes("json")) await ctx.plugin(storageJsonPlugin, { root: join(resolveDshHome(), "storages") });
	let facility = ctx.get("storageDomain");
	if (facility === void 0) {
		await ctx.plugin(storageDomainPlugin, { backend: "json" });
		facility = ctx.get("storageDomain");
	}
	if (facility === void 0) throw new Error("data-agent: failed to mount DSH storage-domain facility");
	return facility;
}
//#endregion
export { Config, apply, inject, installPreset, isLegacyManagedPreset, missingProfileDependencyMessage, name, profileInstallCommand, registerPreset, resolveDshHome };
