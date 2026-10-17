/**
 * 客户端半边（client.js）的离线冒烟验证。
 *
 * 覆盖三件在浏览器里才会暴露的事：bundle 能否被模块加载器加载、插槽注册表是否正确、
 * 组件被真正渲染时会不会抛错。做法是在 Node 里给 `window.__ModuleLoader__`、
 * `require`（react / primitives 替身）与 `document` 打桩，再手工调用组件函数。
 *
 * 运行：node test/client.test.mjs
 */
import assert from "node:assert/strict";

const PKG = "dsh-session-menu";

let failures = 0;
let passes = 0;
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

// #region 打桩
/** 极简 React：只实现本插件用到的 5 个 API，元素就是普通对象。 */
const h = (type, props, ...children) => ({
	type,
	props: {
		...(props ?? {}),
		...(children.length === 0 ? {} : { children: children.length === 1 ? children[0] : children })
	}
});
const Fragment = Symbol("Fragment");
/** 极简 hooks 运行时：让 useState 在「重新渲染」之间真的保留状态（安装应用列表要靠它）。 */
const effectsRun = [];
const componentStates = new WeakMap();
let activeComponent = null;
let hookCursor = 0;
function renderComponent(Component, props) {
	const previous = activeComponent;
	activeComponent = Component;
	hookCursor = 0;
	try {
		const tree = Component(props);
		attachRefs(tree);
		return tree;
	} finally {
		activeComponent = previous;
	}
}
/** 替身 DOM 节点：二级面板定位只用到 getBoundingClientRect。 */
const fakeRect = { top: 100, right: 300, bottom: 134, left: 84, width: 216, height: 34 };
/**
 * 替身 React 不提交 DOM，但组件的 ref 是渲染时创建的同一个对象，
 * 所以在渲染后按元素树把 ref.current 填上假节点（等价于真实 React 的提交阶段）。
 */
