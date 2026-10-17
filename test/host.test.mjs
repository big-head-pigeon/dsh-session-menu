/**
 * 宿主半边（index.js）的离线单元验证。
 *
 * 为什么需要它：宿主半边只有重启应用才会被加载，重启前无法在 GUI 里验证；
 * 这份测试用替身 ctx 把投影折叠与删除流程真跑一遍，把「重启后才发现写错」的风险提前拦掉。
 * 被测文件就是本包的 ../index.js（不复制、不改写），`@deepseek-ai/dsh-typert-protocol` 由
 * test/loader.mjs 的解析钩子指向本地替身（test/stub-typert-protocol.mjs）。
 *
 * 运行：node test/host.test.mjs
 */
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { apply, inject } from "../index.js";

const REMOTE_METHODS_KEY = "@deepseek-ai/dsh-typert-protocol/remote-methods";
const PROJECT_SEGMENT = "--Users-leon-Z_AI_WorkSpace--";
const CWD = "$WORKSPACE";

let failures = 0;
let passes = 0;

/** 跑一个检查，失败只记录不中断（一次跑完全部场景）。 */
async function check(name, fn) {
	try {
		await fn();
		passes += 1;
		console.log(`  ok   ${name}`);
	} catch (error) {
		failures += 1;
		console.log(`  FAIL ${name}\n       ${String(error?.message ?? error).split("\n").join("\n       ")}`);
	}
}

/** 造一个能承载 index.js 的替身 ctx。 */
function makeCtx(options = {}) {
	const ctx = {
		events: [],
		warnings: [],
		cancels: [],
		detaches: [],
		ledger: [],
		liveEntries: [],
		services: {},
		plugin: (ServiceClass, config) => {
			ctx.service = new ServiceClass(ctx, config);
		},
		sessionProjections: {
			register: (definition) => {
				ctx.projection = definition;
				return () => {};
			}
		},
		emit: (type, ...args) => {
			if (options.emitThrows === true) throw new Error("emit exploded");
			ctx.events.push({ type, args });
		},
		logger: { warn: (message) => ctx.warnings.push(String(message)) },
		get: (name) => ctx.services[name],
		sessionController: {
			cancel: (request) => {
				ctx.cancels.push(request);
				if (typeof options.onCancel === "function") options.onCancel(request);
			}
		},
		sessions: {
			get: (id) => (options.liveId === id ? options.live : void 0),
			liveEntryFor: (session) => {
				if (options.liveEntryThrows === true) throw new Error("not live in this store");
				ctx.liveEntries.push(session);
				return { id: session.header.id };
			},
			detachEntered: (entry) => {
				ctx.detaches.push(entry);
			}
		},
		sessionQuery: {
			listSessions: async () => options.records ?? []
		},
		sessionPersistence: {
			root: options.root,
			locate: (meta) => {
				if (options.locateThrows === true) throw new Error("no locate");
				if (typeof options.locate === "function") return options.locate(meta);
				return { kind: "jsonl", path: join(options.root, PROJECT_SEGMENT, meta.id, "session.v4.jsonl.zstd") };
			}
		},
		workspaceRegistry: {
			unarchiveSession: async (id) => {
				ctx.ledger.push(`unarchiveSession:${id}`);
			},
			unpinSession: async (id) => {
				ctx.ledger.push(`unpinSession:${id}`);
			}
		}
	};
	return ctx;
}

/** 建一个会话目录（含一个日志文件），返回其路径。 */
async function makeSessionDir(root, id, segment = PROJECT_SEGMENT) {
	const directory = join(root, segment, id);
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "session.v4.jsonl.zstd"), "log");
	return directory;
}

/** 路径是否存在。 */
async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

