// Reading an installed DSH kernel out of its app bundle.
//
// Two different questions need the same plumbing:
//
//   - which version will the kernel compare a plugin manifest against?
//   - does the kernel still carry the client symbols our plugin reaches for?
//
// Both answers live inside `Contents/Resources/app.asar`, and the version is
// deliberately NOT `CFBundleShortVersionString`: the community build reports
// 0.12.0 there while its kernel is 0.2.0-rc.2. The kernel reads its own version
// from the app-boot package inside the archive, so we do the same.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const APPLICATIONS = "/Applications";

// Official build puts the runtime under `dsh/`, the community build ships a plain
// node_modules tree. Try both rather than sniffing the layout.
export const KERNEL_MANIFESTS = ["dsh/package.json", "node_modules/@deepseek-ai/dsh/package.json"];

function plistValue(plistPath, key) {
	try {
		const json = execFileSync("plutil", ["-convert", "json", "-o", "-", plistPath], { encoding: "utf8" });
		return JSON.parse(json)[key] || null;
	} catch {
		return null;
	}
}

/**
 * Every DSH-based app under /Applications that ships an app.asar.
 * Other Electron apps do too, so they are filtered out by bundle id.
 */
export function listKernelApps(root = APPLICATIONS) {
	const apps = [];
	for (const entry of fs.readdirSync(root)) {
		if (!entry.endsWith(".app")) continue;
		const app = path.join(root, entry);
		const asar = path.join(app, "Contents", "Resources", "app.asar");
		if (!fs.existsSync(asar)) continue;
		const bundleId = plistValue(path.join(app, "Contents", "Info.plist"), "CFBundleIdentifier");
		if (!bundleId || !/dsh/i.test(bundleId)) continue;
		apps.push({ app: entry, asar, bundleId });
	}
	return apps;
}

function openAsar(asarPath) {
	const fd = fs.openSync(asarPath, "r");
	try {
		const head = Buffer.alloc(16);
		fs.readSync(fd, head, 0, 16, 0);
		const jsonLength = head.readUInt32LE(12);
		const json = Buffer.alloc(jsonLength);
		fs.readSync(fd, json, 0, jsonLength, 16);
		// The data area starts after the header, padded to 4 bytes; Electron has
		// shifted this by a byte or two across versions, so probe the neighbours.
		const bases = [
			16 + jsonLength + ((4 - (jsonLength % 4)) % 4),
			16 + jsonLength,
			8 + head.readUInt32LE(8),
		];
		return { fd, header: JSON.parse(json.toString("utf8")), bases };
	} catch (error) {
		fs.closeSync(fd);
		throw error;
	}
}

function findMember(header, member) {
	let node = header;
	for (const segment of member.split("/")) {
		node = node && node.files ? node.files[segment] : null;
		if (!node) return null;
	}
	return node;
}

function readEntry(fd, bases, entry) {
	if (typeof entry.offset !== "string") return null;
	const data = Buffer.alloc(entry.size);
	for (const base of bases) {
		fs.readSync(fd, data, 0, entry.size, base + Number(entry.offset));
		try {
			JSON.parse(data.toString("utf8"));
			return data;
		} catch {
			// try the next base
		}
	}
	return null;
}

/** Parse one JSON file out of an app.asar, or null when it is not there. */
export function readAsarJson(asarPath, member) {
	const { fd, header, bases } = openAsar(asarPath);
	try {
		const entry = findMember(header, member);
		if (!entry || typeof entry.offset !== "string") return null;
		const data = readEntry(fd, bases, entry);
		return data ? JSON.parse(data.toString("utf8")) : null;
	} finally {
		fs.closeSync(fd);
	}
}

/** The version the kernel compares plugin manifests against. */
export function kernelVersion(asarPath) {
	for (const member of KERNEL_MANIFESTS) {
		let pkg = null;
		try {
			pkg = readAsarJson(asarPath, member);
		} catch {
			pkg = null;
		}
		if (pkg && pkg.version) return { name: pkg.name, version: pkg.version, member };
	}
	return null;
}

/** Every kernel installed on this machine, with its own version. */
export function installedKernels(root = APPLICATIONS) {
	const found = [];
	for (const app of listKernelApps(root)) {
		const kernel = kernelVersion(app.asar);
		if (kernel) found.push({ ...app, ...kernel });
	}
	return found;
}

/**
 * Count, per owning package, how many source files inside an app.asar mention
 * each needle. A needle with no hits anywhere is a symbol the kernel dropped.
 *
 * @param asarPath - the archive to walk.
 * @param needles - identifiers to look for.
 * @param [options.under] - only count files whose member path matches this regex.
 * @returns Map<needle, Map<owner, hits>>
 */
export function scanAsar(asarPath, needles, options = {}) {
	const { under } = options;
	const { fd, header, bases } = openAsar(asarPath);
	const hits = new Map(needles.map((needle) => [needle, new Map()]));
	try {
		const stack = [["", header]];
		while (stack.length > 0) {
			const [prefix, node] = stack.pop();
			for (const [name, entry] of Object.entries(node.files || {})) {
				const member = `${prefix}/${name}`;
				if (entry.files) {
					stack.push([member, entry]);
					continue;
				}
				if (!/\.(js|mjs|cjs|json)$/.test(name)) continue;
				if (typeof entry.offset !== "string") continue;
				if (entry.size > 8_000_000) continue;
				if (under && !under.test(member)) continue;
				const data = Buffer.alloc(entry.size);
				// latin1 keeps every byte mapped to one char, so substring search
				// cannot trip over a half-decoded multi-byte sequence.
				fs.readSync(fd, data, 0, entry.size, bases[0] + Number(entry.offset));
				const text = data.toString("latin1");
				const owner = (member.match(/\/node_modules\/(@[^/]+\/[^/]+|[^/]+)\//) || [, "(asar root)"])[1];
				for (const needle of needles) {
					if (!text.includes(needle)) continue;
					const byOwner = hits.get(needle);
					byOwner.set(owner, (byOwner.get(owner) || 0) + 1);
				}
			}
		}
	} finally {
		fs.closeSync(fd);
	}
	return hits;
}