function attachRefs(element) {
	if (element === null || typeof element !== "object") return;
	const ref = element.props?.ref;
	if (ref !== null && typeof ref === "object" && "current" in ref) {
		ref.current = { getBoundingClientRect: () => fakeRect };
	}
	const children = element.props?.children;
	if (Array.isArray(children)) {
		for (const child of children) attachRefs(child);
	} else {
		attachRefs(children);
	}
}
function useHookSlot(initial) {
	const index = hookCursor++;
	if (!componentStates.has(activeComponent)) componentStates.set(activeComponent, new Map());
	const store = componentStates.get(activeComponent);
	if (!store.has(index)) store.set(index, { value: typeof initial === "function" ? initial() : initial });
	return store.get(index);
}
const React = {
	createElement: h,
	Fragment,
	useState: (initial) => {
		const slot = useHookSlot(initial);
		return [slot.value, (next) => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
	},
	useEffect: (fn) => {
		// 只跑一次，且**不**立刻执行清理：真实的 useEffect 只在依赖变化或卸载时才清理，
		// 立刻清理会让组件里的 alive 标志失效（异步结果被丢弃），把测试引入歧途。
		try {
			effectsRun.push(fn());
		} catch {
			/* 副作用失败不影响冒烟判定 */
		}
	},
	// 二级面板的测量副作用在替身里拿不到真实 DOM（ref.current 恒为 null），会直接返回。
	useLayoutEffect: (fn) => {
		try {
			effectsRun.push(fn());
		} catch {
			/* 量不到就保持未量状态 */
		}
	},
	useRef: (initial) => useHookSlot({ current: initial }).value,
	useSyncExternalStore: (subscribe, getSnapshot) => {
		try {
			subscribe(() => {});
		} catch {
			/* 订阅失败不影响本次取值 */
		}
		return getSnapshot();
	}
};

const clipboardWrites = [];
/** primitives 替身：真实写剪贴板要记下来，其余每个导出都当作一个占位组件（同一属性返回同一个函数）。 */
const stubCache = new Map();
const primitives = new Proxy(
	{
		writeClipboard: async (text) => {
			clipboardWrites.push(text);
			return true;
		}
	},
	{
		get(target, property) {
			if (property in target) return target[property];
			if (typeof property !== "string") return void 0;
			if (!stubCache.has(property)) {
				stubCache.set(property, function Stub(props) {
					return h(property, props);
				});
			}
			return stubCache.get(property);
		}
	}
);

/** 极简假 DOM：标题行按钮要用 createElement / querySelector(All) / body / MutationObserver。 */
class FakeNode {
	constructor(tag) {
		this.tagName = String(tag).toUpperCase();
		this.children = [];
		this.parentNode = null;
		this.style = {};
		this.attributes = {};
		this.listeners = {};
		this.clientWidth = 320;
	}
	appendChild(child) {
		child.parentNode = this;
		this.children.push(child);
		return child;
	}
	remove() {
		const parent = this.parentNode;
		if (parent === null) return;
		parent.children = parent.children.filter((node) => node !== this);
		this.parentNode = null;
	}
	setAttribute(name, value) {
		this.attributes[name] = String(value);
	}
	getAttribute(name) {
		return this.attributes[name] ?? null;
	}
	removeAttribute(name) {
		delete this.attributes[name];
	}
	addEventListener(type, listener) {
		this.listeners[type] = listener;
	}
	removeEventListener(type) {
		delete this.listeners[type];
	}
	contains(node) {
		if (this === node) return true;
		return this.children.some((child) => child.contains(node));
	}
}

/** 工作区标题行（唯一渲染点；类名是 CSS 模块本地名，前缀哈希随版本变）。 */
const headerRow = new FakeNode("div");
headerRow.className = "_7514NG_sectionHeader";
/** 当前 DOM 里渲染出来的会话行（`data-row-key`），测试里直接换。 */
let visibleSessionRows = [];
/** 设置对话框导航行（`[role="dialog"] nav button`）：导航图标标记只认这些按钮，测试里直接换。 */
let settingsNavButtons = [];
/** 导航图标标记属性：与 client.js 的 SETTINGS_NAV_MARKER 逐字一致。 */
const NAV_MARKER = "data-dsh-session-menu-settings-nav";
let headerPresent = true;

globalThis.document = {
	createElement: (tag) => new FakeNode(tag),
	head: new FakeNode("head"),
	body: new FakeNode("body"),
	querySelector: (selector) => (selector.includes("sectionHeader") && headerPresent ? headerRow : null),
	querySelectorAll: (selector) => {
		if (selector.includes("data-row-key")) return visibleSessionRows;
		if (selector.includes('[role="dialog"]')) return settingsNavButtons;
		if (selector.includes(NAV_MARKER)) return settingsNavButtons.filter((button) => button.getAttribute(NAV_MARKER) !== null);
		return [];
	}
};
const observers = [];
globalThis.MutationObserver = class {
	constructor(callback) {
		this.callback = callback;
		this.disconnected = false;
		observers.push(this);
	}
	observe() {}
	disconnect() {
		this.disconnected = true;
	}
};
/** 同步执行：测试里不需要真的等一帧。 */
globalThis.requestAnimationFrame = (callback) => {
	callback();
	return 0;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.window = {
	addEventListener() {},
	removeEventListener() {},
	__ModuleLoader__: {
		load(spec) {
			globalThis.window.__loaded = spec;
		}
	}
};

const loaded = [];
globalThis.window.__ModuleLoader__.load = (spec) => loaded.push(spec);
await import("../client.js");
// #endregion

const spec = loaded[0];
let moduleExports;

console.log("# 1. bundle 加载与导出");
await check("模块加载器只收到一个注册，id 与包名一致", async () => {
	assert.equal(loaded.length, 1);
	assert.equal(spec.id, PKG);
	assert.equal(typeof spec.factory, "function");
});
await check("require 只请求冻结基线里的模块", async () => {
	const asked = [];
	moduleExports = spec.factory((name) => {
		asked.push(name);
		if (name === "react") return React;
		if (name === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
		throw new Error(`unexpected require: ${name}`);
	});
	assert.deepEqual(asked, ["react", "@deepseek-ai/dsh-client-ui-primitives"]);
});
await check("导出 apply / inject 与预期一致", async () => {
	assert.equal(typeof moduleExports.apply, "function");
	assert.deepEqual([...moduleExports.inject], ["slots", "locale", "sessions", "workspaces", "remote"]);
});

// #region 替身上下文
const rows = {
	s1: {
		id: "s1",
		displayTitle: "会话一",
		cwd: "$WORKSPACE",
		running: false,
		blank: false,
		retainedBy: { mainView: 0 },
		projectionValues: { sessionMenuStatus: { phase: "idle", message: "" } }
	}
};
const sessionsSnapshot = { ids: ["s1"], byId: rows, phase: "ready" };
/** 归档集来自工作区列表快照；测试里会整体换掉这个快照（store 变了才会产生新对象）。 */
let workspacesSnapshot = { archivedSessionIds: ["s1"], pinnedSessionIds: [] };
/** 工作区列表订阅者：标题行按钮靠它的推送重新同步显隐。 */
const workspacesListeners = new Set();
const publishWorkspaces = () => {
	for (const listener of [...workspacesListeners]) listener();
};
const calls = { mounted: 0, deleted: [], bulkDeleted: [], opened: [], openedWith: [], apps: 0, catalog: 0, clearedMain: 0 };
/**
 * 失败注入：null 表示照常成功。失败用例直接换成宿主/协议真会返回的形状：
 * - 业务失败：`{ ok: true, value: { ok: false, error } }`（宿主把失败放在内层）
 * - 协议失败：`{ ok: false, error: new Error(...) }`（Remote 层没能把调用送出去）
 * - 业务失败（删除）：`deleteFailure`
 */
let openWithFailure = null;
/** 宿主平台：`hostPlatform()` 的返回值，用来验「在访达中显示」按平台换名字。 */
let hostPlatformValue = "darwin";
let openPathFailure = null;
let deleteFailure = null;
/**
 * 宿主探测到的开发者应用清单：二级开关用例会临时换成空表，验「读不到应用时显示提示而不是空壳」。
 * 默认那份就是开发机上真实探测出来的（顺序 = index.js 的 `DEFAULT_DEVELOPER_APPS` 顺序）。
 */
let catalogApplications = [
	{ id: "/Applications/Xcode.app", name: "Xcode", kind: "editor", icon: "data:image/png;base64,XC" },
	{ id: "/Applications/Claude.app", name: "Claude", kind: "ai", icon: "data:image/png;base64,CLAUDE" },
	{ id: "/Applications/ChatGPT.app", name: "ChatGPT", kind: "ai", icon: "data:image/png;base64,GPT" },
	{ id: "/System/Applications/Utilities/Terminal.app", name: "终端", kind: "terminal", icon: "data:image/png;base64,TERM" }
];
/** 模拟真实 cordis 的 dotted key 解析：`remote.sessionMenu` 只有 $mount 之后才存在。 */
let namespaceMounted = false;

/** 内核已注册的菜单行，新用例按需往里塞；形状与真机一致：id 在 `entry.options.id`。 */
const nativeMenuEntries = [];
const services = {
	sessions: { list: { getSnapshot: () => sessionsSnapshot, subscribe: () => () => {} } },
	workspaces: {
		list: {
			getSnapshot: () => workspacesSnapshot,
			subscribe: (listener) => {
				workspacesListeners.add(listener);
				return () => workspacesListeners.delete(listener);
			}
		}
	},
	// 官方在主视图会话被归档后清主视图，删除走同一条路（见官方 UiWorkspaceService.clearMain）
	uiWorkspace: { clearMain: () => { calls.clearedMain += 1; } },
	remote: {
		$mount: async () => {
			calls.mounted += 1;
			namespaceMounted = true;
			return () => {};
		},
		sessionMenu: {
			deleteSession: async (sessionId) => {
				calls.deleted.push(sessionId);
				if (deleteFailure !== null) return deleteFailure;
				return { ok: true, value: { ok: true, removed: true, error: "" } };
			},
			deleteSessions: async (sessionIds) => {
				calls.bulkDeleted.push([...sessionIds]);
				if (deleteFailure !== null) return deleteFailure;
				return { ok: true, value: { ok: true, deleted: sessionIds.length, failed: 0, error: "" } };
			},
			/**
			 * 宿主探测到的开发者应用清单：官方 Launch Services 列不出终端与 Xcode，
			 * 所以「打开方式」的主要来源是它。
			 *
			 * 这份夹具就是开发机上真实探测出来的（顺序 = index.js 的 `DEFAULT_DEVELOPER_APPS` 顺序），
			 * 图标也是宿主真给的 32×32 PNG（这里换成短串只为断言方便）。
			 * Claude / ChatGPT 同时出现在下面那张系统列表里，用来验「只有宿主清单这条能带进来」。
			 */
			workspaceApplications: async () => {
				calls.catalog += 1;
				return { ok: true, value: catalogApplications.map((entry) => ({ ...entry })) };
			},
			hostPlatform: async () => ({ ok: true, value: hostPlatformValue }),
			openWorkspaceWith: async (path, application) => {
				calls.openedWith.push({ path, application });
				if (openWithFailure !== null) return openWithFailure;
				return { ok: true, value: { ok: true, opened: true, error: "" } };
			}
		},
		session: {
			openWorkspacePath: async (request) => {
				calls.opened.push(request);
				if (openPathFailure !== null) return openPathFailure;
				return { ok: true, value: { opened: true } };
			},
			/** 官方入口：这台机器上该目录在 Launch Services 里注册的全部处理程序（含代理与聊天类）。 */
			workspacePathApplications: async () => {
				calls.apps += 1;
				return {
					ok: true,
					value: [
						{ id: "/System/Library/CoreServices/Finder.app", name: "访达", default: true, icon: null },
						{ id: "/Applications/Trae CN.app", name: "TRAE CN", default: false, icon: null },
						{ id: "/Applications/Claude.app", name: "Claude", default: false, icon: null },
						{ id: "/Applications/ChatGPT.app", name: "ChatGPT", default: false, icon: null },
						{ id: "/Applications/WorkBuddy.app", name: "WorkBuddy", default: false, icon: null },
						{ id: "/Applications/Shadowrocket.app", name: "Shadowrocket", default: false, icon: null },
						{ id: "/System/Library/CoreServices/Applications/Archive Utility.app", name: "归档实用工具", default: false, icon: null }
					]
				};
			},
			canOpenWorkspacePath: async () => ({ ok: true, value: true })
		}
	}
};

/** 文案替身：把 key 与参数拼成可断言的字符串（真实实现返回人话）。 */
const t = (key, params) => (params === void 0 ? key : `${key}|${JSON.stringify(params)}`);

const registrations = [];
const effects = [];
/** 各 effect 的清理函数（卸载用例会逐个调用）。 */
const cleanups = [];
const dictionaries = [];
/**
 * 记下一段 inject 回调产出的注册。
 *
 * 替身必须照抄真实 cordis 的语义：回调可以是「yield 若干清理函数」的生成器，也可以直接 return 一个，
 * 而真实实现**每一步（含 done 那一步）的 value 都当清理函数收下**（fiber.effect 的 safeCollect），
 * 所以两种写法都能记账 —— `settings.section` 的注册用的就是 return。
 */
const collectRegistrations = (factory, into) => {
	const iterator = factory()[Symbol.iterator]();
	for (;;) {
		const step = iterator.next();
		if (step.value !== void 0 && step.value !== null) into.push(step.value);
		if (step.done === true) return;
	}
};
const ctx = {
	effect: (fn, label) => {
		effects.push(label);
		const cleanup = fn();
		if (typeof cleanup === "function") cleanups.push(cleanup);
		return typeof cleanup === "function" ? cleanup : () => {};
	},
	locale: {
		register: (ns, dicts) => {
			dictionaries.push({ ns, dicts });
		},
		/** 真实实现在 apply 之后用 bind(NS) 拿一个读当前语言的 t；这里直接给同一个替身。 */
		bind: () => t
	},
	slots: {
		register: (registration, Component) => ({ ...registration, Component }),
		inject: (key, generator) => {
			collectRegistrations(generator, registrations);
		},
		/** 内核自己往菜单插槽里放的行；默认空（旧内核没有原生「复制会话 ID」），新用例按需追加。 */
		entriesOfSlot: (key) => (key === "sidebar.workspaces.session.menu.item" ? nativeMenuEntries : [])
	},
	get: (name) => {
		if (name.startsWith("remote.")) {
			const namespace = name.slice("remote.".length);
			// `remote.sessionMenu` 由本插件的 $mount 建立，挂载前不存在（与真实 cordis 一致）
			if (namespace === "sessionMenu") return namespaceMounted ? services.remote.sessionMenu : void 0;
			return services.remote[namespace];
		}
		return services[name];
	}
};

moduleExports.apply(ctx);
await new Promise((resolve) => setTimeout(resolve, 5));
// #endregion

const byId = (id) => registrations.find((entry) => entry.id === id);
/** 渲染某个已注册组件（走 hooks 运行时，重新渲染才能看到 setState 的结果）。 */
const render = (id, props) => renderComponent(byId(id).Component, props);
const menuProps = { sessionId: "s1", displayTitle: "会话一", t, useMenuOpenState: () => [false, () => {}] };

console.log("# 2. 注册表");
await check("插槽 / id / order 与设计一致", async () => {
	const table = registrations.map((entry) => `${entry.name}#${entry.id}@${entry.order}`).sort();
	assert.deepEqual(table, [
		"settings.section#session-menu@30",
		"shell.overlay#session-menu-delete-dialog@60",
		"shell.overlay#session-menu-open-toast@61",
		"sidebar.session.row.hover#session-menu-hover-info@20",
		"sidebar.session.row.leading#session-menu-unread-mark@20",
		"sidebar.workspaces.session.menu.item#session-menu-copy@500",
		"sidebar.workspaces.session.menu.item#session-menu-delete-archived@610",
		"sidebar.workspaces.session.menu.item#session-menu-delete@600",
		"sidebar.workspaces.session.menu.item#session-menu-mark-unread@150",
		"sidebar.workspaces.session.menu.item#session-menu-open-with@530",
		"sidebar.workspaces.session.menu.item#session-menu-reveal@520",
		"sidebar.workspaces.session.row.action#session-menu-row-delete@300"
	]);
	assert.equal(registrations.every((entry) => typeof entry.Component === "function"), true);
});
await check("中英文案键完全对齐", async () => {
	assert.equal(dictionaries.length, 1);
	assert.equal(dictionaries[0].ns, "session-menu");
	const { zh, en } = dictionaries[0].dicts;
	assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
	assert.equal(zh["menu.markUnread"], "标记为未读");
	assert.match(en["delete.title"], /Delete .*session\?/i);
});
await check("设置面板文案就是定好的那张表：八项标签 + 八条说明，删掉的键一个都不留", async () => {
	const { zh, en } = dictionaries[0].dicts;
	/** `[键, 中文, 英文]` —— 与需求里那张表逐条对应，改文案必须先改这里。 */
	const expected = [
		["settings.title", "会话菜单", "Session menu"],
		["settings.markUnread.label", "标记未读", "Mark as unread"],
		["settings.markUnread.hint", "标成未读后行首亮蓝点，重新打开会话就消失", "Adds a blue dot until you reopen the session"],
		["settings.copy.label", "复制", "Copy"],
		["settings.copy.hint", "把会话 ID 或工作目录复制到剪贴板", "Copies the session ID or working directory"],
		["settings.reveal.label", "在文件管理器中显示", "Show in file manager"],
		["settings.reveal.hint", "在文件管理器里打开会话目录并选中它", "Reveals the session folder in your file manager"],
		["settings.openWith.label", "打开方式", "Open with"],
		["settings.openWith.hint", "用本机的编辑器或终端打开会话目录", "Opens the session folder in your editor or terminal"],
		["settings.delete.label", "永久删除会话", "Delete session"],
		["settings.delete.hint", "从磁盘上删掉日志文件，子会话一起删", "Removes the log from disk, child sessions too"],
		["settings.deleteArchived.label", "删除所有已归档会话", "Delete all archived sessions"],
		["settings.deleteArchived.hint", "一次清空所有已归档会话的日志文件", "Clears the logs of every archived session at once"],
		["settings.statusDots.label", "状态点", "Status dots"],
		["settings.statusDots.hint", "行首显示未读与报错状态的小圆点", "Dots for unread and failed sessions"],
		["settings.hoverInfo.label", "悬浮卡", "Hover card"],
		["settings.hoverInfo.hint", "鼠标停在会话行上，显示工作目录和上次报错", "Shows the working directory and last error on hover"],
		["settings.expand", "展开", "Expand"],
		["settings.collapse", "折叠", "Collapse"],
		["settings.childLocked", "{name} 关闭时不可用", "Unavailable while {name} is off"],
		["settings.appsUnavailable", "暂时读不到可用应用", "No applications found"]
	];
	for (const [key, zhText, enText] of expected) {
		assert.equal(zh[key], zhText, `${key} 的中文`);
		assert.equal(en[key], enText, `${key} 的英文`);
	}
	assert.deepEqual(
		Object.keys(zh).filter((key) => key.startsWith("settings.")).sort(),
		expected.map(([key]) => key).sort(),
		"设置项就是这 21 个键，不多不少"
	);
	/* 八个开关每一个都得有说明，一条都不能少。 */
	for (const key of ["markUnread", "copy", "reveal", "openWith", "delete", "deleteArchived", "statusDots", "hoverInfo"]) {
		assert.equal(typeof zh[`settings.${key}.hint`], "string", `${key} 缺中文说明`);
		assert.equal(typeof en[`settings.${key}.hint`], "string", `${key} 缺英文说明`);
		assert.notEqual(zh[`settings.${key}.hint`].trim(), "", `${key} 的说明不能是空串`);
		assert.notEqual(zh[`settings.${key}.hint`], zh[`settings.${key}.label`], `${key} 的说明不许复述标签`);
		/* 说明先被嫌啰嗦、又被嫌太短，两头各留一条下限/上限兜住。 */
		assert.ok(zh[`settings.${key}.hint`].length >= 10, `${key} 的中文说明太短，写不下信息（≥10 字）`);
		assert.ok(en[`settings.${key}.hint`].split(" ").length >= 5, `${key} 的英文说明太短（≥5 词）`);
	}
	for (const dropped of ["settings.desc"]) {
		assert.equal(zh[dropped], void 0, `${dropped} 不该再留在中文包里`);
		assert.equal(en[dropped], void 0, `${dropped} 不该再留在英文包里`);
	}
});
await check("effect 覆盖样式 / 文案 / 插槽 / 已读 / remote / 标题行按钮 / 设置导航图标", async () => {
	assert.deepEqual(effects, [
		`${PKG}: style`,
		`${PKG}: dictionaries`,
		`${PKG}: slots`,
		`${PKG}: mark opened session as read`,
		`${PKG}: remote`,
		`${PKG}: header button`,
		`${PKG}: settings nav icon`
	]);
	assert.equal(calls.mounted, 1);
});

console.log("# 3. 组件渲染");
await check("五个菜单项都能渲染", async () => {
	for (const id of [
		"session-menu-mark-unread",
		"session-menu-copy",
		"session-menu-reveal",
		"session-menu-open-with",
		"session-menu-delete"
	]) {
		const element = render(id, menuProps);
		assert.ok(element !== null && element !== void 0, `${id} 不应返回空`);
	}
});

/** 记录菜单关闭调用，用来验证二级面板里选中后会不会把父菜单收掉。 */
const closeCalls = [];
const submenuProps = { ...menuProps, useMenuOpenState: () => [true, (open) => closeCalls.push(open)] };

/**
 * 打开二级面板：模拟指针进入触发行并重渲染（替身的 setState 不会自动触发重渲染）。
 * @param id - 菜单项注册 id。
 * @param renderHere - 用哪个实例渲染（默认主实例；隔离实例的存储是独立的，二级开关用例要用它）。
 * @returns `{ trigger, bridge, panel, items }`。
 */
/** 复制 / 删除这类菜单项外层是 Fragment（自绘分隔线 + 触发项），取真正的触发组件。 */
const unwrapTrigger = (element) => {
	if (element === null || element.type !== React.Fragment) return { separator: null, element };
	const [separator, inner] = element.props.children;
	return { separator, element: inner };
};

const openSubmenu = (id, renderHere = render) => {
	// 菜单项组件只是把 props 转给 SubmenuMenuItem，替身不递归渲染，所以这里手动往下走一层。
	const { separator, element: outer } = unwrapTrigger(renderHere(id, submenuProps));
	const mount = () => renderComponent(outer.type, outer.props);
	const host = mount();
	host.props.onPointerEnter();
	const opened = mount();
	const trigger = opened.props.children[0];
	const fragment = opened.props.children[1];
	assert.equal(fragment.type, React.Fragment, "打开后应渲染二级面板");
	const [bridge, panel] = fragment.props.children;
	return { separator, trigger, bridge, panel, items: panel.props.children };
};

/**
 * 「复制」这一组的菜单行。两条及以上是个二级菜单，只剩一条时我们把它拍平成普通行（少一次点击），
 * 所以两种形状都要能读：SubmenuMenuItem 的 props 里有 items，普通行的没有。
 */
const copyRows = (renderHere = render) => {
	const element = renderHere("session-menu-copy", submenuProps);
	if (element === null) return null;
	const { element: inner } = unwrapTrigger(element);
	/* 拍平成普通行时，unwrapTrigger 拿到的那层就是行本身；二级菜单要像 openSubmenu 那样再往下走一层，
	   否则拿到的是 items 描述对象而不是渲染出来的行。 */
	if (!Array.isArray(inner.props.items)) return [inner];
	return openSubmenu("session-menu-copy", renderHere).items;
};
/** 同上，只取每行的文字。 */
const copyLabels = (renderHere) => copyRows(renderHere)?.map((row) => row.props.children);

await check("分组分隔线是自绘的 1px 线，且位于复制与删除两项之前", async () => {
	for (const id of ["session-menu-copy", "session-menu-delete"]) {
		const { separator } = unwrapTrigger(render(id, submenuProps));
		assert.ok(separator !== null, `${id} 前面应有分隔线`);
		const line = renderComponent(separator.type, separator.props); // 分隔线本身是个组件，渲染出真正的 div
		assert.equal(line.type, "div");
		assert.equal(line.props.className, "dsm-sep");
		assert.equal(line.props.role, "separator");
	}
	const plain = unwrapTrigger(render("session-menu-reveal", submenuProps));
	assert.equal(plain.separator, null, "普通项不该带分隔线");
});

await check("打开方式只列开发工具（真机同款夹具：5 项、噪声 0）", async () => {
	// 应用列表是异步取的（useApplications → loadApplications），先渲染一轮让结果落地
	render("session-menu-open-with", submenuProps);
	await new Promise((resolve) => setTimeout(resolve, 5));
	const { trigger, bridge, panel, items } = openSubmenu("session-menu-open-with");
	assert.equal(trigger.props["aria-haspopup"], "menu");
	assert.equal(trigger.props.children[1].props.children, "menu.openWithTitle");
	assert.equal(bridge.props.className, "dsm-submenu-bridge");
	assert.equal(panel.props.className, "dsm-submenu");
	assert.equal(panel.props.role, "menu");
	/* 顺序：系统默认应用 → 宿主探测的开发者清单（IDE → AI 助手 → 终端）。
	   系统列表里的 Claude / ChatGPT 与清单同路径，靠 id 去重只留一项。

	   应用名这里走的是**字典键**而不是宿主报的 `name`：夹具里终端那条的 `name` 写的是「终端」
	   （真实机器上 macOS 就是这么报的，跟随系统语言而非界面语言），断言证明我们没用它。 */
	assert.deepEqual(items.map((item) => item.props.children), [
		'menu.openWith|{"name":"app.finder"}',
		'menu.openWith|{"name":"Xcode"}',
		'menu.openWith|{"name":"Claude"}',
		'menu.openWith|{"name":"ChatGPT"}',
		'menu.openWith|{"name":"app.terminal"}'
	]);
	const labels = items.map((item) => String(item.props.children)).join("|");
	assert.equal(labels.includes("终端"), false, "终端应走 app.terminal 字典，而不是 macOS 报的中文名");
	assert.equal(labels.includes("访达"), false, "访达应走 app.finder 字典，而不是 macOS 报的中文名");
	assert.equal(labels.includes('"name":"Xcode"'), true, "字典里没有的应用用 .app 文件名，与系统语言无关");
	/* 「打开方式」的语义是「换个工具继续写代码」：系统注册表里的代理 / 解压 / 其它聊天类一律不列。
	   Claude / ChatGPT 是例外 —— 它们真能接住文件夹（Info.plist 里声明了 public.folder），
	   所以由宿主的开发者清单显式带进来，而不是靠系统列表过滤。 */
	for (const noise of ["Shadowrocket", "归档实用工具", "图书"]) {
		assert.equal(items.map((item) => String(item.props.children)).join("|").includes(noise), false, `${noise} 不该出现在打开方式里`);
	}
	/* 2026-10-16 把 Trae 从默认清单和名字正则里都删掉了：它注册过 public.folder，
	   所以这条同时守住「清单删掉后不会从系统列表那条补充通道溜回来」。 */
	assert.equal(items.map((item) => String(item.props.children)).join("|").includes("TRAE"), false, "TRAE CN 已从默认清单移除，不该再从系统列表冒出来");
	/* WorkBuddy 同样注册过 public.folder、也在下面那张系统列表里，但名字不命中 DEVELOPER_APP_NAME 正则，
	   所以从宿主清单删掉就等于彻底不出现 —— 这条守住它不会从补充通道溜回来。 */
	assert.equal(items.map((item) => String(item.props.children)).join("|").includes("WorkBuddy"), false, "WorkBuddy 已从默认清单移除，不该再从系统列表冒出来");
	assert.equal(items.filter((item) => String(item.props.children).includes("Claude")).length, 1, "两张表都有 Claude，靠 id 去重后只该剩一项");
	// 应用图标：系统默认项没有图标（官方返回 null）→ 退回通用箭头；开发者清单里的应用各自用自己的图标
	const icons = items.map((item) => item.props.icon);
	assert.equal(icons[0].type, primitives.IconRightUpOutlineRegular, "无图标的应用退回箭头图标");
	assert.equal(icons[1].type, "img", "有图标的应用渲染 <img>");
	assert.equal(icons[1].props.className, "dsm-app-icon");
	assert.equal(icons[1].props.src, "data:image/png;base64,XC");
	assert.equal(icons[1].props.alt, "");
	assert.equal(icons[2].props.src, "data:image/png;base64,CLAUDE");
	assert.equal(icons[4].props.src, "data:image/png;base64,TERM");
	assert.equal(icons.every((icon) => icon.type === "img" || icon.type === primitives.IconRightUpOutlineRegular), true);
});
await check("点开发者应用走自建入口（open -a，不校验注册表），点系统应用仍走官方入口", async () => {
	render("session-menu-open-with", submenuProps);
	await new Promise((resolve) => setTimeout(resolve, 5));
	const { items } = openSubmenu("session-menu-open-with");
	// 终端没有向 Launch Services 注册，只能走插件自己的宿主方法
	items[4].props.onSelect();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(calls.openedWith.at(-1), { path: "$WORKSPACE", application: "/System/Applications/Utilities/Terminal.app" });
	assert.deepEqual(closeCalls, [false]);
	// 访达这类确实注册过的应用，继续用官方 Remote（它会校验注册表）
	const openedBefore = calls.opened.length;
	items[0].props.onSelect();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(calls.opened.length, openedBefore + 1);
	assert.deepEqual(calls.opened.at(-1), { path: "$WORKSPACE", application: "/System/Library/CoreServices/Finder.app" });
});
await check("打开失败：宿主没给错误码时原样显示原文（比如 macOS 的话）", async () => {
	openWithFailure = { ok: true, value: { ok: false, opened: false, error: "The application can't be opened." } };
	const { items } = openSubmenu("session-menu-open-with");
	items[4].props.onSelect();
	await new Promise((resolve) => setTimeout(resolve, 0));
	const toast = render("session-menu-open-toast", { t });
	assert.ok(toast !== null, "失败后必须出现提示 —— 改之前这里是静默的，用户只看到「点了没反应」");
	assert.equal(toast.type, primitives.Toast);
	assert.equal(toast.props.text, 'open.failedWith|{"message":"The application can\'t be opened."}');
	assert.equal(toast.props.icon.type, primitives.IconWarningOutlineRegular);
	toast.props.onDone();
	assert.equal(render("session-menu-open-toast", { t }), null, "提示淡出后应自己清掉");
	openWithFailure = null;
});
await check("打开失败：宿主给了错误码就翻成当前语言，不显示英文原文", async () => {
	openWithFailure = { ok: true, value: { ok: false, opened: false, code: "path-unverified", error: "path has no verified host path" } };
	const { items } = openSubmenu("session-menu-open-with");
	items[4].props.onSelect();
	await new Promise((resolve) => setTimeout(resolve, 0));
	const toast = render("session-menu-open-toast", { t });
	assert.equal(toast.props.text, 'open.failedWith|{"message":"host.pathUnverified"}', "应该拿 code 去查字典，而不是把宿主那句英文摊给用户");
	toast.props.onDone();
	openWithFailure = null;
});
await check("打开失败：协议层失败（外层 ok:false）→ 提示里带 error.message", async () => {
	openWithFailure = { ok: false, error: new Error("client api: Remote method is no longer mounted") };
	const { items } = openSubmenu("session-menu-open-with");
	items[4].props.onSelect();
	await new Promise((resolve) => setTimeout(resolve, 0));
	const toast = render("session-menu-open-toast", { t });
	assert.equal(toast.props.text, 'open.failedWith|{"message":"client api: Remote method is no longer mounted"}');
	toast.props.onDone();
	openWithFailure = null;
});
await check("打开失败：官方入口（在访达中显示）失败也会提示", async () => {
	openPathFailure = { ok: false, error: new Error("path has no verified host path") };
	render("session-menu-reveal", menuProps).props.onSelect();
	await new Promise((resolve) => setTimeout(resolve, 0));
	const toast = render("session-menu-open-toast", { t });
	assert.equal(toast.props.text, 'open.failedWith|{"message":"path has no verified host path"}');
	toast.props.onDone();
	openPathFailure = null;
});
await check("打开成功时不出提示", async () => {
	const { items } = openSubmenu("session-menu-open-with");
	items[4].props.onSelect();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(render("session-menu-open-toast", { t }), null, "成功时不该有任何提示");
});
await check("未读前不显示行首点，标记后显示蓝点", async () => {
	const mark = render("session-menu-unread-mark", { sessionId: "s1", t });
	assert.equal(mark, null);
	render("session-menu-mark-unread", menuProps).props.onSelect();
	const marked = render("session-menu-unread-mark", { sessionId: "s1", t });
	assert.ok(marked !== null);
	assert.equal(JSON.stringify(marked).includes("dsm-dot"), true);
});
await check("复制二级面板里两项各自写剪贴板", async () => {
	const { items } = openSubmenu("session-menu-copy");
	assert.equal(items.length, 2, "会话 ID 与工作目录各一项");
	assert.equal(items[0].props.children, "menu.copyId");
	assert.equal(items[1].props.children, "menu.copyPath");
	items[0].props.onSelect();
	items[1].props.onSelect();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(clipboardWrites, ["s1", "$WORKSPACE"]);
});
await check("悬浮卡补充工作目录 / 报错 / 未读", async () => {
	const idle = JSON.stringify(render("session-menu-hover-info", { sessionId: "s1", t }));
	assert.equal(idle.includes("$WORKSPACE"), true, "应显示工作目录");
	assert.equal(idle.includes("hover.unread"), true, "应显示未读标记");
	rows.s1.projectionValues = { sessionMenuStatus: { phase: "error", message: "capacity" } };
	const failed = JSON.stringify(render("session-menu-hover-info", { sessionId: "s1", t }));
	assert.equal(failed.includes("status.errorWith"), true, "应带上错误原因");
	assert.equal(failed.includes("capacity"), true, "错误原因应原样带出");
});
await check("「在访达中显示」用行上的 cwd 调官方 Remote", async () => {
	render("session-menu-reveal", menuProps).props.onSelect();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(calls.opened.at(-1), { path: "$WORKSPACE" });
});
await check("「在访达中显示」这句标签跟着宿主平台走（宿主报 darwin → 访达）", async () => {
	/*
	 * 平台只在插件挂载 Remote 时问一次并常驻，所以这里只能验当前那一次拿到的值；
	 * Windows / Linux 两个分支是同表查键，由上面的「中英文案键完全对齐」兜住键都存在。
	 */
	assert.equal(hostPlatformValue, "darwin", "本用例的前提是宿主 stub 报 darwin");
	assert.equal(render("session-menu-reveal", menuProps).props.children, "menu.revealFinder");
});
await check("报错投影亮红点", async () => {
	rows.s1.projectionValues = { sessionMenuStatus: { phase: "error", message: "capacity" } };
	const mark = render("session-menu-unread-mark", { sessionId: "s1", t });
	assert.equal(JSON.stringify(mark).includes("error"), true);
	rows.s1.projectionValues = { sessionMenuStatus: { phase: "idle", message: "" } };
});

console.log("# 4. 归档行删除按钮 → 确认弹窗 → 真删");
const clickDelete = () => {
	const tooltip = render("session-menu-row-delete", { sessionId: "s1", displayTitle: "会话一", t });
	const button = tooltip.props.children;
	let stopped = false;
	button.props.onClick({ stopPropagation: () => { stopped = true; } });
	return stopped;
};
await check("归档行渲染垃圾桶按钮且阻止冒泡", async () => {
	assert.equal(clickDelete(), true);
});
await check("弹窗宿主随后渲染出确认表单（无勾选框）", async () => {
	const host = render("session-menu-delete-dialog", { t });
	assert.ok(host !== null, "打开请求后应渲染弹窗");
	// 嵌套组件也要走 hooks 运行时（否则它的 useState 拿不到当前组件）
	const form = renderComponent(host.type, host.props);
	assert.equal(form.type, primitives.Modal);
	const labels = JSON.stringify(form.props).includes("delete.confirm");
	assert.equal(labels, true);
	assert.equal("checkbox" in form.props, false);
	globalThis.__form = form;
});
await check("点确认 → 调宿主 deleteSession → 关弹窗并清未读", async () => {
	const form = globalThis.__form;
	const [cancelButton, confirmButton] = form.props.footer.props.children;
	assert.equal(cancelButton.props.children, "delete.cancel");
	confirmButton.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.deepEqual(calls.deleted, ["s1"]);
	const host = render("session-menu-delete-dialog", { t });
	assert.equal(host, null, "删除成功后弹窗应关闭");
	const mark = render("session-menu-unread-mark", { sessionId: "s1", t });
	assert.equal(mark, null, "删除后该行的未读标记应被清掉");
});

await check("删掉主视图那个会话时把主视图归位（非主视图不动）", async () => {
	assert.equal(calls.clearedMain, 0, "上一步删的是非主视图会话，不该动主视图");
	rows.s1.retainedBy = { mainView: 1 };
	clickDelete();
	const host = render("session-menu-delete-dialog", { t });
	const form = renderComponent(host.type, host.props);
	const [, confirmButton] = form.props.footer.props.children;
	confirmButton.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(calls.clearedMain, 1, "主视图会话被删后应调用 uiWorkspace.clearMain");
	assert.deepEqual(calls.deleted, ["s1", "s1"]);
	rows.s1.retainedBy = { mainView: 0 };
});

await check("删除失败（宿主内层 ok:false）时留在弹窗里报错，不静默关掉", async () => {
	deleteFailure = { ok: true, value: { ok: false, removed: false, code: "session-id-required", error: "session id is required" } };
	clickDelete();
	const host = render("session-menu-delete-dialog", { t });
	const form = renderComponent(host.type, host.props);
	const [, confirmButton] = form.props.footer.props.children;
	confirmButton.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.ok(render("session-menu-delete-dialog", { t }) !== null, "失败时弹窗必须留着");
	const after = renderComponent(host.type, host.props);
	assert.equal(after.props.children[2].props.children, 'delete.failedWith|{"message":"host.sessionIdRequired"}', "宿主报的是码，这里应是当前语言的句子");
	deleteFailure = null;
	// 收尾：再点一次确认（这次会成功），把弹窗关掉，免得影响后面的用例
	const [, retry] = after.props.footer.props.children;
	retry.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(render("session-menu-delete-dialog", { t }), null, "重试成功后弹窗应关闭");
});
await check("删不掉磁盘目录（remove-failed）时同样留在弹窗里，报的是翻译过的原因", async () => {
	deleteFailure = { ok: true, value: { ok: false, removed: false, code: "remove-failed", error: 'directory "x" came back after removal' } };
	clickDelete();
	const host = render("session-menu-delete-dialog", { t });
	const form = renderComponent(host.type, host.props);
	const [, confirmButton] = form.props.footer.props.children;
	confirmButton.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 5));
	const after = renderComponent(host.type, host.props);
	assert.equal(after.props.children[2].props.children, 'delete.failedWith|{"message":"host.removeFailed"}', "应翻成当前语言，而不是摊出宿主那句英文");
	deleteFailure = null;
	// 收尾：重试一次让它删成功，把弹窗关掉
	const [, retry] = after.props.footer.props.children;
	retry.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(render("session-menu-delete-dialog", { t }), null, "重试成功后弹窗应关闭");
});

console.log("# 5. 删除所有已归档会话（标题行按钮）");
/** 换归档集与当前可见的会话行，再推一次工作区列表 —— 等价于真实页面里列表刷新后按钮重新同步。 */
const setArchivedView = (archivedIds, visibleIds) => {
	workspacesSnapshot = { archivedSessionIds: archivedIds, pinnedSessionIds: [] };
	visibleSessionRows = visibleIds.map((id) => {
		const row = new FakeNode("div");
		row.setAttribute("data-row-key", `session:${id}`);
		return row;
	});
	publishWorkspaces();
};
const headerButton = () => headerRow.children.find((node) => node.getAttribute("data-session-menu-header") !== null);
await check("归档视图里标题行出现按钮：阻止冒泡、提示带数量、打开的是批量弹窗", async () => {
	setArchivedView(["s1"], ["s1"]);
	const button = headerButton();
	assert.ok(button !== void 0, "归档视图里标题行应出现批量删除按钮");
	assert.equal(button.style.display, "", "归档视图里应当可见");
	assert.match(button.title, /deleteArchivedCount/);
	assert.equal(button.getAttribute("aria-label"), button.title);
	assert.equal(button.getAttribute("data-tone"), "danger");
	let stopped = false;
	button.listeners.click({ stopPropagation: () => { stopped = true; } });
	assert.equal(stopped, true, "点按钮不该把事件冒泡给会话行");
	const host = render("session-menu-delete-dialog", { t });
	const form = renderComponent(host.type, host.props);
	const text = JSON.stringify(form.props);
	assert.equal(text.includes("delete.archivedTitle"), true);
	assert.equal(text.includes("delete.archivedDesc"), true);
	assert.equal(text.includes("delete.archivedConfirm"), true);
	assert.equal(text.includes("delete.title"), false, "批量删除不该复用单条删除的文案");
});
await check("点「全部删除」→ 调宿主 deleteSessions → 关弹窗", async () => {
	const host = render("session-menu-delete-dialog", { t });
	const form = renderComponent(host.type, host.props);
	const [, confirmButton] = form.props.footer.props.children;
	confirmButton.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.deepEqual(calls.bulkDeleted, [["s1"]]);
	assert.equal(render("session-menu-delete-dialog", { t }), null, "批量删除成功后弹窗应关闭");
});
await check("批量部分失败时报出「已删除 x 个，y 个失败」，并把弹窗留着", async () => {
	setArchivedView(["s1"], ["s1"]);
	headerButton().listeners.click({ stopPropagation: () => {} });
	deleteFailure = { ok: true, value: { ok: true, deleted: 1, failed: 1, error: "1 session(s) could not be deleted" } };
	const host = render("session-menu-delete-dialog", { t });
	const form = renderComponent(host.type, host.props);
	const [, confirmButton] = form.props.footer.props.children;
	confirmButton.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.ok(render("session-menu-delete-dialog", { t }) !== null, "部分失败时弹窗应留着报数");
	const after = renderComponent(host.type, host.props);
	assert.equal(after.props.children[1].props.children, 'delete.archivedPartial|{"done":1,"failed":1}');
	deleteFailure = null;
	const [, retry] = after.props.footer.props.children;
	retry.props.onClick();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(render("session-menu-delete-dialog", { t }), null);
});
await check("归档行的右键菜单里也有批量删除项，未归档行没有", async () => {
	const item = render("session-menu-delete-archived", menuProps);
	assert.ok(item !== null, "已归档的会话应出现批量删除项");
	assert.equal(item.props.children, "menu.deleteArchived");
	assert.equal(item.props.danger, true);
	workspacesSnapshot = { archivedSessionIds: [], pinnedSessionIds: [] };
	assert.equal(render("session-menu-delete-archived", menuProps), null, "未归档的会话不该出现批量删除项");
	workspacesSnapshot = { archivedSessionIds: ["s1"], pinnedSessionIds: [] };
});
await check("视图里还有未归档的会话时，标题行按钮隐身", async () => {
	setArchivedView(["s1"], ["s1", "s2"]);
	assert.equal(headerButton().style.display, "none");
});
await check("一个归档会话都没有时，标题行按钮隐身", async () => {
	setArchivedView([], ["s2"]);
	assert.equal(headerButton().style.display, "none");
});
await check("标题行不在了（侧边栏收起）时，按钮从 DOM 里摘掉", async () => {
	setArchivedView(["s1"], ["s1"]);
	assert.equal(headerButton().style.display, "");
	headerPresent = false;
	publishWorkspaces();
	assert.equal(headerButton(), void 0, "找不到锚点时应把按钮摘掉");
	headerPresent = true;
	publishWorkspaces();
	assert.ok(headerButton() !== void 0, "锚点回来后应重新挂上");
});
await check("卸载时移除按钮并断开观察器", async () => {
	for (const cleanup of cleanups) cleanup();
	assert.equal(headerButton(), void 0);
	assert.equal(observers.length > 0 && observers.every((observer) => observer.disconnected), true);
});

console.log("# 6. 设置区块（settings.section）与逐项开关");

/**
 * 设置区块的注册 id；八个开关的键与小节里的顺序一致。
 * 键名同时是 `client.js` 里 `ITEM_KEYS` 的契约：少一个就意味着有一项功能永远关不掉。
 */
const SETTINGS_ID = "session-menu";
const SWITCH_KEYS = ["markUnread", "copy", "reveal", "openWith", "delete", "deleteArchived", "statusDots", "hoverInfo"];
/** 开关的存储键：测试直接读它验持久化。 */
const ITEMS_KEY = "dsh.session-menu.items.v1";
/**
 * 二级开关的存储键：与一级那份**分开**存，旧版本插件重写 items.v1 时不会把它抹掉。
 * 键名同时是 `client.js` 里 `CHILDREN_KEY` 的契约。
 */
const CHILDREN_KEY = "dsh.session-menu.itemChildren.v1";

/**
 * 按属性在渲染树里找一个节点（替身不提交 DOM，只能自己走树）。
 * @param element - 根元素。
 * @param attr - 属性名。
 * @param value - 属性值。
 * @returns 命中的元素，或 undefined。
 */
const findByAttr = (element, attr, value) => {
	if (element === null || typeof element !== "object") return void 0;
	if (element.props?.[attr] === value) return element;
	const children = element.props?.children;
	for (const child of Array.isArray(children) ? children : [children]) {
		const hit = findByAttr(child, attr, value);
		if (hit !== void 0) return hit;
	}
	return void 0;
};

/**
 * 取一个节点的子节点数组：与真实 React 一致，只有一个子节点时 `props.children` 不是数组。
 * @param element - 父元素。
 * @returns 子节点数组（没有子节点时为空数组）。
 */
const childNodes = (element) => {
	const children = element.props?.children;
	if (children === void 0 || children === null) return [];
	return Array.isArray(children) ? children : [children];
};

/**
 * 渲染设置区块并取出八行开关。
 * @param renderSection - 用哪个实例渲染（主实例或某个隔离实例）。
 * @returns `[{ key, row, control }]`。
 */
const readSettings = (renderSection) => {
	const section = renderSection(SETTINGS_ID, { t });
	assert.equal(section.type, "section");
	const rows = [];
	for (const key of SWITCH_KEYS) {
		const row = findByAttr(section, "data-session-menu-setting", key);
		assert.ok(row !== void 0, `设置区块里缺 ${key} 这一行`);
		const control = row.props.children[1];
		assert.equal(control.type, primitives.Switch, `${key} 应渲染官方 Switch`);
		rows.push({ key, row, control });
	}
	return rows;
};

/** 翻动主实例的某个开关（每次都重新渲染设置区块，不拿过期节点）。 */
const toggleSetting = (key, enabled) => {
	const row = readSettings(render).find((entry) => entry.key === key);
	row.control.props.onChange(enabled);
};

/**
 * 假 localStorage。
 * @param stored - 预置在开关那个键下的原文（脏数据用例直接塞别的字符串）。
 * @param fail - true 时读写都抛错（隐私模式 / 配额用尽）。
 * @param childStored - 预置在二级开关那个键下的原文（undefined 表示这台机器没有二级记录）。
 */
function fakeStorage(stored, fail = false, childStored) {
	const map = new Map();
	if (stored !== void 0) map.set(ITEMS_KEY, String(stored));
	if (childStored !== void 0) map.set(CHILDREN_KEY, String(childStored));
	return {
		getItem: (key) => {
			if (fail) throw new Error("storage is not available");
			return map.has(key) ? map.get(key) : null;
		},
		setItem: (key, value) => {
			if (fail) throw new Error("storage is not available");
			map.set(key, String(value));
		},
		removeItem: (key) => map.delete(key),
		/** 读回某个键的原文（断言持久化用）。 */
		raw: (key) => (map.has(key) ? map.get(key) : null)
	};
}

/**
 * 装上假 localStorage，并在 restore() 里还原：插件在工厂期读一次存储，之后只在写的时候回头看。
 * @param raw - 预置的原文，undefined 表示这台机器没有 localStorage。
 * @param fail - true 时读写都抛错。
 * @param childRaw - 预置的二级开关原文。
 */
function useStorage(raw, fail = false, childRaw) {
	const previous = globalThis.localStorage;
	const storage = raw === void 0 && fail === false && childRaw === void 0 ? void 0 : fakeStorage(raw, fail, childRaw);
	if (storage === void 0) delete globalThis.localStorage;
	else globalThis.localStorage = storage;
	return {
		storage,
		restore: () => {
			if (previous === undefined) delete globalThis.localStorage;
			else globalThis.localStorage = previous;
		}
	};
}

/** 隔离实例用到的替身 require：只认 seed 表里的两个包。 */
const requireStub = (name) => {
	if (name === "react") return React;
	if (name === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
	throw new Error(`unexpected require: ${name}`);
};

let instanceSeq = 0;
/**
 * 用一份全新的 localStorage 启动同一个 bundle 的第二个实例。
 *
 * 模块缓存按 URL 区分（`?case=N`），所以每个实例都有自己的开关存储、注册表与 effect 清理函数；
 * 服务替身仍共用主实例那一份（sessions / workspaces / remote 的夹具本来就是只读共享的）。
 *
 * @param raw - 预置的存储原文，undefined 表示没有记录。
 * @param fail - true 时存储读写都抛错。
 * @param childRaw - 预置的二级开关原文。
 * @returns 隔离实例的注册表、渲染器与卸载函数。
 */
async function bootInstance(raw, fail = false, childRaw) {
	const { storage, restore } = useStorage(raw, fail, childRaw);
	try {
		await import(`../client.js?case=${instanceSeq += 1}`);
		const spec = loaded[loaded.length - 1];
		const moduleExports2 = spec.factory(requireStub);
		const regs = [];
		const disposers = [];
		moduleExports2.apply({
			effect: (fn) => {
				const cleanup = fn();
				if (typeof cleanup === "function") disposers.push(cleanup);
				return typeof cleanup === "function" ? cleanup : () => {};
			},
			locale: { register: () => {}, bind: () => t },
			slots: {
				register: (registration, Component) => ({ ...registration, Component }),
				inject: (key, generator) => {
					collectRegistrations(generator, regs);
				},
				/** 与主实例同源：内核自己注册的菜单行。 */
				entriesOfSlot: (key) => (key === "sidebar.workspaces.session.menu.item" ? nativeMenuEntries : [])
			},
			get: (name) => ctx.get(name)
		});
		await new Promise((resolve) => setTimeout(resolve, 5));
		return {
			exports: moduleExports2,
			storage,
			registrations: regs,
			render: (id, props) => renderComponent(regs.find((entry) => entry.id === id).Component, props),
			/** 卸载这个实例：跑掉它自己的 effect 清理函数。 */
			unmount: () => {
				for (const cleanup of disposers) cleanup();
			}
		};
	} finally {
		restore();
	}
}

await check("设置区块按技能那套契约注册：name / id / order / label / locale", async () => {
	assert.equal(globalThis.localStorage, void 0, "本用例的前提是这台机器还没有开关记录");
	const entry = byId(SETTINGS_ID);
	assert.ok(entry !== void 0, "应注册一个 id 为 session-menu 的 settings.section 条目");
	assert.equal(entry.name, "settings.section");
	assert.equal(entry.order, 30);
	assert.equal(entry.locale, "session-menu");
	assert.equal(entry.label(), "settings.title", "导航标题必须走当前语言的字典，而不是写死的字符串");
	assert.equal(typeof entry.Component, "function");
});
await check("没有存储记录时八项全开（默认行为与加设置之前一致）", async () => {
	const switchRows = readSettings(render);
	assert.deepEqual(switchRows.map((entry) => entry.key), SWITCH_KEYS);
	for (const { key, control } of switchRows) assert.equal(control.props.checked, true, `${key} 默认应为开`);
	for (const id of [
		"session-menu-mark-unread",
		"session-menu-copy",
		"session-menu-reveal",
		"session-menu-open-with",
		"session-menu-delete",
		"session-menu-delete-archived",
		"session-menu-hover-info"
	]) {
		assert.ok(render(id, menuProps) !== null, `${id} 默认应在`);
	}
	assert.ok(render("session-menu-row-delete", { sessionId: "s1", displayTitle: "会话一", t }) !== null, "归档行的删除按钮默认应在");
	rows.s1.projectionValues = { sessionMenuStatus: { phase: "error", message: "capacity" } };
	assert.ok(render("session-menu-unread-mark", { sessionId: "s1", t }) !== null, "行首状态点默认应在");
	rows.s1.projectionValues = { sessionMenuStatus: { phase: "idle", message: "" } };
});
await check("关掉 markUnread：未读项不渲染，其它项不受影响，改回即恢复（不用重启）", async () => {
	/* 装一份空存储来收写入：插件在工厂期已经读过一次（那时没有存储），之后只在写的时候回头看。 */
	const { storage, restore } = useStorage("{}");
	try {
		/* 先造出一个未读标记：蓝点归 statusDots 管，关掉菜单项不该顺手把点也弄没。 */
		render("session-menu-mark-unread", menuProps).props.onSelect();
		assert.ok(render("session-menu-unread-mark", { sessionId: "s1", t }) !== null, "标记后行首应出现蓝点");
		toggleSetting("markUnread", false);
		assert.equal(render("session-menu-mark-unread", menuProps), null, "关掉后「标记为未读」应完全不渲染");
		for (const id of ["session-menu-copy", "session-menu-reveal", "session-menu-open-with", "session-menu-delete"]) {
			assert.ok(render(id, menuProps) !== null, `${id} 不该受 markUnread 影响`);
		}
		assert.ok(render("session-menu-unread-mark", { sessionId: "s1", t }) !== null, "未读蓝点归 statusDots 管，不该被 markUnread 关掉");
		toggleSetting("markUnread", true);
		assert.ok(render("session-menu-mark-unread", menuProps) !== null, "改回开后立即恢复");
		const persisted = JSON.parse(storage.raw(ITEMS_KEY));
		assert.equal(persisted.markUnread, true);
		assert.deepEqual(Object.keys(persisted).sort(), [...SWITCH_KEYS].sort(), "八个键都要落盘");
	} finally {
		restore();
	}
});

await check("关掉 delete + deleteArchived：永久删除与批量删除都不渲染，且不残留多余分隔线", async () => {
	setArchivedView(["s1"], ["s1"]);
	toggleSetting("delete", false);
	toggleSetting("deleteArchived", false);
	assert.equal(render("session-menu-delete", menuProps), null, "「永久删除会话」应完全不渲染");
	assert.equal(render("session-menu-delete-archived", menuProps), null, "「删除所有已归档会话」应完全不渲染");
	assert.equal(render("session-menu-row-delete", { sessionId: "s1", displayTitle: "会话一", t }), null, "归档行上的永久删除按钮同属 delete");
	/* 删除项自带的那条分隔线长在它返回的 Fragment 里：返回 null 就一起没了，不会留下孤零零的一条线。 */
	assert.equal(JSON.stringify(render("session-menu-delete", menuProps)), "null");
	/* 反证：还在的复制那组，它自己的分隔线必须留着（别把「不留空壳」做成了「干掉所有分隔线」）。 */
	const { separator } = unwrapTrigger(render("session-menu-copy", submenuProps));
	assert.ok(separator !== null, "复制那组的分隔线不该被牵连");
	toggleSetting("delete", true);
	toggleSetting("deleteArchived", true);
	assert.ok(render("session-menu-delete", menuProps) !== null, "改回开后立即恢复");
	assert.ok(render("session-menu-delete-archived", menuProps) !== null, "改回开后立即恢复");
	assert.ok(render("session-menu-row-delete", { sessionId: "s1", displayTitle: "会话一", t }) !== null, "改回开后立即恢复");
});
await check("关掉 copy：带分隔线的二级菜单整组消失，不留孤零零的一条线", async () => {
	const before = unwrapTrigger(render("session-menu-copy", submenuProps));
	assert.ok(before.separator !== null, "前提：复制那组自带分隔线");
	toggleSetting("copy", false);
	assert.equal(render("session-menu-copy", submenuProps), null, "整组（含分隔线）都不该渲染");
	toggleSetting("copy", true);
	assert.ok(unwrapTrigger(render("session-menu-copy", submenuProps)).separator !== null, "改回开后分隔线应跟着回来");
});
await check("关掉 statusDots：行首的红点与蓝点都不渲染", async () => {
	rows.s1.projectionValues = { sessionMenuStatus: { phase: "error", message: "capacity" } };
	assert.ok(render("session-menu-unread-mark", { sessionId: "s1", t }) !== null, "前提：报错时会亮红点");
	toggleSetting("statusDots", false);
	assert.equal(render("session-menu-unread-mark", { sessionId: "s1", t }), null, "红点不该渲染");
	rows.s1.projectionValues = { sessionMenuStatus: { phase: "idle", message: "" } };
	assert.equal(render("session-menu-unread-mark", { sessionId: "s1", t }), null, "蓝点不该渲染");
	toggleSetting("statusDots", true);
	assert.ok(render("session-menu-unread-mark", { sessionId: "s1", t }) !== null, "改回开后立即恢复");
});
await check("关掉 hoverInfo：悬浮卡不再追加插件那几行", async () => {
	assert.ok(render("session-menu-hover-info", { sessionId: "s1", t }) !== null, "前提：悬浮卡里有插件那几行");
	toggleSetting("hoverInfo", false);
	assert.equal(render("session-menu-hover-info", { sessionId: "s1", t }), null, "关掉后不该再追加任何行");
	toggleSetting("hoverInfo", true);
	assert.ok(render("session-menu-hover-info", { sessionId: "s1", t }) !== null, "改回开后立即恢复");
});
await check("关掉 deleteArchived：标题行上的批量删除按钮从 DOM 里摘掉（不是隐藏）", async () => {
	setArchivedView(["s1"], ["s1"]);
	const instance = await bootInstance();
	assert.ok(headerButton() !== void 0, "新实例在归档视图里应把按钮挂上");
	assert.equal(headerButton().style.display, "");
	const toggleHere = (key, enabled) => {
		const entry = readSettings(instance.render).find((row) => row.key === key);
		entry.control.props.onChange(enabled);
	};
	toggleHere("deleteArchived", false);
	assert.equal(headerButton(), void 0, "关掉后按钮应离开 DOM，而不是留在那儿当空壳");
	toggleHere("deleteArchived", true);
	assert.ok(headerButton() !== void 0, "改回开后按钮回来");
	instance.unmount();
	assert.equal(headerButton(), void 0, "实例卸载后按钮也应摘掉");
});
await check("脏数据（不是 JSON / 值类型不对 / 读存储抛错）→ 退回全开且不崩", async () => {
	for (const raw of ["不是JSON", "null", JSON.stringify("字符串"), JSON.stringify([1, 2, 3]), JSON.stringify({ markUnread: "yes", copy: 0, reveal: null })]) {
		const instance = await bootInstance(raw);
		for (const { key, control } of readSettings(instance.render)) {
			assert.equal(control.props.checked, true, `${JSON.stringify(raw)} 下 ${key} 应退回默认（开）`);
		}
		assert.ok(instance.render("session-menu-mark-unread", menuProps) !== null, `${JSON.stringify(raw)} 下菜单不该整块消失`);
		instance.unmount();
	}
	/* 存储本身读不了（隐私模式）：同样退回全开，而且改开关时写失败也不能把界面弄崩。 */
	const broken = await bootInstance(void 0, true);
	assert.equal(readSettings(broken.render).every((entry) => entry.control.props.checked === true), true);
	readSettings(broken.render).find((entry) => entry.key === "copy").control.props.onChange(false);
	assert.equal(broken.render("session-menu-copy", menuProps), null, "写失败也要本次会话内立即生效");
	broken.unmount();
	/* 反过来：存了合法值就必须照做，别把「兜底」做成「一律忽略」。 */
	const stored = await bootInstance(JSON.stringify({ markUnread: false, copy: true }));
	const storedRows = readSettings(stored.render);
	assert.equal(storedRows.find((entry) => entry.key === "markUnread").control.props.checked, false);
	assert.equal(storedRows.find((entry) => entry.key === "copy").control.props.checked, true);
	assert.equal(stored.render("session-menu-mark-unread", menuProps), null);
	assert.ok(stored.render("session-menu-copy", menuProps) !== null);
	stored.unmount();
});
await check("八项全关：插件所有入口都不渲染，设置区块本身还在（否则再也开不回来）", async () => {
	for (const key of SWITCH_KEYS) toggleSetting(key, false);
	for (const id of [
		"session-menu-mark-unread",
		"session-menu-copy",
		"session-menu-reveal",
		"session-menu-open-with",
		"session-menu-delete",
		"session-menu-delete-archived",
		"session-menu-row-delete",
		"session-menu-hover-info",
		"session-menu-unread-mark"
	]) {
		assert.equal(render(id, menuProps), null, `${id} 应完全不渲染`);
	}
	const rows = readSettings(render);
	assert.equal(rows.every((entry) => entry.control.props.checked === false), true, "八个开关都应显示为关");
	for (const key of SWITCH_KEYS) toggleSetting(key, true);
	assert.equal(readSettings(render).every((entry) => entry.control.props.checked === true), true, "全部改回开后设置区块应跟着更新");
});
await check("八项全都长了一行说明，一行不少；整页不再有顶部说明段", async () => {
	const section = render(SETTINGS_ID, { t });
	assert.equal(findByAttr(section, "className", "dsm-settings-title").props.children, "settings.title");
	assert.equal(findByAttr(section, "className", "dsm-settings-desc"), void 0, "顶部那行说明应整段删掉");
	const rows = readSettings(render);
	assert.equal(rows.length, 8, "八项都要渲染出来");
	for (const { key, row } of rows) {
		const column = childNodes(row.props.children[0]);
		const hint = findByAttr(row, "className", "dsm-settings-hint");
		assert.equal(row.props.children[1].props.label, `settings.${key}.label`, `${key} 的标题`);
		assert.equal(column.length, 2, `${key} 应是标题 + 一行说明`);
		assert.equal(hint, column[1], `${key} 的说明行应在标题下面`);
		assert.equal(hint.props.children, `settings.${key}.hint`, `${key} 的说明要取自己的键`);
		const expectedTitle = key === "openWith" || key === "copy" ? "dsm-settings-label-row" : "dsm-settings-label";
		assert.equal(column[0].props.className, expectedTitle, `${key} 的标题仍是原来那个节点`);
	}
});

console.log("# 7. 设置导航图标（按标题认行、打标记、卸载清干净）");

/** Fake settings-nav row; the real button's text is the glyph plus the localized label. */
const navButton = (text) => {
	const button = new FakeNode("button");
	button.textContent = text;
	return button;
};

await check("只给标题等于当前语言 label 的那一行打标记，顺手清掉别人身上的标记", async () => {
	settingsNavButtons = [navButton("账号"), navButton("settings.title"), navButton("技能")];
	settingsNavButtons[0].setAttribute(NAV_MARKER, "");
	const instance = await bootInstance();
	assert.equal(settingsNavButtons[1].getAttribute(NAV_MARKER), "", "标题匹配的那一行应被打上标记");
	assert.equal(settingsNavButtons[0].getAttribute(NAV_MARKER), null, "标题不匹配的行不许留标记");
	assert.equal(settingsNavButtons[2].getAttribute(NAV_MARKER), null, "认不出自己那行时也不能乱标记");
	instance.unmount();
	assert.equal(settingsNavButtons[1].getAttribute(NAV_MARKER), null, "卸载后标记要摘干净");
	settingsNavButtons = [];
});
await check("没有 MutationObserver 时不抛错，而且仍按当前 DOM 同步一次", async () => {
	settingsNavButtons = [navButton("settings.title")];
	const saved = globalThis.MutationObserver;
	delete globalThis.MutationObserver;
	let instance;
	try {
		instance = await bootInstance();
	} finally {
		globalThis.MutationObserver = saved;
	}
	assert.equal(settingsNavButtons[0].getAttribute(NAV_MARKER), "", "没有观察器也要先同步一次");
	instance.unmount();
	assert.equal(settingsNavButtons[0].getAttribute(NAV_MARKER), null, "卸载后标记要摘干净");
	settingsNavButtons = [];
});

console.log("# 8. 二级开关（可展开的分组）");

/**
 * 折叠 / 展开某个一级项（两组默认就是展开的），返回重新渲染后的设置区块。
 * @param renderHere - 用哪个实例渲染。
 * @param key - 一级项的键。
 * @returns 点过三角之后的设置区块。
 */
const toggleExpander = (renderHere, key) => {
	const button = findByAttr(renderHere(SETTINGS_ID, { t }), "data-session-menu-expander", key);
	assert.ok(button !== void 0, `${key} 这一行应有一个展开三角`);
	button.props.onClick();
	return renderHere(SETTINGS_ID, { t });
};

/** 取某个分组已展开的二级区（顺带断言它确实展开了）。 */
const childBlock = (renderHere, group) => {
	const block = findByAttr(renderHere(SETTINGS_ID, { t }), "data-session-menu-children", group);
	assert.ok(block !== void 0, `${group} 的二级区应该已经展开`);
	return block;
};

/** 取一条二级开关行。 */
const childRow = (renderHere, group, key) => {
	const row = findByAttr(renderHere(SETTINGS_ID, { t }), "data-session-menu-child", `${group}:${key}`);
	assert.ok(row !== void 0, `设置里应有 ${group}:${key} 这条二级开关`);
	return row;
};

/**
 * 启动一个隔离实例并等它把设置页要用的应用清单拿回来。
 * 主实例在「卸载时移除按钮并断开观察器」那条用例里已经跑过 effect 清理，Remote 句柄没了；
 * 要验「有应用」的分支必须用一个新实例（隔离实例的 Remote 是刚挂上的）。
 */
const bootSettingsInstance = async () => {
	const instance = await bootInstance();
	instance.render(SETTINGS_ID, { t });
	await new Promise((resolve) => setTimeout(resolve, 5));
	return instance;
};

/** 隔离实例返回时会还原全局存储；要断言它的写入，就得在交互期间把存储装回去。 */
const withStorage = (instance, fn) => {
	const previous = globalThis.localStorage;
	globalThis.localStorage = instance.storage;
	try {
		return fn();
	} finally {
		if (previous === undefined) delete globalThis.localStorage;
		else globalThis.localStorage = previous;
	}
};

await check("只有带二级项的分组才有三角，其余六项的行结构一字未变", async () => {
	const section = render(SETTINGS_ID, { t });
	for (const key of ["copy", "openWith"]) {
		const button = findByAttr(section, "data-session-menu-expander", key);
		assert.ok(button !== void 0, `${key} 应有展开三角`);
		assert.equal(button.props["aria-expanded"], true, "默认应是展开的");
		assert.equal(button.props["data-expanded"], "true", "展开时三角指向下");
		assert.equal(button.props.children.type, primitives.IconTriangleRightFillRegular, "三角走官方那个图标组件，不再是自绘实心块");
		assert.equal(button.props.children.props.className, "dsm-settings-triangle", "图标上留着本插件的类名给 CSS 挂钩");
		assert.equal(button.props.children.props.size, void 0, "不传 size，用图标自己的 14px 默认值");
		assert.equal(button.props["aria-label"], "settings.collapse");
	}
	for (const key of SWITCH_KEYS.filter((each) => each !== "copy" && each !== "openWith")) {
		assert.equal(findByAttr(section, "data-session-menu-expander", key), void 0, `${key} 不该有三角`);
	}
	/* 行仍然是「[说明区, Switch]」两段：三角长在说明区内部，没有挤进行结构，所以另外六项原样不变。 */
	for (const { row, control } of readSettings(render)) {
		assert.equal(row.props.children.length, 2, "行的子节点仍是说明区 + Switch");
		assert.equal(control.type, primitives.Switch);
	}
	/* 说明区里现在统一是「标题 + 一行说明」；带分组的那两行标题包在 label-row 里。用 childNodes 取，单子节点与真实 React 一样不包成数组。 */
	const copyColumn = childNodes(findByAttr(section, "data-session-menu-setting", "copy").props.children[0]);
	assert.equal(copyColumn.length, 2, "copy 那行是标题 + 一行说明");
	const labelRow = copyColumn[0];
	assert.equal(labelRow.props.className, "dsm-settings-label-row");
	assert.equal(labelRow.props.children[0].props["data-session-menu-expander"], "copy", "三角应在标题左边");
	assert.equal(labelRow.props.children[1].props.children, "settings.copy.label");
	const plainColumn = childNodes(findByAttr(section, "data-session-menu-setting", "reveal").props.children[0]);
	assert.equal(plainColumn.length, 2, "不能展开的行也是标题 + 说明，只是没有三角");
	assert.equal(plainColumn[0].props.className, "dsm-settings-label", "不能展开的行还是原来那个标题节点");
});

await check("默认就是展开的：不点三角也能看到两组的二级开关", async () => {
	const section = render(SETTINGS_ID, { t });
	const block = findByAttr(section, "data-session-menu-children", "copy");
	assert.ok(block !== void 0, "不点三角就该有 copy 的二级区");
	assert.deepEqual(block.props.children.map((row) => row.props["data-session-menu-child"]), ["copy:sessionId", "copy:cwd"]);
	/* openWith 的清单要活的 Remote 句柄，用隔离实例验。 */
	const instance = await bootSettingsInstance();
	try {
		const apps = findByAttr(instance.render(SETTINGS_ID, { t }), "data-session-menu-children", "openWith");
		assert.ok(apps !== void 0, "不点三角就该有 openWith 的二级区");
		assert.equal(apps.props.children.length, 4, "四个应用都该列出来");
		assert.equal(findByAttr(instance.render(SETTINGS_ID, { t }), "data-session-menu-expander", "openWith").props["aria-expanded"], true);
	} finally {
		instance.unmount();
	}
});

await check("三角的样式对齐左侧栏那个箭头：官方图标色、展开转 90°、带过渡，说明段样式已删", async () => {
	const instance = await bootInstance();
	try {
		const head = globalThis.document.head.children;
		const style = head[head.length - 1];
		assert.equal(style.tagName, "STYLE", "最后注入的样式应是本插件的");
		const css = style.textContent;
		assert.equal(css.includes(".dsm-settings-desc"), false, "顶部说明段的样式应一起删掉");
		assert.match(css, /\.dsm-settings-expander\{[^}]*width:24px;height:24px/, "可点区至少 24×24");
		assert.match(css, /\.dsm-settings-expander\{[^}]*color:var\(--dsw-alias-label-caption\)/, "颜色跟左侧栏工作区行的箭头一致（label-caption）");
		assert.equal(
			css.includes(".dsm-settings-triangle{width:16px;height:16px;background:currentColor"),
			false,
			"不许再有自绘的 16×16 实心黑块"
		);
		assert.equal(css.includes("clip-path"), false, "实心块靠 clip-path 画的，改成官方图标后这里不该再出现 clip-path");
		assert.match(css, /\.dsm-settings-triangle\{transition:transform \.15s var\(--ds-ease-in-out\)\}/, "过渡与左侧栏同一个 token（.15s ds-ease-in-out）");
		assert.equal(
			css.includes('.dsm-settings-expander[data-expanded="true"] .dsm-settings-triangle{transform:rotate(90deg)}'),
			true,
			"展开时转 90°"
		);
		assert.equal(
			css.includes("@media (prefers-reduced-motion:reduce){.dsm-settings-triangle{transition:none}}"),
			true,
			"与上游一样尊重减少动效"
		);
	} finally {
		instance.unmount();
	}
});

await check("二级项看得出从属：二级开关往里收 14px、标签多缩进一档、整组带一条 1px 引导线", async () => {
	const instance = await bootInstance();
	try {
		const head = globalThis.document.head.children;
		const css = head[head.length - 1].textContent;
		/* 一级开关贴在最右：一级行本身没有右侧内边距。 */
		assert.match(css, /\.dsm-settings-row\{[^}]*padding:14px 0/, "一级行不该有右侧内边距，否则两级都往回收就看不出差");
		/* 二级行右侧留出 14px，开关因此比一级明显更靠左。 */
		const childRule = /\.dsm-settings-child\{([^}]*)\}/.exec(css);
		assert.ok(childRule !== null, "应有 .dsm-settings-child 规则");
		assert.match(childRule[1], /padding:6px 14px 6px 0/, "二级行要留 14px 右侧内边距");
		/* 二级块整体缩进，并且左缘挂一条 1px 的浅色竖线标出整组范围。 */
		const blockRule = /\.dsm-settings-children\{([^}]*)\}/.exec(css);
		assert.ok(blockRule !== null, "应有 .dsm-settings-children 规则");
		assert.match(blockRule[1], /border-left:1px solid var\(--dsw-alias-border-l2\)/, "二级块左缘要有 1px 引导线");
		assert.match(blockRule[1], /margin-left:12px/, "二级块要比一级再往里让一档");
		assert.match(blockRule[1], /padding:0 0 12px 18px/, "引导线到标签之间还要留出内边距");
		assert.equal(blockRule[1].includes("border-left:1px solid var(--dsw-alias-border-l4)"), false, "引导线要用最浅那档边框色");
	} finally {
		instance.unmount();
	}
	const section = render(SETTINGS_ID, { t });
	for (const group of ["copy", "openWith"]) {
		const block = findByAttr(section, "data-session-menu-children", group);
		assert.ok(block !== void 0, `${group} 的二级块应已展开`);
		assert.equal(block.props.className, "dsm-settings-children", "二级块要带着引导线挂钩的类名");
		for (const row of block.props.children) {
			if (row.props["data-session-menu-child"] === void 0) continue;
			assert.equal(row.props.className, "dsm-settings-child", "二级行的类名要带着右侧内边距");
			assert.equal(row.props.children.length, 2, "二级行仍是「标签 + Switch」两段");
			assert.equal(row.props.children[1].type, primitives.Switch, "开关还是行的最后一个节点，靠内边距往回收");
		}
	}
});

