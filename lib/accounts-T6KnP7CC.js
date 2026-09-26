import { b as DATABASE_TYPES, t as createConnectionService } from "./connections-DduzJNBj.js";
import { a as ownerKeyOf, b as catalogSourceSchema, c as createCatalogService, d as catalogDateTimeSchema, f as catalogObservationSchema, g as catalogSearchItemSchema, i as dispatchPrincipal, l as catalogAssetHeadSchema, m as catalogRunSchema, n as MissingPrincipalError, o as requestPrincipal, p as catalogRelationSchema, r as accountIsolated, t as LOCAL_OWNER_KEY, u as catalogAssetRevisionSchema, v as catalogSemanticEntrySchema, y as catalogSemanticRevisionSchema } from "./owner-kTkUtpJv.js";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
//#region src/catalog-ai.ts
const MAX_MODEL_OUTPUT_CHARS = 65536;
const MAX_MODEL_OUTPUT_TOKENS = 16384;
var CatalogModelOutputTruncatedError = class extends Error {
	constructor() {
		super("Catalog AI meaning output was truncated by the model token limit");
		this.name = "CatalogModelOutputTruncatedError";
	}
};
const modelResultSchema = z.strictObject({
	table: z.strictObject({
		assetId: z.string().min(1).max(256),
		meaning: z.string().trim().min(1).max(4096)
	}),
	fields: z.array(z.strictObject({
		assetId: z.string().min(1).max(256),
		meaning: z.string().trim().min(1).max(4096)
	})).max(512)
});
/** Resolve the exact current session model once, then use the host's configured LLM adapters and credentials. */
function createDshCatalogMeaningGenerator(agents, llm) {
	return {
		capture(sessionId) {
			const agent = agents.get(sessionId);
			if (agent === void 0) throw new Error("Catalog scan requires a live DSH session to use its configured AI model");
			const configured = agent.session.requestHeader()?.config;
			const provider = configured?.provider ?? agent.options.provider;
			const model = configured?.model ?? agent.options.model;
			if (provider === void 0 || provider.trim().length === 0 || model === void 0 || model.trim().length === 0) throw new Error("Catalog scan requires the current DSH session to have a configured AI model");
			return {
				provider,
				model,
				...configured?.reasoningEffort !== void 0 ? { reasoningEffort: configured.reasoningEffort } : {}
			};
		},
		async generate(selection, input, signal) {
			return generateCompleteModelResult(llm, selection, input, signal);
		}
	};
}
async function generateCompleteModelResult(llm, selection, input, signal) {
	try {
		return await generateModelBatch(llm, selection, input, signal);
	} catch (error) {
		if (!(error instanceof CatalogModelOutputTruncatedError)) throw error;
		if (input.fields.length <= 1) throw new Error("Catalog AI meaning output remained truncated after retrying a single-field batch");
		const middle = Math.ceil(input.fields.length / 2);
		const batches = [input.fields.slice(0, middle), input.fields.slice(middle)];
		const results = [];
		for (const fields of batches) {
			signal.throwIfAborted();
			results.push(await generateCompleteModelResult(llm, selection, sliceTableInput(input, fields), signal));
		}
		return {
			table: results[0].table,
			fields: results.flatMap((result) => result.fields)
		};
	}
}
async function generateModelBatch(llm, selection, input, signal) {
	const config = {
		provider: selection.provider,
		model: selection.model,
		...selection.reasoningEffort !== void 0 ? { reasoningEffort: selection.reasoningEffort } : {},
		maxTokens: MAX_MODEL_OUTPUT_TOKENS
	};
	const prepared = await llm.prepareCall(config, signal);
	const message = {
		role: "user",
		content: [{
			type: "text",
			text: JSON.stringify(input)
		}]
	};
	let output = "";
	let finished = false;
	for await (const chunk of prepared.stream({
		...prepared.config,
		messages: [message],
		system: CATALOG_MEANING_SYSTEM_PROMPT,
		signal
	})) {
		signal.throwIfAborted();
		if (chunk.type === "text-delta") {
			output += chunk.text;
			if (output.length > MAX_MODEL_OUTPUT_CHARS) throw new Error("Catalog AI meaning output exceeded the configured bound");
			continue;
		}
		if (chunk.type !== "finish") continue;
		finished = true;
		if (chunk.reason.kind === "error" || chunk.reason.kind === "aborted") throw new Error(`Catalog AI meaning generation failed: ${chunk.reason.failure.message}`);
		if (chunk.reason.kind === "max-tokens") throw new CatalogModelOutputTruncatedError();
		if (chunk.reason.kind !== "stop") throw new Error(`Catalog AI meaning generation stopped unexpectedly: ${chunk.reason.kind}`);
	}
	if (!finished) throw new Error("Catalog AI meaning generation ended without a finish event");
	return validateModelResult(output, input);
}
function sliceTableInput(input, fields) {
	const fieldIds = new Set(fields.map((field) => field.assetId));
	return {
		...input,
		fields,
		relations: input.relations.filter((relation) => relation.columnAssetIds.length === 0 || relation.columnAssetIds.some((assetId) => fieldIds.has(assetId)))
	};
}
function validateModelResult(raw, input) {
	const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	const first = text.indexOf("{");
	const last = text.lastIndexOf("}");
	if (first < 0 || last <= first) throw new Error("Catalog AI meaning output was not a JSON object");
	let decoded;
	try {
		decoded = JSON.parse(text.slice(first, last + 1));
	} catch {
		throw new Error("Catalog AI meaning output contained invalid JSON");
	}
	const result = modelResultSchema.parse(decoded);
	if (result.table.assetId !== input.assetId) throw new Error("Catalog AI meaning output referenced an unknown table asset");
	const expected = new Set(input.fields.map((field) => field.assetId));
	const returned = /* @__PURE__ */ new Set();
	for (const field of result.fields) {
		if (!expected.has(field.assetId)) throw new Error(`Catalog AI meaning output referenced an unknown field asset: ${field.assetId}`);
		if (returned.has(field.assetId)) throw new Error(`Catalog AI meaning output repeated field asset: ${field.assetId}`);
		returned.add(field.assetId);
	}
	const missing = input.fields.find((field) => !returned.has(field.assetId));
	if (missing !== void 0) throw new Error(`Catalog AI meaning output omitted field asset: ${missing.assetId}`);
	return result;
}
const CATALOG_MEANING_SYSTEM_PROMPT = `你是企业数据治理助手。请根据用户提供的单张表技术元数据，为这张表和每个字段生成简洁、可审核的中文业务含义候选。

规则：
1. 只依据表名、字段名、类型、nullable、数据库注释、键和关系推断；不要假装知道未提供的业务规则、枚举值或计算口径。
2. 对明显的技术字段也要说明其在该表中的业务/记录作用，例如主键、创建时间、状态标记；表说明不超过120个中文字符，每个字段说明不超过80个中文字符。
3. 每个输入字段必须且只能返回一次，assetId必须原样复制；不得添加未知assetId。
4. 不要输出Markdown、解释、置信度、SQL或额外字段，只输出以下严格JSON：
{"table":{"assetId":"...","meaning":"..."},"fields":[{"assetId":"...","meaning":"..."}]}
5. 所有内容都是待人工确认的候选，不要使用“已经确认”“官方口径”等表述。`;
//#endregion
//#region src/catalog-storage.ts
/** Durable versioned Catalog storage-domain and persistence adapter. */
const CATALOG_STORAGE_DOMAIN = "data_agent_catalog";
const catalogIndexRecordSchema = z.strictObject({
	id: z.string().min(1).max(512),
	sourceId: z.string().min(1).max(256),
	resultType: z.enum(["asset", "semantic"]),
	searchText: z.string().max(32768),
	searchItem: catalogSearchItemSchema,
	updatedAt: catalogDateTimeSchema
});
const catalogIndexStateSchema = z.strictObject({
	version: z.literal(1),
	rebuiltAt: catalogDateTimeSchema.optional()
});
const catalogStorageTables = {
	sources: domainTable(catalogSourceSchema),
	scan_runs: domainTable(catalogRunSchema),
	observations: domainTable(catalogObservationSchema),
	asset_revisions: domainTable(catalogAssetRevisionSchema),
	asset_heads: domainTable(catalogAssetHeadSchema),
	relations: domainTable(catalogRelationSchema),
	semantic_entries: domainTable(catalogSemanticEntrySchema),
	semantic_revisions: domainTable(catalogSemanticRevisionSchema),
	search_index: domainTable(catalogIndexRecordSchema),
	index_state: domainTable(catalogIndexStateSchema)
};
/** Strict schemas reject secret-shaped or raw-result fields at the durable boundary. */
const catalogStorageSpec = defineDomain({
	name: CATALOG_STORAGE_DOMAIN,
	version: 1,
	tables: catalogStorageTables
});
/**
* The same layout under one account's private domain name.
*
* Catalog rows carry table names, column meanings and sampled metric text read
* out of a real database, so they are isolated exactly like the connection
* profiles that produced them (see `./owner.ts`).
* @param ownerKey - the account's key from `ownerKeyOf`.
* @returns the domain spec for that account.
*/
function accountCatalogStorageSpec(ownerKey) {
	return defineDomain({
		name: `${CATALOG_STORAGE_DOMAIN}_${ownerKey}`,
		version: 1,
		tables: catalogStorageTables
	});
}
function createDomainCatalogPersistence(domain) {
	const sources = domain.table("sources");
	const runs = domain.table("scan_runs");
	const observations = domain.table("observations");
	const revisions = domain.table("asset_revisions");
	const heads = domain.table("asset_heads");
	const relations = domain.table("relations");
	const semanticEntries = domain.table("semantic_entries");
	const semanticRevisions = domain.table("semantic_revisions");
	const searchIndex = domain.table("search_index");
	const indexState = domain.table("index_state");
	return {
		getSource: (id) => sources.get(id),
		listSources: () => sortedValues(sources.entries(), (value) => value.id),
		putSource: (source) => sources.put(source.id, catalogSourceSchema.parse(source)),
		getRun: (id) => runs.get(id),
		listRuns: (sourceId) => sortedValues(runs.entries(), (value) => value.createdAt).filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		putRun: (run) => runs.put(run.id, catalogRunSchema.parse(run)),
		putObservation: (observation) => observations.put(`${observation.runId}:${observation.assetId}`, catalogObservationSchema.parse(observation)),
		listObservations: (runId) => sortedValues(observations.entries(), (value) => value.assetId).filter((value) => value.runId === runId),
		async deleteObservations(runId) {
			const keys = [...observations.entries()].filter(([, value]) => value.runId === runId).map(([key]) => key);
			for (const key of keys) await observations.delete(key);
		},
		getAssetHead: (assetId) => heads.get(assetId),
		listAssetHeads: (sourceId) => sortedValues(heads.entries(), (value) => value.assetId).filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		putAssetHead: (head) => heads.put(head.assetId, catalogAssetHeadSchema.parse(head)),
		getAssetRevision: (id) => revisions.get(id),
		listAssetRevisions: (assetId) => sortedValues(revisions.entries(), (value) => value.id).filter((value) => assetId === void 0 || value.assetId === assetId),
		putAssetRevision: (revision) => revisions.put(revision.id, catalogAssetRevisionSchema.parse(revision)),
		listRelations: (sourceId) => sortedValues(relations.entries(), (value) => value.id).filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		putRelation: (relation) => relations.put(`${relation.runId}:${relation.id}`, catalogRelationSchema.parse(relation)),
		getSemanticEntry: (id) => semanticEntries.get(id),
		listSemanticEntries: (sourceId) => sortedValues(semanticEntries.entries(), (value) => value.id).filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		putSemanticEntry: (entry) => semanticEntries.put(entry.id, catalogSemanticEntrySchema.parse(entry)),
		getSemanticRevision: (id) => semanticRevisions.get(id),
		listSemanticRevisions: (semanticId) => sortedValues(semanticRevisions.entries(), (value) => value.id).filter((value) => semanticId === void 0 || value.semanticId === semanticId),
		putSemanticRevision: (revision) => semanticRevisions.put(revision.id, catalogSemanticRevisionSchema.parse(revision)),
		listIndex: (sourceId) => sortedValues(searchIndex.entries(), (value) => value.id).filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		putIndex: (record) => searchIndex.put(record.id, catalogIndexRecordSchema.parse(record)),
		async clearIndex(sourceId) {
			const keys = [...searchIndex.entries()].filter(([, value]) => sourceId === void 0 || value.sourceId === sourceId).map(([key]) => key);
			for (const key of keys) await searchIndex.delete(key);
		},
		getIndexState: () => indexState.get("current"),
		putIndexState: (state) => indexState.put("current", catalogIndexStateSchema.parse(state))
	};
}
/** In-memory adapter used when Catalog persistence is explicitly disabled and by focused tests. */
function createMemoryCatalogPersistence() {
	const map = () => /* @__PURE__ */ new Map();
	const sources = map();
	const runs = map();
	const observations = map();
	const heads = map();
	const revisions = map();
	const relations = map();
	const entries = map();
	const semanticRevisions = map();
	const index = map();
	let state;
	return {
		getSource: (id) => sources.get(id),
		listSources: () => [...sources.values()].sort((a, b) => a.id.localeCompare(b.id)),
		async putSource(source) {
			sources.set(source.id, catalogSourceSchema.parse(source));
		},
		getRun: (id) => runs.get(id),
		listRuns: (sourceId) => [...runs.values()].filter((value) => sourceId === void 0 || value.sourceId === sourceId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
		async putRun(run) {
			runs.set(run.id, catalogRunSchema.parse(run));
		},
		async putObservation(value) {
			observations.set(`${value.runId}:${value.assetId}`, catalogObservationSchema.parse(value));
		},
		listObservations: (runId) => [...observations.values()].filter((value) => value.runId === runId),
		async deleteObservations(runId) {
			for (const [key, value] of observations) if (value.runId === runId) observations.delete(key);
		},
		getAssetHead: (id) => heads.get(id),
		listAssetHeads: (sourceId) => [...heads.values()].filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		async putAssetHead(value) {
			heads.set(value.assetId, catalogAssetHeadSchema.parse(value));
		},
		getAssetRevision: (id) => revisions.get(id),
		listAssetRevisions: (assetId) => [...revisions.values()].filter((value) => assetId === void 0 || value.assetId === assetId),
		async putAssetRevision(value) {
			revisions.set(value.id, catalogAssetRevisionSchema.parse(value));
		},
		listRelations: (sourceId) => [...relations.values()].filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		async putRelation(value) {
			relations.set(`${value.runId}:${value.id}`, catalogRelationSchema.parse(value));
		},
		getSemanticEntry: (id) => entries.get(id),
		listSemanticEntries: (sourceId) => [...entries.values()].filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		async putSemanticEntry(value) {
			entries.set(value.id, catalogSemanticEntrySchema.parse(value));
		},
		getSemanticRevision: (id) => semanticRevisions.get(id),
		listSemanticRevisions: (semanticId) => [...semanticRevisions.values()].filter((value) => semanticId === void 0 || value.semanticId === semanticId),
		async putSemanticRevision(value) {
			semanticRevisions.set(value.id, catalogSemanticRevisionSchema.parse(value));
		},
		listIndex: (sourceId) => [...index.values()].filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		async putIndex(value) {
			index.set(value.id, catalogIndexRecordSchema.parse(value));
		},
		async clearIndex(sourceId) {
			for (const [key, value] of index) if (sourceId === void 0 || value.sourceId === sourceId) index.delete(key);
		},
		getIndexState: () => state,
		async putIndexState(value) {
			state = catalogIndexStateSchema.parse(value);
		}
	};
}
function sortedValues(entries, by) {
	return [...entries].map(([, value]) => value).sort((a, b) => by(a).localeCompare(by(b)));
}
//#endregion
//#region src/storage.ts
/**
* Durable, non-secret connection profiles, session bindings, and form drafts.
*
* The domain intentionally excludes passwords, resolved credentials, SQL,
* table metadata, and client output. Form drafts likewise accept no secret
* fields. Runtime secrets stay in
* {@link DataAgentConnectionService}; durable records only retain enough
* information to rebuild a connection description in another DSH surface.
* @module @yejiming/dsh-data-agent/storage
*/
/** Storage-domain identity. Bump the version only with an explicit migration. */
const CONNECTION_STORAGE_DOMAIN = "data_agent_connections";
/** Durable profile schema. There is deliberately no `password` field. */
const persistedConnectionProfileSchema = z.object({
	name: z.string().min(1).optional(),
	type: z.enum(DATABASE_TYPES),
	host: z.string().optional(),
	port: z.number().int().min(1).max(65535).optional(),
	user: z.string().optional(),
	database: z.string().min(1),
	readonly: z.boolean().optional(),
	secure: z.boolean().optional(),
	passwordRef: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
	credentialMode: z.enum([
		"none",
		"password",
		"reference"
	]).optional(),
	updatedAt: z.string().min(1)
}).strict();
/** Durable session-to-profile binding schema. */
const sessionConnectionBindingSchema = z.object({
	profileId: z.string().min(1),
	updatedAt: z.string().min(1)
}).strict();
/** Session form draft schema. Secret-shaped fields are rejected by strict mode. */
const persistedConnectionFormDraftSchema = z.object({
	type: z.enum(DATABASE_TYPES),
	host: z.string(),
	port: z.string(),
	user: z.string(),
	database: z.string(),
	readonly: z.boolean(),
	secure: z.boolean().optional(),
	updatedAt: z.string().min(1)
}).strict();
const connectionStorageTables = {
	profiles: domainTable(persistedConnectionProfileSchema),
	bindings: domainTable(sessionConnectionBindingSchema),
	drafts: domainTable(persistedConnectionFormDraftSchema)
};
/** Single source of truth for the storage layout and durable validation. */
const connectionStorageSpec = defineDomain({
	name: CONNECTION_STORAGE_DOMAIN,
	version: 1,
	tables: connectionStorageTables
});
/**
* The same layout under one account's private domain name.
*
* An account-isolated deployment opens one of these per authenticated account
* instead of {@link connectionStorageSpec}, so a profile, binding or draft of
* another account is not merely filtered out of a result but absent from the
* medium the query reads (see `./owner.ts`). The unsuffixed name stays reserved
* for unisolated deployments, which therefore need no migration.
* @param ownerKey - the account's key from `ownerKeyOf`.
* @returns the domain spec for that account.
*/
function accountConnectionStorageSpec(ownerKey) {
	return defineDomain({
		name: `${CONNECTION_STORAGE_DOMAIN}_${ownerKey}`,
		version: 1,
		tables: connectionStorageTables
	});
}
/** Select the newest successful profile with a deterministic id tie-break. */
function latestConnectionProfile(entries) {
	let latest;
	for (const [profileId, profile] of entries) if (latest === void 0 || profile.updatedAt > latest.profile.updatedAt || profile.updatedAt === latest.profile.updatedAt && profileId > latest.profileId) latest = {
		profileId,
		profile
	};
	return latest;
}
/** Project a typed DSH domain handle onto the service's persistence seam. */
function createDomainConnectionPersistence(domain) {
	const profiles = domain.table("profiles");
	const bindings = domain.table("bindings");
	const drafts = domain.table("drafts");
	return {
		getProfile(profileId) {
			return profiles.get(profileId);
		},
		getLatestProfile() {
			return latestConnectionProfile(profiles.entries());
		},
		listProfiles() {
			return [...profiles.entries()].map(([profileId, profile]) => ({
				profileId,
				profile
			})).sort((left, right) => left.profileId.localeCompare(right.profileId));
		},
		putProfile(profileId, profile) {
			return profiles.put(profileId, profile);
		},
		deleteProfile(profileId) {
			return profiles.delete(profileId);
		},
		getBinding(sessionId) {
			return bindings.get(sessionId);
		},
		putBinding(sessionId, binding) {
			return bindings.put(sessionId, binding);
		},
		deleteBinding(sessionId) {
			return bindings.delete(sessionId);
		},
		getDraft(sessionId) {
			return drafts.get(sessionId);
		},
		putDraft(sessionId, draft) {
			return drafts.put(sessionId, draft);
		},
		deleteDraft(sessionId) {
			return drafts.delete(sessionId);
		}
	};
}
//#endregion
//#region src/accounts.ts
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
function createDataAgentAccounts(ctx, options, openDomain) {
	const scopes = /* @__PURE__ */ new Map();
	const buildScope = async (ownerKey) => {
		let connectionPersistence;
		let catalogPersistence;
		if (options.persistConnections) {
			if (openDomain === void 0) throw new Error("data-agent: 持久化已启用但缺少 storageDomain");
			const connectionSpec = ownerKey === void 0 ? connectionStorageSpec : accountConnectionStorageSpec(ownerKey);
			const catalogSpec = ownerKey === void 0 ? catalogStorageSpec : accountCatalogStorageSpec(ownerKey);
			const connectionDomain = await openDomain.open(connectionSpec);
			ctx.effect(() => () => connectionDomain.close(), "data-agent: close connection storage domain");
			const catalogDomain = await openDomain.open(catalogSpec);
			ctx.effect(() => () => catalogDomain.close(), "data-agent: close Catalog storage domain");
			connectionPersistence = createDomainConnectionPersistence(connectionDomain);
			catalogPersistence = createDomainCatalogPersistence(catalogDomain);
		} else catalogPersistence = createMemoryCatalogPersistence();
		const connections = createConnectionService(ctx, {
			connectTimeoutMs: options.connectTimeoutMs,
			queryTimeoutMs: options.queryTimeoutMs,
			catalogQueryTimeoutMs: options.catalogQueryTimeoutMs,
			catalogMaxResultChars: options.catalogMaxResultChars,
			maxResultChars: options.maxResultChars,
			maxQueryChars: options.maxQueryChars,
			introspectMaxTables: options.introspectMaxTables,
			readonly: options.readonly,
			clients: options.clients,
			preferredProfileIds: () => catalogPersistence.listSources().map((source) => source.profileId)
		}, connectionPersistence);
		for (const [sessionId, connection] of Object.entries(options.seeds)) connections.set(sessionId, connection);
		const catalog = await createCatalogService(connections, catalogPersistence, {
			maxAssetsPerRun: options.catalogMaxAssetsPerRun,
			maxTextChars: options.catalogMaxTextChars,
			pageSize: options.catalogPageSize,
			maxPageSize: options.catalogMaxPageSize,
			schemaConcurrency: options.catalogSchemaConcurrency,
			assetConcurrency: options.catalogAssetConcurrency,
			meaningGenerator: createDshCatalogMeaningGenerator(ctx.agents, ctx.llm),
			logger: ctx.logger
		});
		ctx.effect(() => () => catalog.scanner.interruptActiveRuns(), "data-agent: interrupt active Catalog scans");
		return {
			connections,
			catalog: catalog.read,
			scanner: catalog.scanner,
			review: catalog.review
		};
	};
	const scopeFor = (cacheKey, ownerKey) => {
		const open = scopes.get(cacheKey);
		if (open !== void 0) return open;
		const pending = buildScope(ownerKey).catch((error) => {
			scopes.delete(cacheKey);
			throw error;
		});
		scopes.set(cacheKey, pending);
		return pending;
	};
	const isolated = () => accountIsolated(ctx);
	const forPrincipal = async (principal, operation) => {
		if (!isolated()) return scopeFor(LOCAL_OWNER_KEY, void 0);
		const ownerKey = ownerKeyOf(principal, operation);
		return scopeFor(ownerKey, ownerKey);
	};
	return {
		isolated,
		forPrincipal,
		async forRequest(request, operation) {
			if (!isolated()) return scopeFor(LOCAL_OWNER_KEY, void 0);
			return forPrincipal(await requestPrincipal(ctx, request, operation), operation);
		},
		async forExecution(execution, operation) {
			return forPrincipal(execution.principal, operation);
		},
		async forDispatch(operation) {
			if (!isolated()) return scopeFor(LOCAL_OWNER_KEY, void 0);
			const principal = dispatchPrincipal(ctx);
			if (principal === void 0) throw new MissingPrincipalError(operation);
			return forPrincipal(principal, operation);
		}
	};
}
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
function executionScope(ctx, execution, toolName) {
	const principal = execution.principal;
	return ctx.dataAgentAccounts.forExecution(principal === void 0 ? {} : { principal }, toolName);
}
//#endregion
export { executionScope as n, createDataAgentAccounts as t };