console.log("# 1. 投影 sessionMenuStatus");
await check("注册定义与 wire 形状", async () => {
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx);
	assert.equal(ctx.projection.key, "sessionMenuStatus");
	assert.equal(ctx.projection.stateVersion, 1);
	assert.equal(ctx.projection.wire.viewSchema, ctx.projection.stateSchema);
	assert.deepEqual(ctx.projection.init(), { phase: "idle", message: "" });
});
await check("turn 折叠：start 重置、end 记录结局", async () => {
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx);
	const p = ctx.projection;
	const idle = { phase: "idle", message: "" };
	assert.deepEqual(p.apply({ phase: "error", message: "旧错" }, { type: "turn/start", data: {} }), idle);
	assert.deepEqual(p.apply(idle, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } }), {
		phase: "completed",
		message: ""
	});
	assert.deepEqual(
		p.apply(idle, { type: "turn/end", data: { turn: 2, reason: { kind: "error", error: { message: "capacity", code: "X" } } } }),
		{ phase: "error", message: "capacity" }
	);
	assert.deepEqual(p.apply(idle, { type: "turn/end", data: { reason: { kind: "aborted" } } }), {
		phase: "aborted",
		message: ""
	});
});
await check("非 turn/end 事件原样返回（同一引用）", async () => {
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx);
	const p = ctx.projection;
	const idle = { phase: "idle", message: "" };
	assert.equal(p.apply(idle, { type: "assistant/chunk" }), idle);
	assert.equal(p.apply(idle, { type: "turn/end", data: { reason: null } }), idle);
	assert.equal(p.apply(idle, null), idle);
});
await check("schema.parse 只接受合法形状", async () => {
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx);
	const s = ctx.projection.stateSchema;
	assert.deepEqual(s.parse({ phase: "error", message: "x" }), { phase: "error", message: "x" });
	assert.deepEqual(s.parse(null), { phase: "idle", message: "" });
	assert.deepEqual(s.parse({ phase: 42, message: null }), { phase: "idle", message: "" });
	assert.deepEqual(s.parse("nope"), { phase: "idle", message: "" });
});

console.log("# 2. Remote 标记与绑定");
await check("原型标记等价于 @Remote：五个方法逐个 direct 端点", async () => {
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx);
	const marker = Object.getPrototypeOf(ctx.service)[REMOTE_METHODS_KEY];
	assert.equal(marker.version, 1);
	assert.deepEqual(marker.methods.map((entry) => entry.method), [
		"hostPlatform",
		"deleteSession",
		"deleteSessions",
		"workspaceApplications",
		"openWorkspaceWith"
	]);
	for (const entry of marker.methods) assert.deepEqual(entry.invocation, { kind: "direct" });
});

await check("hostPlatform 原样返回本机平台（客户端靠它决定「在访达中显示」叫什么）", async () => {
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx);
	assert.equal(await ctx.service.hostPlatform(), process.platform);
});
await check("服务键 / 绑定 / 形参名与客户端描述符逐字一致", async () => {
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx);
	assert.equal(ctx.service.name, "sessionMenu");
	assert.equal(ctx.service.typertRemote.namespace, "sessionMenu");
	assert.deepEqual(inject, ["sessionProjections"]);
	// SRC 模式下线上参数名 = 形参名，必须与客户端 wire 名相同
	assert.match(ctx.service.deleteSession.toString(), /^async deleteSession\(sessionId\)/);
	assert.match(ctx.service.deleteSessions.toString(), /^async deleteSessions\(sessionIds\)/);
	assert.match(ctx.service.workspaceApplications.toString(), /^async workspaceApplications\(\)/);
	assert.match(ctx.service.openWorkspaceWith.toString(), /^async openWorkspaceWith\(path, application\)/);
});