await check("三角收起 copy 再展开：缩进列出两条二级开关，收起时二级区消失", async () => {
	const collapsed = toggleExpander(render, "copy");
	const button = findByAttr(collapsed, "data-session-menu-expander", "copy");
	assert.equal(button.props["aria-expanded"], false);
	assert.equal(button.props["data-expanded"], "false", "收起时三角指回右边");
	assert.equal(button.props["aria-label"], "settings.expand");
	assert.equal(findByAttr(collapsed, "data-session-menu-children", "copy"), void 0, "收起后二级区应消失");

	const expanded = toggleExpander(render, "copy");
	const reopened = findByAttr(expanded, "data-session-menu-expander", "copy");
	assert.equal(reopened.props["aria-expanded"], true);
	assert.equal(reopened.props["data-expanded"], "true");
	assert.equal(reopened.props["aria-label"], "settings.collapse");
	const block = findByAttr(expanded, "data-session-menu-children", "copy");
	assert.equal(block.props.className, "dsm-settings-children");
	assert.deepEqual(block.props.children.map((row) => row.props["data-session-menu-child"]), ["copy:sessionId", "copy:cwd"]);
	assert.deepEqual(block.props.children.map((row) => row.props.children[0].props.children), ["menu.copyId", "menu.copyPath"]);
	assert.equal(block.props.children.every((row) => row.props.children[1].props.checked === true), true, "默认两条都开");
	assert.equal(block.props.children.every((row) => row.props.children[1].props.disabled === false), true);
});

