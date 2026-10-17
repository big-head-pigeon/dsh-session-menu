// Kernel compatibility self-check.
//
// A DSH update can break this plugin in three different ways, and this file
// guards all three:
//
//   1. the manifest no longer matches the new kernel -> the app writes
//      `disabled: true` into the profile and the plugin vanishes
//   2. a client symbol we reach for is renamed or dropped -> the menu entries
//      disappear or the plugin throws while rendering
//   3. (for the runtime half, see real-protocol.test.mjs) the protocol package
//      moved or changed shape -> the plugin fails while loading
//
// The rules behind (1) are read out of the kernel's own evaluator
// (`evaluatePluginCompatibility` -> `unmetRequirements`):
//
//   - an own `engines.dsh` range decides alone; `peerDependencies` are ignored
//   - otherwise every peer named `@deepseek-ai/dsh` or `@deepseek-ai/dsh-*`
//     must accept the installed kernel version
//   - the comparison is `semver.satisfies(kernelVersion, range, { includePrerelease: true })`
//     against the kernel's own version, not the version of the named package
//   - everything else (`@deepseek-ai/cordis`, `react`, ...) is never checked
//
// Run: node test/compat.test.mjs
// Pretend the installed kernel is a different version: DSH_VERSION=0.3.0 node test/compat.test.mjs

import fs from "node:fs";
import path from "node:path";
import { installedKernels, scanAsar } from "./kernel.mjs";

let passed = 0;
const failures = [];

function check(label, ok, detail = "") {
	if (ok) {
		passed += 1;
		return true;
	}
	failures.push(detail ? `${label}\n      ${detail}` : label);
	return false;
}

/* ---------------------------------------------------------------- semver */

// Enough of semver for the ranges a DSH plugin manifest may carry: exact,
// `=`, `>`, `>=`, `<`, `<=`, `^`, `~`, `*`, and `||` chains. Always evaluated
// with `includePrerelease`, which is what the kernel does, so the "prerelease
// only matches its own tuple" rule does not apply here.

function parseVersion(text) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(text).trim());
	if (!match) return null;
	return {
		nums: [Number(match[1]), Number(match[2]), Number(match[3])],
		pre: match[4] ? match[4].split(".") : null,
	};
}

function compareVersions(a, b) {
	for (let i = 0; i < 3; i += 1) {
		if (a.nums[i] !== b.nums[i]) return a.nums[i] < b.nums[i] ? -1 : 1;
	}
	if (!a.pre && !b.pre) return 0;
	if (!a.pre) return 1;
	if (!b.pre) return -1;
	const width = Math.max(a.pre.length, b.pre.length);
	for (let i = 0; i < width; i += 1) {
		const left = a.pre[i];
		const right = b.pre[i];
		if (left === undefined) return -1;
		if (right === undefined) return 1;
		const leftNumeric = /^\d+$/.test(left);
		const rightNumeric = /^\d+$/.test(right);
		if (leftNumeric && rightNumeric) {
			if (Number(left) !== Number(right)) return Number(left) < Number(right) ? -1 : 1;
		} else if (leftNumeric !== rightNumeric) {
			return leftNumeric ? -1 : 1;
		} else if (left !== right) {
			return left < right ? -1 : 1;
		}
	}
	return 0;
}

function bump(version, kind) {
	const [major, minor, patch] = version.nums;
	if (kind === "patch") return { nums: [major, minor, patch + 1], pre: null };
	if (kind === "minor") return { nums: [major, minor + 1, 0], pre: null };
	return { nums: [major + 1, 0, 0], pre: null };
}

function upperBoundForCaret(version) {
	const [major, minor, patch] = version.nums;
	if (major > 0) return { nums: [major + 1, 0, 0], pre: ["0"] };
	if (minor > 0) return { nums: [0, minor + 1, 0], pre: ["0"] };
	return { nums: [0, 0, patch + 1], pre: ["0"] };
}

