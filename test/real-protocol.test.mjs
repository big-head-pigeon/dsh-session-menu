/**
 * 用「真实的 cordis + 真实的 @deepseek-ai/dsh-typert-protocol」跑一遍宿主半。
 *
 * 另外两套测试用的是自写替身：替身能证明逻辑，但证明不了「我手写的 Remote 标记
 * 真协议认不认」。这一套专门补那个缺口 —— 它会把 index.js 复制到临时目录、
 * 把 node_modules 指向从 app.asar 里解出来的真包，然后用真 Context 启动服务。
 *
 * 需要先解包一次（/tmp 会被系统清理）：
 *   python3 /tmp/asar.py extract /dsh/node_modules/@deepseek-ai/dsh-typert-protocol/package.json \
 *     /tmp/dsm-real/node_modules/@deepseek-ai/dsh-typert-protocol/package.json   # lib/ 同理
 *   …更省事的做法见 test/README.md 的「真协议验证」一节。
 *
 * 没有解包目录时本套测试直接跳过（退出码 0），不影响另外两套。
 */
import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, symlink, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { kernelVersion } from "./kernel.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..");
const PKGS = process.env.DSH_TYPERT_PKGS ?? "/tmp/dsm-real/node_modules";

let passes = 0;
let failures = 0;
async function check(name, fn) {
	try {
		await fn();
		passes += 1;
		console.log(`  ok   ${name}`);
	} catch (error) {
		failures += 1;
		console.log(`  FAIL ${name}\n       ${error.message}`);
	}
}

const exists = async (path) => {
	try {
		await access(path);
		return true;
	} catch (_error) {
		return false;
	}
};

const protocolEntry = join(PKGS, "@deepseek-ai/dsh-typert-protocol/lib/index.js");
if (!(await exists(protocolEntry))) {
	console.log(`跳过：没找到真包目录 ${PKGS}（解包方法见 test/README.md）`);
	process.exit(0);
}

// The extracted packages are a snapshot of one kernel build. After a DSH update
// this suite would otherwise validate the OLD protocol and still report green,
// which is exactly the blind spot the kernel-compat work exists to close.
const STAMP = join(PKGS, "..", "kernel.json");
if (await exists(STAMP)) {
	const stamp = JSON.parse(await readFile(STAMP, "utf8"));
	const kernel = stamp.asar ? kernelVersion(stamp.asar) : null;
	if (kernel && kernel.version !== stamp.version) {
		console.log(`FAIL 解出来的是旧内核：快照是 ${stamp.version}，现在装着 ${kernel.version}`);
		console.log("     先重跑解包：python3 test/extract-asar-pkgs.py");
		process.exit(1);
	}
	if (kernel) console.log(`真包快照对应当前内核 ${stamp.version}`);
} else {
	console.log(`注意：${PKGS} 没有内核版本戳，无法确认这批真包是不是当前内核的`);
}

// 1. 复制 index.js 到临时目录，并把它的 node_modules 指到真包目录
const stage = await mkdtemp(join(tmpdir(), "dsm-real-"));
await mkdir(join(stage, "plugin"), { recursive: true });
await copyFile(join(ROOT, "index.js"), join(stage, "plugin/index.js"));
await symlink(PKGS, join(stage, "node_modules"), "dir");

const { Context, symbols } = await import(pathToFileURL(join(PKGS, "@deepseek-ai/cordis/lib/index.js")).href);
const { remoteMethods } = await import(pathToFileURL(protocolEntry).href);
const plugin = await import(pathToFileURL(join(stage, "plugin/index.js")).href);
const originalOf = (value) => value?.[symbols.original] ?? value;

console.log("# 真协议：宿主半能否被真 cordis 启动并解析成 Remote 端点");

let ServiceClass;
const definitions = [];
plugin.apply({
	sessionProjections: { register: (definition) => { definitions.push(definition); return () => {}; } },
	plugin: (ctor) => { ServiceClass = ctor; }
});