await check("openWith 默认展开：按宿主探测到的应用逐个列出二级开关", async () => {
	const instance = await bootSettingsInstance();
	try {
		const block = childBlock(instance.render, "openWith");
		assert.deepEqual(block.props.children.map((row) => row.props["data-session-menu-child"]), [
			"openWith:/Applications/Xcode.app",
			"openWith:/Applications/Claude.app",
			"openWith:/Applications/ChatGPT.app",
			"openWith:/System/Applications/Utilities/Terminal.app"
		]);
		/* 应用名走 appName：Xcode 用 .app 文件名（与系统语言无关），终端走字典键。 */
		assert.deepEqual(block.props.children.map((row) => row.props.children[0].props.children), ["Xcode", "Claude", "ChatGPT", "app.terminal"]);
		assert.equal(findByAttr(instance.render(SETTINGS_ID, { t }), "className", "dsm-settings-empty"), void 0, "有清单时不该出现「读不到应用」");
		assert.equal(block.props.children.every((row) => row.props.children[1].props.checked === true), true, "默认每个应用都开");
	} finally {
		instance.unmount();
	}
});

await check("一级关掉：二级变灰且值被记住；一级重开后原样恢复", async () => {
	const { storage, restore } = useStorage("{}");
	try {
		childRow(render, "copy", "cwd").props.children[1].props.onChange(false);
		assert.deepEqual(copyLabels(), ["menu.copyId"], "前提：二级关掉后菜单里只剩一条");

		toggleSetting("copy", false);
		const locked = childBlock(render, "copy");
		assert.equal(locked.props.children.every((row) => row.props.children[1].props.disabled === true), true, "一级关掉 → 二级开关应变灰");
		assert.equal(locked.props.children.every((row) => row.props["data-locked"] === "true"), true);
		assert.equal(locked.props.children[0].props.children[1].props.checked, true, "没动过的那条仍记着「开」");
		assert.equal(locked.props.children[1].props.children[1].props.checked, false, "关掉的那条仍记着「关」");
		assert.match(String(locked.props.children[1].props.children[1].props.title), /^settings\.childLocked/, "变灰时要说明为什么");
		assert.equal(render("session-menu-copy", submenuProps), null, "一级关掉 → 整组从菜单里消失");

		toggleSetting("copy", true);
		const restored = childBlock(render, "copy");
		assert.equal(restored.props.children.every((row) => row.props.children[1].props.disabled === false), true, "重开后二级恢复可点");
		assert.deepEqual(restored.props.children.map((row) => row.props.children[1].props.checked), [true, false], "重开后仍是原来的选择");
		assert.deepEqual(copyLabels(), ["menu.copyId"], "菜单侧跟着恢复成「只剩会话 ID」");

		/* 存储：一级那份扁平 map 不含二级值，二级值在自己的键下。 */
		assert.equal(JSON.parse(storage.raw(ITEMS_KEY)).copy, true);
		assert.deepEqual(JSON.parse(storage.raw(CHILDREN_KEY)), { copy: { cwd: false }, openWith: {} });
		childRow(render, "copy", "cwd").props.children[1].props.onChange(true); // 收尾
	} finally {
		restore();
	}
});