function upperBoundForTilde(version) {
	const [, minor] = version.nums;
	return { nums: [0, minor + 1, 0], pre: ["0"] };
}

function satisfiesComparator(version, token) {
	const trimmed = token.trim();
	if (trimmed === "" || trimmed === "*" || trimmed === "x") return true;
	const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(trimmed);
	if (!match) return false;
	const [, operator = "=", body] = match;
	const target = parseVersion(body);
	if (!target) return false;
	const relation = compareVersions(version, target);
	switch (operator) {
		case ">=":
			return relation >= 0;
		case ">":
			return relation > 0;
		case "<=":
			return relation <= 0;
		case "<":
			return relation < 0;
		case "^":
			return relation >= 0 && compareVersions(version, upperBoundForCaret(target)) < 0;
		case "~":
			return relation >= 0 && compareVersions(version, upperBoundForTilde(target)) < 0;
		default:
			return relation === 0;
	}
}

function satisfies(versionText, range) {
	const version = parseVersion(versionText);
	if (!version) return false;
	return String(range)
		.split("||")
		.some((alternative) => {
			const tokens = alternative.trim().split(/\s+/).filter(Boolean);
			if (tokens.length === 0) return false;
			return tokens.every((token) => satisfiesComparator(version, token));
		});
}

/* ------------------------------------------------------------- manifests */

const repoRoot = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const clientSource = fs.readFileSync(path.join(repoRoot, "client.js"), "utf8");