await check("apply 注册投影并接入服务类", async () => {
	assert.deepEqual(definitions.map((definition) => definition.key), ["sessionMenuStatus"]);
	assert.equal(typeof ServiceClass, "function");
});

const ctx = new Context();
const stubs = {
	sessions: { get: () => void 0, liveEntryFor: () => { throw new Error("not live"); }, detachEntered: () => {} },
	sessionPersistence: { locate: () => ({ kind: "jsonl", path: join(stage, "sessions/--x--/sid/session.v4.jsonl.zstd") }), root: join(stage, "sessions") },
	sessionQuery: { listSessions: async () => [] },
	workspaceRegistry: { unarchiveSession: () => {}, unpinSession: () => {} },
	sessionProjections: { register: () => () => {} }
};
for (const [name, value] of Object.entries(stubs)) ctx.provide(name, value);
ctx.plugin(ServiceClass);
await new Promise((resolve) => setTimeout(resolve, 20));

const service = ctx.get("sessionMenu");
await check("真 Context 启动后能取到 sessionMenu 服务", async () => {
	assert.notEqual(service, void 0, "服务没启动：注入的依赖是否对不上？");
	assert.equal(service.constructor.name, "SessionMenuService");
});

const raw = originalOf(service);
await check("typertRemote 绑定满足网关 readBinding 的四条判据", async () => {
	const binding = raw?.typertRemote;
	assert.ok(binding, "缺 typertRemote 绑定 → 网关会报 gateway/binding-invalid");
	assert.equal(binding.service, raw);
	assert.equal(binding.serviceKey, "sessionMenu");
	assert.equal(binding.namespace, "sessionMenu");
	assert.equal(Object.isFrozen(binding), true);
});

await check("手写的 Remote 标记被真协议读成 direct 端点", async () => {
	assert.deepEqual(remoteMethods(raw), [
		{ method: "hostPlatform", invocation: { kind: "direct" } },
		{ method: "deleteSession", invocation: { kind: "direct" } },
		{ method: "deleteSessions", invocation: { kind: "direct" } },
		{ method: "workspaceApplications", invocation: { kind: "direct" } },
		{ method: "openWorkspaceWith", invocation: { kind: "direct" } }
	]);
});

await check("真实调用走通（幂等 + 空 id 拦截）", async () => {
	assert.equal(await raw.hostPlatform(), process.platform);
	assert.deepEqual(await raw.deleteSession("sid"), { ok: true, removed: false, error: "" });
	assert.deepEqual(await raw.deleteSession(""), { ok: false, removed: false, code: "session-id-required", error: "session id is required" });
	assert.deepEqual(await raw.deleteSessions(["sid"]), { ok: true, deleted: 0, failed: 0, error: "" });
	assert.deepEqual(await raw.deleteSessions(undefined), { ok: false, deleted: 0, failed: 0, code: "session-ids-required", error: "session ids are required" });
});

await check("打开方式的入口在真协议下也拒得干净（不真的起 open）", async () => {
	assert.deepEqual(await raw.openWorkspaceWith("/definitely/not/here", "/Applications/Xcode.app"), {
		ok: false,
		opened: false,
		code: "path-unverified",
		error: "path has no verified host path"
	});
	assert.deepEqual(await raw.openWorkspaceWith(stage, ""), { ok: false, opened: false, code: "application-required", error: "application is required" });
});

/* 配置这条路只有真 cordis 能证明：替身的 plugin 桩是我自己写的，证明不了「真 Context 会把 config
   交给类插件的构造函数」。这条断言就是为此加的。 */
const configured = new Context();
for (const [name, value] of Object.entries(stubs)) configured.provide(name, value);
configured.plugin(ServiceClass, { applications: [{ kind: "ai", paths: ["/Applications/Claude.app"] }] });
await new Promise((resolve) => setTimeout(resolve, 20));
await check("真 cordis 把 config 交给了类插件的构造函数", async () => {
	const instance = originalOf(configured.get("sessionMenu"));
	assert.notEqual(instance, void 0, "带配置的实例没起来");
	assert.deepEqual(instance.developerApps, [["ai", ["/Applications/Claude.app"]]]);
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