await check("关掉单个二级项只影响那一条（copy 两条互不牵连，openWith 关掉 Xcode 别的还在）", async () => {
	const { storage, restore } = useStorage("{}");
	try {
		childRow(render, "copy", "sessionId").props.children[1].props.onChange(false);
		const copyItems = copyRows();
		assert.deepEqual(copyItems.map((item) => item.props.children), ["menu.copyPath"], "只剩工作目录那一条");
		assert.equal(copyItems[0].props.icon.type, primitives.IconFolderOpenRegular, "剩下的是工作目录那条");
		for (const id of ["session-menu-mark-unread", "session-menu-reveal", "session-menu-delete"]) {
			assert.ok(render(id, menuProps) !== null, `${id} 不该受二级开关影响`);
		}
		assert.equal(JSON.parse(storage.raw(CHILDREN_KEY)).copy.sessionId, false, "关掉的那条落了盘");
		assert.equal(JSON.parse(storage.raw(CHILDREN_KEY)).copy.cwd, true, "没动的那条还是开");
		childRow(render, "copy", "sessionId").props.children[1].props.onChange(true);
	} finally {
		restore();
	}

	/* openWith 那条需要活的 Remote 句柄，用一个隔离实例验。 */
	const instance = await bootSettingsInstance();
	try {
		childRow(instance.render, "openWith", "/Applications/Xcode.app").props.children[1].props.onChange(false);
		instance.render("session-menu-open-with", submenuProps);
		await new Promise((resolve) => setTimeout(resolve, 5));
		const apps = openSubmenu("session-menu-open-with", instance.render).items.map((item) => String(item.props.children));
		assert.equal(apps.length, 4, "关掉一个应用后只少它一条");
		assert.equal(apps.some((label) => label.includes("Xcode")), false, "关掉的 Xcode 不该再列出来");
		assert.equal(apps.filter((label) => label.includes("Claude")).length, 1, "其它应用不受影响");
		childRow(instance.render, "openWith", "/Applications/Xcode.app").props.children[1].props.onChange(true);
		assert.equal(openSubmenu("session-menu-open-with", instance.render).items.length, 5, "改回开后它应回来");
	} finally {
		instance.unmount();
	}
});