console.log("# 3. 删除流程");
await check("空 / 非法 id 直接拒绝，不碰任何服务", async () => {
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx);
	const expected = { ok: false, removed: false, code: "session-id-required", error: "session id is required" };
	assert.deepEqual(await ctx.service.deleteSession(""), expected);
	assert.deepEqual(await ctx.service.deleteSession("   "), expected);
	assert.deepEqual(await ctx.service.deleteSession(undefined), expected);
	assert.deepEqual(await ctx.service.deleteSession(42), expected);
	assert.equal(ctx.ledger.length, 0);
	assert.equal(ctx.detaches.length, 0);
});
await check("未知会话：幂等返回 removed=false，只清账本", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsm-"));
	const ctx = makeCtx({ root, records: [] });
	apply(ctx);
	assert.deepEqual(await ctx.service.deleteSession("ghost"), { ok: true, removed: false, error: "" });
	assert.deepEqual(ctx.ledger, ["unarchiveSession:ghost", "unpinSession:ghost"]);
	assert.equal(ctx.detaches.length, 0);
	assert.equal(ctx.events.length, 0);
	await rm(root, { recursive: true, force: true });
});
await check("冷会话：删掉日志目录，兄弟会话不受影响", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsm-"));
	const target = await makeSessionDir(root, "aaa-111");
	const sibling = await makeSessionDir(root, "bbb-222");
	const ctx = makeCtx({ root, records: [{ header: { id: "aaa-111", cwd: CWD } }] });
	apply(ctx);
	assert.deepEqual(await ctx.service.deleteSession("aaa-111"), { ok: true, removed: true, error: "" });
	assert.equal(await exists(target), false);
	assert.equal(await exists(sibling), true);
	assert.deepEqual(ctx.ledger, ["unarchiveSession:aaa-111", "unpinSession:aaa-111"]);
	assert.deepEqual(ctx.events, [{ type: "api-session/removed", args: ["aaa-111"] }]);
	assert.equal(ctx.cancels.length, 0);
	await rm(root, { recursive: true, force: true });
});
await check("运行中的会话：先 cancel，等它停下再摘除", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsm-"));
	const target = await makeSessionDir(root, "run-1");
	const live = { header: { id: "run-1", cwd: CWD } };
	let reads = 0;
	const ctx = makeCtx({ root, liveId: "run-1", live });
	// 前两次状态探查仍是 running，之后停下 —— 覆盖「轮询等待」分支且不拖慢测试
	ctx.services.agents = {
		get: (id) => (id === "run-1" ? { status: reads++ >= 2 ? "idle" : "running" } : void 0)
	};
	apply(ctx);
	assert.deepEqual(await ctx.service.deleteSession("run-1"), { ok: true, removed: true, error: "" });
	assert.deepEqual(ctx.cancels, [{ sessionId: "run-1" }]);
	assert.equal(ctx.detaches.length, 1);
	assert.equal(await exists(target), false);
	await rm(root, { recursive: true, force: true });
});
await check("空闲的活会话：不调用 cancel，直接摘除", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsm-"));
	const target = await makeSessionDir(root, "idle-1");
	const live = { header: { id: "idle-1", cwd: CWD } };
	const ctx = makeCtx({ root, liveId: "idle-1", live });
	ctx.services.agents = { get: () => ({ status: "idle" }) };
	apply(ctx);
	assert.deepEqual(await ctx.service.deleteSession("idle-1"), { ok: true, removed: true, error: "" });
	assert.equal(ctx.cancels.length, 0);
	assert.equal(ctx.detaches.length, 1);
	assert.equal(await exists(target), false);
	await rm(root, { recursive: true, force: true });
});
await check("摘除失败只警告，磁盘照样删掉", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsm-"));
	const target = await makeSessionDir(root, "warn-1");
	const live = { header: { id: "warn-1", cwd: CWD } };
	const ctx = makeCtx({ root, liveId: "warn-1", live, liveEntryThrows: true });
	ctx.services.agents = { get: () => ({ status: "idle" }) };
	apply(ctx);
	assert.deepEqual(await ctx.service.deleteSession("warn-1"), { ok: true, removed: true, error: "" });
	assert.equal(ctx.warnings.length, 1);
	assert.match(ctx.warnings[0], /detach failed/);
	assert.equal(await exists(target), false);
	await rm(root, { recursive: true, force: true });
});