// The requirement names the kernel actually evaluates.
function kernelRequirements(fields) {
	if (fields.engines && typeof fields.engines.dsh === "string") {
		return { "engines.dsh": fields.engines.dsh };
	}
	const peers = fields.peerDependencies || {};
	const found = {};
	for (const [name, range] of Object.entries(peers)) {
		if (name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-")) found[name] = range;
	}
	return found;
}

console.log("kernel compatibility self-check");

const requirements = kernelRequirements(manifest);
const names = Object.keys(requirements);
check("清单里有内核要求（否则无从自检）", names.length > 0);
console.log(`  requirements: ${names.map((n) => `${n} ${requirements[n]}`).join(", ") || "(none)"}`);

/* -------------------------------------------------------------- semver vs real semver */

// Cross-check the matcher above against real semver when one is reachable, so a
// bug in the subset cannot silently turn this suite into a rubber stamp.
const semverCandidates = [
	path.join(repoRoot, "node_modules", "semver"),
	path.join(process.env.HOME || "", ".dsh", "profiles", "desktop", "node_modules", "semver"),
	"/Users/leon/.local/node/node-v24.16.0-darwin-arm64/lib/node_modules/npm/node_modules/semver",
];
let realSemver = null;
for (const candidate of semverCandidates) {
	try {
		realSemver = (await import(`file://${path.join(candidate, "index.js")}`)).default;
		break;
	} catch {
		// try the next candidate
	}
}
if (realSemver) {
	const samples = ["0.2.0-rc.2", "0.2.1-rc.2", "0.3.0-rc.1", "0.3.0", "1.0.0"];
	const ranges = [...Object.values(requirements), "^0.2.1-rc.1", "~0.2.0", "0.2.0-rc.2", ">=0.1.0"];
	let agreed = true;
	for (const version of samples) {
		for (const range of ranges) {
			if (satisfies(version, range) !== realSemver.satisfies(version, range, { includePrerelease: true })) {
				agreed = false;
				failures.push(`本地 semver 子集与真 semver 不一致: ${version} vs ${range}`);
			}
		}
	}
	check("本地 semver 子集与真 semver 结论一致", agreed);
} else {
	console.log("  (no real semver reachable - subset matcher used unchecked)");
}

/* ------------------------------------------------------------ installed kernels */

const override = process.env.DSH_VERSION;
const kernels = override
	? [{ app: "DSH_VERSION override", asar: null, version: override, name: "(override)" }]
	: installedKernels();
check("找到已安装的内核", kernels.length > 0, "没有在 /Applications 下找到带 app.asar 的 DSH 应用");
for (const kernel of kernels) {
	console.log(`  kernel: ${kernel.app}  ${kernel.name || "?"}@${kernel.version}`);
}

/* ------------------------------------------------- (1) the version range holds */

// The kernel installed right now must be accepted.
for (const kernel of kernels) {
	const version = parseVersion(kernel.version);
	if (!check(`内核版本可解析: ${kernel.version}`, version !== null)) continue;
	for (const [name, range] of Object.entries(requirements)) {
		check(
			`当前内核被接受: ${kernel.version} vs ${name} ${range}`,
			satisfies(kernel.version, range),
			`DSH 会禁用本插件。清单里的范围开不出这个版本，改成只写下限的范围，例如 ">=${kernel.version}"`,
		);
	}
}

// The next patch / minor / major must be accepted too, otherwise the plugin
// breaks again on the next update - the failure 0.1.0 shipped with.
const base = parseVersion(override || (kernels[0] && kernels[0].version) || "0.0.0");
if (base) {
	const future = [];
	for (const kind of ["patch", "minor", "major"]) {
		const next = bump(base, kind).nums.join(".");
		future.push({ label: `${kind} ${next}`, version: next });
		future.push({ label: `${kind} ${next}-rc.1`, version: `${next}-rc.1` });
	}
	for (const [name, range] of Object.entries(requirements)) {
		for (const item of future) {
			check(
				`未来内核被接受: ${item.label} vs ${name} ${range}`,
				satisfies(item.version, range),
				`内核升到 ${item.version} 时本插件会被禁用。封顶的范围（^、~、精确值、x.y.z）迟早会断，` +
					`请改成只写下限的范围，例如 ">=0.2.0-rc.2"`,
			);
		}
	}
}

/* --------------------------------------------- (2) the client symbols still exist */

// Both lists are read out of our own client half, so they cannot go stale.
const primitiveUses = [...new Set([...clientSource.matchAll(/primitives\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
const slotUses = [
	...new Set([...clientSource.matchAll(/ctx\.slots\.(?:inject|register)\(\s*"([^"]+)"/g)].map((m) => m[1])),
];
check("从 client.js 读出用到的原语", primitiveUses.length > 0, "正则没匹配到 primitives.* —— 自检本身失效了");
check("从 client.js 读出注册的插槽", slotUses.length > 0, "正则没匹配到 ctx.slots.inject(...) —— 自检本身失效了");
console.log(`  symbols: ${slotUses.length} slots, ${primitiveUses.length} primitives`);

for (const kernel of kernels) {
	if (!kernel.asar) continue;
	// Slot names are kernel-owned strings, so a hit anywhere in the archive counts.
	const slotHits = scanAsar(kernel.asar, slotUses);
	for (const slot of slotUses) {
		const owners = [...slotHits.get(slot).keys()].filter((owner) => owner !== "(asar root)");
		check(
			`插槽还在: ${slot} @ ${kernel.app}`,
			owners.length > 0,
			`内核里已经没有这个插槽了，注册到它上面的菜单项会静默消失`,
		);
	}
	// A primitive is checked inside the kernel's client UI layer: the official
	// build ships no `dsh-client-ui-primitives` package at all (the seed table is
	// resolved by the client bundle), so "the name is still used somewhere in
	// `dsh-client-ui-*`" is the strongest check that works for both builds.
	const primitiveHits = scanAsar(kernel.asar, primitiveUses, { under: /node_modules\/@deepseek-ai\/dsh-client-ui-/ });
	for (const name of primitiveUses) {
		const owners = [...primitiveHits.get(name).keys()];
		check(
			`原语还在: ${name} @ ${kernel.app}`,
			owners.length > 0,
			`内核的客户端 UI 层里已经没人用这个名字了，客户端渲染很可能抛错`,
		);
	}
}

/* ---------------------------------------------------------------- report */

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
	for (const failure of failures) console.log(`  FAIL  ${failure}`);
	process.exitCode = 1;
}