await check("copy 两条二级项全关：整组（含分隔线）从菜单消失，不留空壳", async () => {
	const { restore } = useStorage("{}");
	try {
		childRow(render, "copy", "sessionId").props.children[1].props.onChange(false);
		childRow(render, "copy", "cwd").props.children[1].props.onChange(false);
		assert.equal(render("session-menu-copy", submenuProps), null, "一条都不剩时不该留一个点不开的空菜单");
		assert.ok(render("session-menu-delete", menuProps) !== null, "别的分组照旧");
		childRow(render, "copy", "sessionId").props.children[1].props.onChange(true);
		childRow(render, "copy", "cwd").props.children[1].props.onChange(true);
		assert.deepEqual(copyLabels(), ["menu.copyId", "menu.copyPath"]);
	} finally {
		restore();
	}
});

await check("宿主给不出应用清单时：展开区是一句提示，不是空壳也不报错", async () => {
	const savedCatalog = catalogApplications;
	catalogApplications = [];
	const instance = await bootInstance();
	try {
		instance.render(SETTINGS_ID, { t });
		await new Promise((resolve) => setTimeout(resolve, 5));
		const section = instance.render(SETTINGS_ID, { t });
		const block = childBlock(instance.render, "openWith");
		assert.equal(block.props.children.length, 1, "只有一句提示，没有半条开关");
		const hint = block.props.children[0];
		assert.equal(hint.props.className, "dsm-settings-empty");
		assert.equal(hint.props.children, "settings.appsUnavailable");
		assert.equal(block.props.children.every((row) => row.props["data-session-menu-child"] === void 0), true, "不该冒出任何二级开关");
		/* 一级开关本身照旧能用：读不到应用不等于整页坏掉。 */
		const parent = findByAttr(section, "data-session-menu-setting", "openWith").props.children[1];
		assert.equal(parent.props.checked, true);
		assert.equal(parent.props.disabled, void 0);
		/* 一级关掉时这句提示也还在（不是空壳），只是没有开关可灰。 */
		findByAttr(instance.render(SETTINGS_ID, { t }), "data-session-menu-setting", "openWith").props.children[1].props.onChange(false);
		const off = findByAttr(instance.render(SETTINGS_ID, { t }), "data-session-menu-children", "openWith");
		assert.equal(off.props.children[0].props.className, "dsm-settings-empty", "关掉一级也不该把提示弄丢");
	} finally {
		instance.unmount();
		catalogApplications = savedCatalog;
	}
});