console.log("# 4. 落盘定位的安全边界");
await check("locate 抛错时退回扫描 root 一层", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsm-"));
	const target = await makeSessionDir(root, "scan-1", "other-project");
	const ctx = makeCtx({ root, locateThrows: true, records: [{ header: { id: "scan-1", cwd: CWD } }] });
	apply(ctx);
	assert.deepEqual(await ctx.service.deleteSession("scan-1"), { ok: true, removed: true, error: "" });
	assert.equal(await exists(target), false);
	await rm(root, { recursive: true, force: true });
});
await check("locate 给出的目录名与会话 id 不一致时不删（防误删）", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsm-"));
	const other = join(root, "unrelated");
	await mkdir(other, { recursive: true });
	await writeFile(join(other, "keep.txt"), "keep");
	const ctx = makeCtx({
		root,
		records: [{ header: { id: "victim", cwd: CWD } }],
		locate: () => ({ kind: "jsonl", path: join(other, "session.v4.jsonl.zstd") })
	});
	apply(ctx);
	/* 路径对不上时必须**报失败**，而不是"删了个别的东西还报成功"。 */
	assert.deepEqual(await ctx.service.deleteSession("victim"), {
		ok: false,
		removed: false,
		code: "path-unverified",
		error: 'no verified directory for session "victim"'
	});
	assert.equal(await exists(other), true);
	assert.equal(basename(dirname(join(other, "session.v4.jsonl.zstd"))), "unrelated");
	await rm(root, { recursive: true, force: true });
});
await check("scan 找不到同名目录时不动任何东西", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsm-"));
	const other = await makeSessionDir(root, "someone-else");
	const ctx = makeCtx({ root, locateThrows: true, records: [{ header: { id: "missing", cwd: CWD } }] });
	apply(ctx);
	assert.deepEqual(await ctx.service.deleteSession("missing"), {
		ok: false,
		removed: false,
		code: "path-unverified",
		error: 'no verified directory for session "missing"'
	});
	assert.equal(await exists(other), true);
	await rm(root, { recursive: true, force: true });
});
await check("子智能体会话一并删掉（它们在磁盘上是父会话的同级目录，rm 父目录碰不到）", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsm-"));
	const parent = await makeSessionDir(root, "p1");
	const childA = await makeSessionDir(root, "c1");
	const childB = await makeSessionDir(root, "c2");
	const grandChild = await makeSessionDir(root, "g1");
	const unrelated = await makeSessionDir(root, "other");
	const ctx = makeCtx({
		root,
		records: [
			{ header: { id: "p1", cwd: CWD } },
			{ header: { id: "c1", cwd: CWD, parentSession: "p1" } },
			{ header: { id: "c2", cwd: CWD, parentSession: "p1" } },
			{ header: { id: "g1", cwd: CWD, parentSession: "c1" } },
			{ header: { id: "other", cwd: CWD } }
		]
	});
	apply(ctx);
	assert.deepEqual(await ctx.service.deleteSession("p1"), { ok: true, removed: true, error: "" });
	for (const [label, dir] of [["父会话", parent], ["子会话 A", childA], ["子会话 B", childB], ["孙会话", grandChild]]) {
		assert.equal(await exists(dir), false, `${label} 的日志目录应该一并删掉`);
	}
	assert.equal(await exists(unrelated), true, "无关会话不能受牵连");
	await rm(root, { recursive: true, force: true });
});

await check("删不掉磁盘目录时如实报失败，且不清账本、不发移除通知", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsm-"));
	const segment = join(root, PROJECT_SEGMENT);
	const target = await makeSessionDir(root, "locked");
	/* 把项目目录设成只读：目录还在，但 rm -rf 拿不掉里面的东西。 */
	await chmod(segment, 0o500);
	const ctx = makeCtx({ root, records: [{ header: { id: "locked", cwd: CWD } }] });
	apply(ctx);
	try {
		const outcome = await ctx.service.deleteSession("locked");
		assert.equal(outcome.ok, false, "删不掉就必须报失败");
		assert.equal(outcome.removed, false);
		assert.equal(outcome.code, "remove-failed");
	} finally {
		await chmod(segment, 0o700);
	}
	assert.equal(ctx.ledger.length, 0, "失败时不该动工作区账本");
	assert.equal(ctx.events.filter((name) => name === "api-session/removed").length, 0, "失败时不该发移除通知");
	await rm(root, { recursive: true, force: true });
});

await check("emit 抛错不影响删除结果", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsm-"));
	const target = await makeSessionDir(root, "emit-1");
	const ctx = makeCtx({ root, emitThrows: true, records: [{ header: { id: "emit-1", cwd: CWD } }] });
	apply(ctx);
	assert.deepEqual(await ctx.service.deleteSession("emit-1"), { ok: true, removed: true, error: "" });
	assert.equal(await exists(target), false);
	await rm(root, { recursive: true, force: true });
});

console.log("# 5. 批量删除（删除所有已归档会话）");
await check("非数组输入直接拒绝，不碰任何服务", async () => {
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx);
	const expected = { ok: false, deleted: 0, failed: 0, code: "session-ids-required", error: "session ids are required" };
	assert.deepEqual(await ctx.service.deleteSessions(undefined), expected);
	assert.deepEqual(await ctx.service.deleteSessions("aaa-1"), expected);
	assert.deepEqual(await ctx.service.deleteSessions(null), expected);
	assert.equal(ctx.ledger.length, 0);
	assert.equal(ctx.events.length, 0);
});
await check("批量删除：逐个删目录、逐个通知客户端，非目标会话不动", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsm-"));
	const first = await makeSessionDir(root, "aaa-1");
	const second = await makeSessionDir(root, "bbb-2");
	const keep = await makeSessionDir(root, "ccc-3");
	const ctx = makeCtx({
		root,
		records: [
			{ header: { id: "aaa-1", cwd: CWD } },
			{ header: { id: "bbb-2", cwd: CWD } },
			{ header: { id: "ccc-3", cwd: CWD } }
		]
	});
	apply(ctx);
	const outcome = await ctx.service.deleteSessions(["aaa-1", " bbb-2 ", "", 7]);
	assert.deepEqual(outcome, { ok: true, deleted: 2, failed: 0, error: "" });
	assert.equal(await exists(first), false);
	assert.equal(await exists(second), false);
	assert.equal(await exists(keep), true);
	assert.deepEqual(ctx.events.map((event) => event.args[0]), ["aaa-1", "bbb-2"]);
	assert.deepEqual(ctx.ledger, [
		"unarchiveSession:aaa-1",
		"unpinSession:aaa-1",
		"unarchiveSession:bbb-2",
		"unpinSession:bbb-2"
	]);
	await rm(root, { recursive: true, force: true });
});
await check("批量里早已不存在的 id 既不算已删除也不算失败", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsm-"));
	const ctx = makeCtx({ root, records: [] });
	apply(ctx);
	assert.deepEqual(await ctx.service.deleteSessions(["ghost-1", "ghost-2"]), { ok: true, deleted: 0, failed: 0, error: "" });
	assert.equal(ctx.events.length, 0);
	await rm(root, { recursive: true, force: true });
});
await check("批量里的活会话同样先 cancel 再摘除", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsm-"));
	const target = await makeSessionDir(root, "run-9");
	const live = { header: { id: "run-9", cwd: CWD } };
	const ctx = makeCtx({ root, liveId: "run-9", live, records: [{ header: { id: "run-9", cwd: CWD } }] });
	ctx.services.agents = { get: () => ({ status: "running" }) };
	apply(ctx);
	const outcome = await ctx.service.deleteSessions(["run-9"]);
	assert.deepEqual(outcome, { ok: true, deleted: 1, failed: 0, error: "" });
	assert.deepEqual(ctx.cancels, [{ sessionId: "run-9" }]);
	assert.equal(ctx.detaches.length, 1);
	assert.equal(await exists(target), false);
	await rm(root, { recursive: true, force: true });
});