await check("旧版扁平存储（没有二级键）照旧生效，写二级只动新键（向后兼容）", async () => {
	/* 已经装在用户机器上的那份原文：八个扁平布尔，没有 itemChildren 这个键。 */
	const legacy = JSON.stringify({ markUnread: false, copy: false, reveal: true, openWith: true, delete: true, deleteArchived: false, statusDots: true, hoverInfo: true });
	const instance = await bootInstance(legacy);
	try {
		instance.render(SETTINGS_ID, { t });
		await new Promise((resolve) => setTimeout(resolve, 5));
		const rows = readSettings(instance.render);
		assert.equal(rows.find((entry) => entry.key === "markUnread").control.props.checked, false, "旧的 false 仍要认");
		assert.equal(rows.find((entry) => entry.key === "copy").control.props.checked, false);
		assert.equal(rows.find((entry) => entry.key === "deleteArchived").control.props.checked, false, "旧的 false 仍要认（批量删除那条）");
		assert.equal(instance.render("session-menu-copy", submenuProps), null, "旧的 copy:false 仍然把整组关掉（含分隔线）");

		/* 二级键从没写过 → 默认全开；一级关着时它们只是变灰，值仍在。 */
		const section = instance.render(SETTINGS_ID, { t });
		const block = findByAttr(section, "data-session-menu-children", "copy");
		assert.ok(block !== void 0, "copy 的二级区默认就展开");
		assert.equal(block.props.children.every((row) => row.props.children[1].props.checked === true), true, "旧记录下二级默认全开");
		assert.equal(block.props.children.every((row) => row.props.children[1].props.disabled === true), true, "一级关着 → 二级变灰");

		withStorage(instance, () => {
			/* 翻一条二级：只写新键，旧的 items.v1 一个字符都不动。 */
			block.props.children[1].props.children[1].props.onChange(false);
			assert.equal(instance.storage.raw(ITEMS_KEY), legacy, "旧键必须原样保留，不能被新功能改写");
			assert.equal(instance.storage.raw(CHILDREN_KEY), JSON.stringify({ copy: { cwd: false }, openWith: {} }));
			assert.equal(instance.render("session-menu-copy", submenuProps), null, "一级仍关着");

			/* 一级重开：记着的选择立刻生效，菜单里只剩会话 ID。 */
			rows.find((entry) => entry.key === "copy").control.props.onChange(true);
		});
		assert.deepEqual(copyLabels(instance.render), ["menu.copyId"], "重开后菜单只剩没被关掉的那条");
		assert.deepEqual(JSON.parse(instance.storage.raw(CHILDREN_KEY)), { copy: { cwd: false }, openWith: {} }, "重开一级不该顺手把二级改回开");
	} finally {
		instance.unmount();
	}
});