console.log("# 6. 「打开方式」：路径校验与参数拦截（这一节不会真的起 open）");
await check("路径不存在 / 不是目录 / 空串 → 拒绝", async () => {
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx);
	const rejected = { ok: false, opened: false, code: "path-unverified", error: "path has no verified host path" };
	assert.deepEqual(await ctx.service.openWorkspaceWith("/definitely/not/here", "/Applications/Xcode.app"), rejected);
	assert.deepEqual(await ctx.service.openWorkspaceWith("", "/Applications/Xcode.app"), rejected);
	assert.deepEqual(await ctx.service.openWorkspaceWith(fileURLToPath(import.meta.url), "/Applications/Xcode.app"), rejected);
});
await check("目录通过校验但应用名为空 → 拒绝", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsm-openwith-"));
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx);
	assert.deepEqual(await ctx.service.openWorkspaceWith(dir, "   "), { ok: false, opened: false, code: "application-required", error: "application is required" });
	await rm(dir, { recursive: true, force: true });
});
await check("有 fs 服务时按官方映射校验：往返不一致就拒绝", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsm-openwith-"));
	const ctx = makeCtx({ root: "/nonexistent" });
	let roundTrip = dir;
	ctx.services.fs = {
		processPathFromHostPath: (path) => (path === dir ? "mapped" : void 0),
		resolve: async (value) => value,
		processPath: () => roundTrip
	};
	apply(ctx);
	/* 往返一致 → 通过路径校验，停在应用名检查上（说明拒绝来自参数而不是路径）。 */
	assert.deepEqual(await ctx.service.openWorkspaceWith(dir, ""), { ok: false, opened: false, code: "application-required", error: "application is required" });
	roundTrip = "elsewhere";
	assert.deepEqual(await ctx.service.openWorkspaceWith(dir, ""), { ok: false, opened: false, code: "path-unverified", error: "path has no verified host path" });
	await rm(dir, { recursive: true, force: true });
});

console.log("# 7. 「打开方式」的应用清单：默认值 + 配置覆盖");
await check("默认清单含 Claude / ChatGPT，且排在 IDE 之后、终端之前", async () => {
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx);
	const apps = ctx.service.developerApps;
	const flat = apps.flatMap(([, paths]) => paths);
	assert.equal(flat.includes("/Applications/Claude.app"), true, "Claude 应在默认清单里");
	assert.equal(flat.includes("/Applications/ChatGPT.app"), true, "ChatGPT 应在默认清单里");
	assert.ok(flat.indexOf("/Applications/Xcode.app") < flat.indexOf("/Applications/Claude.app"), "AI 助手应排在 IDE 之后");
	assert.ok(flat.indexOf("/Applications/Claude.app") < flat.indexOf("/System/Applications/Utilities/Terminal.app"), "AI 助手应排在终端之前");
	assert.equal(apps.every(([kind, paths]) => typeof kind === "string" && Array.isArray(paths)), true);
});
await check("配置能整体替换清单", async () => {
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx, { applications: [{ kind: "ai", paths: ["/Applications/Claude.app"] }] });
	assert.deepEqual(ctx.service.developerApps, [["ai", ["/Applications/Claude.app"]]]);
});
await check("配置写坏时退回默认清单，不整块空掉", async () => {
	for (const broken of [
		{ applications: "nope" },
		{ applications: [] },
		{ applications: [null, 42, "x", { kind: "editor" }, { paths: [] }, { paths: ["   "] }] }
	]) {
		const ctx = makeCtx({ root: "/nonexistent" });
		apply(ctx, broken);
		assert.equal(ctx.service.developerApps.flatMap(([, paths]) => paths).includes("/System/Applications/Utilities/Terminal.app"), true, `${JSON.stringify(broken)} 应退回默认清单`);
	}
});
await check("配置里形状不对的条目丢掉，合法的留下", async () => {
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx, { applications: [{ kind: "ai", paths: ["/Applications/Claude.app", 42, ""] }, null, { paths: [] }, { kind: "terminal", paths: ["/Applications/Warp.app"] }] });
	assert.deepEqual(ctx.service.developerApps, [
		["ai", ["/Applications/Claude.app"]],
		["terminal", ["/Applications/Warp.app"]]
	]);
});
await check("没传配置时照旧可用（cordis 不保证一定给 config）", async () => {
	const ctx = makeCtx({ root: "/nonexistent" });
	apply(ctx, void 0);
	assert.equal(Array.isArray(ctx.service.developerApps), true);
	assert.ok(ctx.service.developerApps.length > 0);
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