await check("二级存储是脏数据（不是 JSON / 类型不对 / 分组不对）时：退回默认全开且不崩", async () => {
	for (const childRaw of [
		"不是JSON",
		"null",
		JSON.stringify("字符串"),
		JSON.stringify([1, 2, 3]),
		JSON.stringify({ copy: { sessionId: "yes", cwd: 0 }, openWith: [1, 2, 3] }),
		JSON.stringify({ 未知分组: { x: false } })
	]) {
		const instance = await bootInstance("{}", false, childRaw);
		try {
			instance.render(SETTINGS_ID, { t });
			await new Promise((resolve) => setTimeout(resolve, 5));
			const block = findByAttr(instance.render(SETTINGS_ID, { t }), "data-session-menu-children", "copy");
			assert.ok(block !== void 0, "copy 的二级区默认就展开");
			assert.equal(block.props.children.every((row) => row.props.children[1].props.checked === true), true, `${childRaw} 下二级应退回默认（开）`);
			assert.equal(block.props.children.every((row) => row.props.children[1].props.disabled === false), true);
			assert.deepEqual(copyLabels(instance.render), ["menu.copyId", "menu.copyPath"], "脏数据不该让菜单少东西");
		} finally {
			instance.unmount();
		}
	}
});

await check("内核已经注册原生「复制会话 ID」时：我们那条默认不出现，整组拍成一行", async () => {
	nativeMenuEntries.push({ options: { id: "session-id" } });
	const instance = await bootInstance("{}");
	try {
		const rows = copyRows(instance.render);
		assert.equal(rows.length, 1, "只剩「复制工作目录」一条");
		assert.equal(rows[0].props.children, "menu.copyPath");
		assert.equal(rows[0].type, primitives.MenuItemButton, "只剩一条时拍平成普通行，不再套一层点开才有内容的二级菜单");
		assert.equal(rows[0].props.icon.type, primitives.IconFolderOpenRegular);
		assert.ok(unwrapTrigger(instance.render("session-menu-copy", submenuProps)).separator !== null, "分隔线要留着");

		/* bootInstance 交回控制权时会把假存储摘掉，交互期间得自己装上，写才落在这份存储里。 */
		withStorage(instance, () => {
			const sessionRow = childRow(instance.render, "copy", "sessionId");
			assert.equal(sessionRow.props.children[1].props.checked, false, "设置里默认关：内核已经有一条了");
			assert.equal(sessionRow.props.children[1].props.disabled, false, "但用户能手动打开");
			assert.equal(instance.storage.raw(CHILDREN_KEY), null, "默认值不落盘：不能把「没人动过」写成「用户关掉了」");
		});
	} finally {
		instance.unmount();
		nativeMenuEntries.length = 0;
	}
});

await check("内核有原生那条时手动打开：两条都回来，且回到二级菜单", async () => {
	nativeMenuEntries.push({ options: { id: "session-id" } });
	const instance = await bootInstance("{}");
	try {
		withStorage(instance, () => {
			childRow(instance.render, "copy", "sessionId").props.children[1].props.onChange(true);
			assert.deepEqual(copyLabels(instance.render), ["menu.copyId", "menu.copyPath"]);
			assert.equal(Array.isArray(unwrapTrigger(instance.render("session-menu-copy", submenuProps)).element.props.items), true, "两条时仍是二级菜单");
			assert.equal(JSON.parse(instance.storage.raw(CHILDREN_KEY)).copy.sessionId, true, "用户的选择要落盘");
		});
	} finally {
		instance.unmount();
		nativeMenuEntries.length = 0;
	}
});

await check("探测不到原生那条（没有 / 形状不对 / 抛错）时，我们自己那条照常显示", async () => {
	const instance = await bootInstance("{}");
	try {
		assert.deepEqual(copyLabels(instance.render), ["menu.copyId", "menu.copyPath"], "旧内核没有原生行时照旧两条");
		for (const entry of [void 0, null, "session-id", 7, {}, { options: {} }, { options: { id: 9 } }, { options: null }, () => {
			throw new Error("探测炸了");
		}]) {
			nativeMenuEntries.push(entry);
			assert.deepEqual(copyLabels(instance.render), ["menu.copyId", "menu.copyPath"], `${JSON.stringify(entry) ?? String(entry)} 该当成「没有原生行」——宁可重复一条，也不能把功能弄丢`);
			nativeMenuEntries.length = 0;
		}
		/* 少一层包装的形状（entry.id 直接挂着）也要认出来：换构建时不该突然多出一条重复的。 */
		nativeMenuEntries.push({ id: "session-id" });
		assert.deepEqual(copyLabels(instance.render), ["menu.copyPath"], "扁平形状同样认出原生行");
		nativeMenuEntries.length = 0;
		assert.deepEqual(copyLabels(instance.render), ["menu.copyId", "menu.copyPath"], "清掉后恢复两条");
	} finally {
		instance.unmount();
		nativeMenuEntries.length = 0;
	}
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
