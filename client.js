/**
 * Client half: session context menu enhancements, the status dot at the start of a session row, the in-row
 * delete button, and the permanent delete confirmation dialog.
 *
 * The shape must be the lazy CJS factory the loader requires: no ESM / JSX, and the only requirable packages
 * are react and ui-primitives from the seed table.
 */
window.__ModuleLoader__.load({
	id: "dsh-session-menu",
	factory(require) {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		/** React element factory (this file cannot use JSX). */
		const h = React.createElement;
		/** The dialog footer needs two sibling buttons, so they are wrapped in a Fragment. */
		const Fragment = React.Fragment;

		/** Package name: both the module id and the package of the Remote contribution. */
		const PKG = "dsh-session-menu";
		/** Locale namespace. */
		const NS = "session-menu";
		/** Host Remote service key (also the wire namespace). */
		const REMOTE_NS = "sessionMenu";

		/** Chinese strings. */
		const zh = {
			"menu.markUnread": "标记为未读",
			"menu.markRead": "标记为已读",
			"menu.copyId": "复制会话 ID",
			"menu.copyPath": "复制工作目录",
			"menu.reveal": "在文件管理器中显示",
			"menu.revealFinder": "在访达中显示",
			"menu.revealExplorer": "在文件资源管理器中显示",
			"menu.copy": "复制",
			"menu.openWithTitle": "打开方式",
			"menu.openWith": "用 {name} 打开",
			"menu.delete": "永久删除会话",
			"menu.deleteArchived": "删除所有已归档会话",
			"menu.deleteArchivedCount": "删除所有已归档会话（{n} 个）",
			"hover.unread": "已标记为未读",
			"status.unread": "未读",
			"status.error": "上次运行出错",
			"status.errorWith": "上次运行出错：{message}",
			"delete.title": "要删除会话？",
			"delete.desc": "将永久删除该会话及其子智能体会话，磁盘上的会话日志一并删除。此操作无法撤销。",
			"delete.cancel": "取消",
			"delete.confirm": "删除",
			"delete.pending": "正在删除…",
			"delete.archivedTitle": "要删除所有已归档会话？",
			"delete.archivedDesc": "将永久删除全部 {n} 个已归档会话及其子智能体会话，磁盘上的会话日志一并删除。此操作无法撤销。",
			"delete.archivedConfirm": "全部删除",
			"delete.archivedPending": "正在删除…",
			"delete.archivedPartial": "已删除 {done} 个，{failed} 个失败。",
			"delete.unavailable": "删除服务未就绪，请刷新界面后重试。",
			"delete.failedWith": "删除失败：{message}",
			"open.failed": "打开失败",
			"open.failedWith": "打开失败：{message}",
			"open.unavailable": "打开服务未就绪，请刷新界面后重试。",
			"host.sessionIdRequired": "没有拿到会话 ID",
			"host.sessionIdsRequired": "没有拿到要删除的会话列表",
			"host.pathUnverified": "这个目录在宿主文件系统里对不上（路径没过校验）",
			"host.applicationRequired": "没有指定要用哪个应用打开",
			"host.batchFailed": "一个会话都没删掉",
			"host.removeFailed": "删不掉：日志目录还在磁盘上",
			"app.finder": "访达",
			"app.terminal": "终端",
			"settings.title": "会话菜单",
			"settings.markUnread.label": "标记未读",
			"settings.markUnread.hint": "标成未读后行首亮蓝点，重新打开会话就消失",
			"settings.copy.label": "复制",
			"settings.copy.hint": "把会话 ID 或工作目录复制到剪贴板",
			"settings.reveal.label": "在文件管理器中显示",
			"settings.reveal.hint": "在文件管理器里打开会话目录并选中它",
			"settings.openWith.label": "打开方式",
			"settings.openWith.hint": "用本机的编辑器或终端打开会话目录",
			"settings.delete.label": "永久删除会话",
			"settings.delete.hint": "从磁盘上删掉日志文件，子会话一起删",
			"settings.deleteArchived.label": "删除所有已归档会话",
			"settings.deleteArchived.hint": "一次清空所有已归档会话的日志文件",
			"settings.statusDots.label": "状态点",
			"settings.statusDots.hint": "行首显示未读与报错状态的小圆点",
			"settings.hoverInfo.label": "悬浮卡",
			"settings.hoverInfo.hint": "鼠标停在会话行上，显示工作目录和上次报错",
			"settings.expand": "展开",
			"settings.collapse": "折叠",
			"settings.childLocked": "{name} 关闭时不可用",
			"settings.appsUnavailable": "暂时读不到可用应用",
			"close": "关闭"
		};

		/** English strings. */
		const en = {
			"menu.markUnread": "Mark as unread",
			"menu.markRead": "Mark as read",
			"menu.copyId": "Copy session ID",
			"menu.copyPath": "Copy working directory",
			"menu.reveal": "Show in File Manager",
			"menu.revealFinder": "Reveal in Finder",
			"menu.revealExplorer": "Show in File Explorer",
			"menu.copy": "Copy",
			"menu.openWithTitle": "Open with",
			"menu.openWith": "Open with {name}",
			"menu.delete": "Delete session",
			"menu.deleteArchived": "Delete all archived sessions",
			"menu.deleteArchivedCount": "Delete all archived sessions ({n})",
			"hover.unread": "Marked as unread",
			"status.unread": "Unread",
			"status.error": "Last run failed",
			"status.errorWith": "Last run failed: {message}",
			"delete.title": "Delete this session?",
			"delete.desc": "This permanently deletes the session and its subagent sessions, including the session log on disk. This cannot be undone.",
			"delete.cancel": "Cancel",
			"delete.confirm": "Delete",
			"delete.pending": "Deleting…",
			"delete.archivedTitle": "Delete all archived sessions?",
			"delete.archivedDesc": "This permanently deletes all {n} archived sessions and their subagent sessions, including the session logs on disk. This cannot be undone.",
			"delete.archivedConfirm": "Delete all",
			"delete.archivedPending": "Deleting…",
			"delete.archivedPartial": "Deleted {done}, {failed} failed.",
			"delete.unavailable": "The delete service is not ready yet; refresh and try again.",
			"delete.failedWith": "Delete failed: {message}",
			"open.failed": "Could not open",
			"open.failedWith": "Could not open: {message}",
			"open.unavailable": "The open service is not ready yet; refresh and try again.",
			"host.sessionIdRequired": "No session id was given.",
			"host.sessionIdsRequired": "No session list was given.",
			"host.pathUnverified": "The host could not resolve that directory.",
			"host.applicationRequired": "No application was specified.",
			"host.batchFailed": "No sessions could be deleted.",
			"host.removeFailed": "Could not delete: the log directory is still on disk.",
			"app.finder": "Finder",
			"app.terminal": "Terminal",
			"settings.title": "Session menu",
			"settings.markUnread.label": "Mark as unread",
			"settings.markUnread.hint": "Adds a blue dot until you reopen the session",
			"settings.copy.label": "Copy",
			"settings.copy.hint": "Copies the session ID or working directory",
			"settings.reveal.label": "Show in file manager",
			"settings.reveal.hint": "Reveals the session folder in your file manager",
			"settings.openWith.label": "Open with",
			"settings.openWith.hint": "Opens the session folder in your editor or terminal",
			"settings.delete.label": "Delete session",
			"settings.delete.hint": "Removes the log from disk, child sessions too",
			"settings.deleteArchived.label": "Delete all archived sessions",
			"settings.deleteArchived.hint": "Clears the logs of every archived session at once",
			"settings.statusDots.label": "Status dots",
			"settings.statusDots.hint": "Dots for unread and failed sessions",
			"settings.hoverInfo.label": "Hover card",
			"settings.hoverInfo.hint": "Shows the working directory and last error on hover",
			"settings.expand": "Expand",
			"settings.collapse": "Collapse",
			"settings.childLocked": "Unavailable while {name} is off",
			"settings.appsUnavailable": "No applications found",
			"close": "Close"
		};

		/** Marks this plugin's own row in the settings nav; the "Settings nav icon" region explains why a marker is needed at all. */
		const SETTINGS_NAV_MARKER = "data-dsh-session-menu-settings-nav";

		/** The plugin icon (icon.svg: three session rows plus the trailing dots) as a single-colour CSS mask — only the alpha channel is used, the colour comes from currentColor. */
		const SETTINGS_NAV_ICON = "url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20x='3.5'%20y='6.8'%20width='17'%20height='2.8'%20rx='1.4'%20fill='%23000'/%3E%3Crect%20x='3.5'%20y='14.6'%20width='17'%20height='2.8'%20rx='1.4'%20fill='%23000'/%3E%3Crect%20x='3.5'%20y='22.4'%20width='10.5'%20height='2.8'%20rx='1.4'%20fill='%23000'/%3E%3Ccircle%20cx='26'%20cy='8.2'%20r='1.9'%20fill='%23000'/%3E%3Ccircle%20cx='26'%20cy='16'%20r='1.9'%20fill='%23000'/%3E%3Ccircle%20cx='26'%20cy='23.8'%20r='1.9'%20fill='%23000'/%3E%3C/svg%3E\")";

		/** Plugin styles injected once; class names all use the dsm- prefix to avoid clashing with other plugins. */
		const STYLE = [
			'.dsm-icon-button{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:0;border-radius:4px;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
			'.dsm-icon-button:hover{color:var(--dsw-alias-label-primary)}',
			'.dsm-icon-button[data-tone="danger"]:hover{color:var(--dsw-alias-state-error-primary)}',
			'.dsm-header-button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer}',
			'.dsm-header-button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dsm-header-button[data-tone="danger"]:hover{color:var(--dsw-alias-state-error-primary)}',
			'.dsm-dot{position:relative;display:inline-block;flex:none;width:10px;height:10px;color:var(--dsw-alias-state-business-primary)}',
			'.dsm-dot::after{position:absolute;inset:20%;border-radius:50%;background:currentColor;content:""}',
			'.dsm-dot[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}',
			'.dsm-danger-label{color:var(--dsw-alias-state-error-primary)}',
			'.dsm-error-text{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}',
			'.dsm-status-text{color:var(--dsw-alias-label-secondary)}',
			// Native MenuItemButton has no submenu support, so the trigger row is drawn to the official .item dimensions.
			'.dsm-menu-row{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:0;border-radius:var(--dsw-radius-md);background:none;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
			'.dsm-menu-row:hover:not(:disabled),.dsm-menu-row:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);outline:none}',
			'.dsm-menu-row:disabled{opacity:.4;cursor:not-allowed}',
			'.dsm-menu-icon{display:inline-flex;flex:none;align-items:center;justify-content:center;width:14px;height:14px;color:var(--dsw-alias-menu-icon)}',
			'.dsm-menu-icon svg{width:14px;height:14px}',
			'.dsm-menu-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dsm-menu-chevron{display:inline-flex;flex:none;color:var(--dsw-alias-label-caption)}',
			// The submenu panel is mounted with fixed positioning: there is no new fixed containing block inside the menu, so .viewport does not clip it.
			'.dsm-submenu{position:fixed;z-index:1101;min-width:163px;padding:4px}',
			'.dsm-submenu-bridge{position:fixed;z-index:1100}',
			'.dsm-hover-lines{display:flex;flex-direction:column;gap:8px}',
			'.dsm-hover-path{overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;white-space:nowrap}',
			'.dsm-hover-status{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px}',
			'.dsm-hover-status svg{flex:none;margin:0 -4px}',
			// Settings section: the rows reuse the official label palette, and only the first row skips its top border.
			'.dsm-settings{box-sizing:border-box;display:flex;flex-direction:column;width:100%;max-width:820px;min-width:0;margin:0 auto;padding:2px 0 36px;color:var(--dsw-alias-label-primary)}',
			'.dsm-settings-title{margin:0;font-size:16px;line-height:24px;font-weight:650}',
			'.dsm-settings-list{margin-top:10px;display:flex;flex-direction:column}',
			'.dsm-settings-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:14px 0;border-top:.5px solid var(--dsw-alias-border-l2)}',
			'.dsm-settings-row:first-child{border-top:0}',
			'.dsm-settings-copy{display:flex;flex-direction:column;gap:4px;min-width:0}',
			'.dsm-settings-label{font-size:14px;line-height:20px}',
			'.dsm-settings-hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
			// Expandable group: the triangle sits left of the title on the same line, and the second-level switches start under the title.
			// The 24x24 button is the hit area; the negative margins keep it from growing the row (the line box stays as tall as the label).
			// Colour and hover follow the sidebar's own arrow (--dsw-alias-label-caption at rest, primary on hover).
			'.dsm-settings-label-row{display:flex;align-items:center;gap:4px;min-width:0}',
			'.dsm-settings-expander{display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;margin:-2px 0 -2px -4px;padding:0;border:0;border-radius:4px;background:none;color:var(--dsw-alias-label-caption);cursor:pointer}',
			'.dsm-settings-expander:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			// The arrow is the official IconTriangleRightFillRegular drawn at its own 14px default: same icon, size and colour as the
			// workspace row in the sidebar, instead of a full-bleed solid block. Unfolded it turns 90° into the pointing-down shape.
			'.dsm-settings-triangle{transition:transform .15s var(--ds-ease-in-out)}',
			'.dsm-settings-expander[data-expanded="true"] .dsm-settings-triangle{transform:rotate(90deg)}',
			'@media (prefers-reduced-motion:reduce){.dsm-settings-triangle{transition:none}}',
			// Second-level block: a 1px guide runs down the group's left edge and the block is inset, so the children read as members of
			// the row above rather than as more top-level rows.
			'.dsm-settings-children{display:flex;flex-direction:column;gap:2px;margin-left:12px;padding:0 0 12px 18px;border-left:1px solid var(--dsw-alias-border-l2)}',
			// The trailing right padding pulls the child switches inwards, so a second-level switch never lines up with a first-level one.
			'.dsm-settings-child{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:6px 14px 6px 0}',
			'.dsm-settings-child .dsm-switch-child{transform:scale(.85);transform-origin:100% 50%}',
			'.dsm-settings-child-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:18px}',
			// The stored choice of a locked child stays visible: dimmed, not hidden, so "off parent, child still remembered" reads as intentional.
			'.dsm-settings-child[data-locked="true"] .dsm-settings-child-label{opacity:.5}',
			'.dsm-settings-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
			// The official separatorBefore is only a 0.5px translucent hairline, nearly invisible on frosted glass, so a 1px line of the same color is drawn here.
			'.dsm-sep{height:1px;margin:3px 2px;background:var(--dsw-alias-border-l2)}',
			'.dsm-app-icon{width:14px;height:14px;border-radius:3px;display:block}',
			// The settings-nav glyph is picked upstream from a closed list of built-in section ids, so this plugin's own row is marked (see markSettingsNav) and the fallback gear is replaced here.
			`[${SETTINGS_NAV_MARKER}]>svg{display:none}`,
			`[${SETTINGS_NAV_MARKER}]::before{display:block;flex:none;width:16px;height:16px;background:currentColor;content:"";-webkit-mask:${SETTINGS_NAV_ICON} center/16px 16px no-repeat}`
		].join("\n");

		// #region Unread mark storage
		/**
		 * Unread marks live only in the browser: the host has no notion of "unread", and the official completionUnread
		 * is just an in-process Set (lost on refresh); the price is no cross-device sync (see DESIGN.md limitation 4).
		 */
		const STORAGE_KEY = "dsh.session-menu.unread.v1";

		/** The current set of unread session ids; every change replaces it wholesale so useSyncExternalStore gets a new snapshot. */
		let unreadIds = readStoredUnread();

		/** Subscribers of the unread set. */
		const unreadListeners = new Set();

		function readStoredUnread() {
			try {
				const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
				if (raw === null || raw === void 0) return new Set();
				const parsed = JSON.parse(raw);
				const ids = parsed !== null && typeof parsed === "object" && Array.isArray(parsed.ids) ? parsed.ids : [];
				return new Set(ids.filter((id) => typeof id === "string" && id !== ""));
			} catch (_error) {
				return new Set();
			}
		}

		function writeStoredUnread() {
			try {
				globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({
					version: 1,
					ids: [...unreadIds]
				}));
			} catch (_error) {
				/* When the write fails in private mode it still works for this session and is only lost after a refresh. */
			}
		}

		function publishUnread() {
			for (const listener of [...unreadListeners]) listener();
		}

		function subscribeUnread(listener) {
			unreadListeners.add(listener);
			return () => {
				unreadListeners.delete(listener);
			};
		}

		/** React subscription hook that reads the unread set. */
		function useUnreadIds() {
			return React.useSyncExternalStore(subscribeUnread, () => unreadIds, () => unreadIds);
		}

		/**
		 * Main view (currently open session) id: the row in the list snapshot with `retainedBy.mainView > 0`, the same
		 * criterion ui-workspace uses to decide the current session.
		 *
		 * @param snapshot - the session list snapshot.
		 * @returns the main view session id, or undefined.
		 */
		function mainSessionId(snapshot) {
			const byId = snapshot?.byId;
			if (byId === void 0 || byId === null) return void 0;
			for (const row of Object.values(byId)) {
				if (row !== null && typeof row === "object" && (row.retainedBy?.mainView ?? 0) > 0) return row.id;
			}
			return void 0;
		}

		/**
		 * Guard for the case where the session being marked is the one in the main view: without it, the automatic
		 * clear right afterwards would wipe the mark immediately (looking like nothing happened), so automatic
		 * clearing is only allowed once the main view has left this session and come back.
		 */
		let openGuard;

		/** Write an unread mark; nothing is persisted and nobody is notified when the value does not change. */
		function setMarked(sessionId, marked) {
			const has = unreadIds.has(sessionId);
			if (marked === has) return;
			const next = new Set(unreadIds);
			if (marked) next.add(sessionId);
			else next.delete(sessionId);
			unreadIds = next;
			writeStoredUnread();
			publishUnread();
		}

		/** Menu action: mark as unread (with the "currently viewing" guard). */
		function markUnread(sessionId) {
			openGuard = currentMainSessionId() === sessionId ? { sessionId, leftMain: false } : void 0;
			setMarked(sessionId, true);
		}

		/** Menu action: mark as read. */
		function markRead(sessionId) {
			if (openGuard !== void 0 && openGuard.sessionId === sessionId) openGuard = void 0;
			setMarked(sessionId, false);
		}
		// #endregion

		// #region Item switches
		/**
		 * Which menu entries and row decorations this plugin renders at all. Like the unread marks these live only in
		 * the browser; one switch per feature, and a feature that is off renders nothing — no disabled placeholder and
		 * no orphan separator left behind.
		 */
		const ITEMS_KEY = "dsh.session-menu.items.v1";

		/** Every switch key, in the order the settings page lists them. */
		const ITEM_KEYS = ["markUnread", "copy", "reveal", "openWith", "delete", "deleteArchived", "statusDots", "hoverInfo"];

		/**
		 * Read the stored switches: every switch defaults to on, so an untouched install behaves exactly as before.
		 * Only a stored boolean counts — a missing, unknown or damaged value keeps the default, because one bad entry
		 * must never take the whole menu down.
		 *
		 * @returns the switch map (all keys present).
		 */
		function readStoredItems() {
			const items = {};
			for (const key of ITEM_KEYS) items[key] = true;
			try {
				const raw = globalThis.localStorage?.getItem(ITEMS_KEY);
				if (raw === null || raw === void 0) return items;
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object") return items;
				for (const key of ITEM_KEYS) {
					if (typeof parsed[key] === "boolean") items[key] = parsed[key];
				}
			} catch (_error) {
				/* Unreadable storage (damaged JSON, private mode) keeps every default. */
			}
			return items;
		}

		/** The current switches; every change replaces the object wholesale so subscribers see a new snapshot. */
		let itemSettings = readStoredItems();

		/** Subscribers of the switch map. */
		const itemListeners = new Set();

		function readItems() {
			return itemSettings;
		}

		function writeStoredItems() {
			try {
				globalThis.localStorage?.setItem(ITEMS_KEY, JSON.stringify(itemSettings));
			} catch (_error) {
				/* When the write fails the switch still applies to this session and is only lost after a refresh. */
			}
		}

		function publishItems() {
			for (const listener of [...itemListeners]) listener();
		}

		function subscribeItems(listener) {
			itemListeners.add(listener);
			return () => {
				itemListeners.delete(listener);
			};
		}

		/** Settings page action: flip one switch, persist it, and let every reader re-render at once. */
		function setItem(key, enabled) {
			if (itemSettings[key] === enabled) return;
			itemSettings = { ...itemSettings, [key]: enabled };
			writeStoredItems();
			publishItems();
		}

		/** React subscription hook: the settings page writes and every seat reads through it. */
		function useItems() {
			const [items, setItems] = React.useState(readItems);
			React.useEffect(() => {
				const sync = () => setItems(readItems());
				/* Resync once on mount: the store may have changed between render and effect. */
				sync();
				return subscribeItems(sync);
			}, []);
			return items;
		}

		/**
		 * Second-level switches of the two expandable groups (`copy` / `openWith`).
		 *
		 * They live under a **separate key** on purpose: `dsh.session-menu.items.v1` is already on users' machines
		 * and an older build of this plugin rewrites that key from its own eight-entry map, so anything stored
		 * inside it would be dropped the next time an old build flips a switch. A key the old build never touches
		 * cannot lose data.
		 */
		const CHILDREN_KEY = "dsh.session-menu.itemChildren.v1";

		/** The groups that own second-level switches, in settings order; every other row is a plain on/off switch. */
		const CHILD_GROUPS = ["copy", "openWith"];

		/**
		 * Menu item key → stored child key of the copy group. The submenu entry keys are short (`id` / `cwd`) while
		 * the stored keys spell out what they copy.
		 */
		const COPY_CHILD_KEYS = { id: "sessionId", cwd: "cwd" };

		/**
		 * Read the stored child switches: `{ copy: { sessionId: false }, openWith: { "/Applications/Xcode.app": false } }`.
		 *
		 * Only stored booleans count and only the groups above are read; an absent entry means on, so an application
		 * the host reports for the first time (or a group nobody has opened yet) is enabled by default. Damaged
		 * storage keeps every default, exactly like the flat map above.
		 *
		 * @returns the child switch map (`{ [group]: { [key]: boolean } }`).
		 */
		function readStoredChildItems() {
			const groups = {};
			for (const group of CHILD_GROUPS) groups[group] = {};
			try {
				const raw = globalThis.localStorage?.getItem(CHILDREN_KEY);
				if (raw === null || raw === void 0) return groups;
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object") return groups;
				for (const group of CHILD_GROUPS) {
					const stored = parsed[group];
					if (stored === null || typeof stored !== "object" || Array.isArray(stored)) continue;
					for (const key of Object.keys(stored)) {
						if (typeof stored[key] === "boolean") groups[group][key] = stored[key];
					}
				}
			} catch (_error) {
				/* Unreadable storage (damaged JSON, private mode) keeps every default. */
			}
			return groups;
		}

		/** The current child switches; every change replaces the object wholesale so subscribers see a new snapshot. */
		let childItems = readStoredChildItems();

		/** Subscribers of the child switch map. */
		const childListeners = new Set();

		function readChildItems() {
			return childItems;
		}

		function writeStoredChildItems() {
			try {
				globalThis.localStorage?.setItem(CHILDREN_KEY, JSON.stringify(childItems));
			} catch (_error) {
				/* When the write fails the switch still applies to this session and is only lost after a refresh. */
			}
		}

		function publishChildItems() {
			for (const listener of [...childListeners]) listener();
		}

		function subscribeChildItems(listener) {
			childListeners.add(listener);
			return () => {
				childListeners.delete(listener);
			};
		}

		/**
		 * Settings page action: flip one child switch. The value is stored even while the group's own switch is off,
		 * so turning the group back on restores exactly what the user had picked.
		 */
		function setChildItem(group, key, enabled) {
			const current = childItems[group] ?? {};
			if (current[key] === enabled) return;
			childItems = { ...childItems, [group]: { ...current, [key]: enabled } };
			writeStoredChildItems();
			publishChildItems();
		}

		/**
		 * Whether one child entry is on in a given snapshot: only a stored value decides, so an entry nobody has ever
		 * touched (a newly installed application, a system handler listed per directory) keeps its default.
		 *
		 * @param items - a child switch snapshot from `useChildItems()`.
		 * @param group - `copy` / `openWith`.
		 * @param key - child key (`sessionId` / `cwd` / an application id).
		 * @param defaultOn - value for an entry the user never touched.
		 * @returns whether the entry may render.
		 */
		function childItemOn(items, group, key, defaultOn = true) {
			const stored = items[group]?.[key];
			if (stored === true || stored === false) return stored;
			return defaultOn;
		}

		/** Slot holding one row per "..." menu entry; the kernel registers its own rows here too. */
		const MENU_ITEM_SLOT = "sidebar.workspaces.session.menu.item";

		/** Id the kernel registers its own "copy Session ID" row under (`dsh-client-ui-workspace`). */
		const NATIVE_SESSION_ID = "session-id";

		/**
		 * Registration id of a stored slot entry.
		 *
		 * The renderer reads ids as `entry.options.id` (`dsh-client-ui-renderer/lib/client.js`, the keyed-slot path:
		 * `entriesOfSlot(slotKey).find((e) => e.options.key === ...)` and `id: entry.options.id`), so that field is
		 * asked first; the other shapes are only there to survive a build that flattens the entry.
		 *
		 * @param entry - one entry from `entriesOfSlot()`.
		 * @returns the id, or an empty string when this entry does not carry one.
		 */
		function entryId(entry) {
			const candidate = entry?.options?.id ?? entry?.id ?? entry?.entry?.id;
			return typeof candidate === "string" ? candidate : "";
		}

		/**
		 * Whether the kernel already puts its own "copy Session ID" row in the session menu.
		 *
		 * ui-workspace registers that row as id `session-id`, so asking the slot registry is enough — no version
		 * table to keep in sync. Anything unexpected (no service, no method, another shape) answers "no native row",
		 * which keeps our own entry visible: a duplicate is a cosmetic annoyance, a missing action is a lost feature.
		 *
		 * @returns true when the native row is registered.
		 */
		function hostCopiesSessionId() {
			try {
				const entries = slotsService?.entriesOfSlot?.(MENU_ITEM_SLOT);
				if (!Array.isArray(entries)) return false;
				return entries.some((entry) => entryId(entry) === NATIVE_SESSION_ID);
			} catch (_error) {
				return false;
			}
		}

		/** React subscription hook for the child switches (the settings page and the two submenus read through it). */
		function useChildItems() {
			const [items, setItems] = React.useState(readChildItems);
			React.useEffect(() => {
				const sync = () => setItems(readChildItems());
				sync();
				return subscribeChildItems(sync);
			}, []);
			return items;
		}
		// #endregion

		// #region Client service access
		/** Session list snapshot source (bound in apply): "opening marks as read", "copy working directory" and the error dot all read it. */
		let sessionsList;
		/** Client slot registry (bound in apply): used to ask whether the kernel ships its own menu rows. */
		let slotsService;
		/** Workspace list snapshot source (bound in apply): used to tell whether a row is archived. */
		let workspacesList;
		/** Host Remote: deleting a session goes through `remote.sessionMenu`, opening a path through the official `remote.session`. */
		let sessionMenuRemote;
		let sessionRemote;
		/** This plugin's client context, used to remount the remote service when it is not ready at delete time. */
		let pluginCtx;

		/**
		 * Hook that reads one session row; returns undefined when the row does not exist.
		 * @param sessionId - session id.
		 * @returns the session row (with cwd and projectionValues), or undefined.
		 */
		function useSessionRow(sessionId) {
			return React.useSyncExternalStore(
				(listener) => (sessionsList === void 0 ? () => {} : sessionsList.subscribe(listener)),
				() => sessionsList?.getSnapshot()?.byId?.[sessionId],
				() => sessionsList?.getSnapshot()?.byId?.[sessionId]
			);
		}

		/** Cache of the archived set: the same Set is reused while the list snapshot is unchanged, so useSyncExternalStore does not re-render over and over. */
		let archivedCache = new Set();
		let archivedSource;

		function archivedSnapshot() {
			if (workspacesList === void 0) return archivedCache;
			const snapshot = workspacesList.getSnapshot();
			if (snapshot === archivedSource) return archivedCache;
			archivedSource = snapshot;
			archivedCache = new Set(Array.isArray(snapshot?.archivedSessionIds) ? snapshot.archivedSessionIds : []);
			return archivedCache;
		}

		/** Subscription hook for the set of archived session ids (the official code keeps the archived set in the workspace list). */
		function useArchivedIds() {
			return React.useSyncExternalStore(
				(listener) => (workspacesList === void 0 ? () => {} : workspacesList.subscribe(listener)),
				archivedSnapshot,
				archivedSnapshot
			);
		}

		/**
		 * Main view session id (undefined when there is no session list).
		 * @returns the session id or undefined.
		 */
		function currentMainSessionId() {
			if (sessionsList === void 0) return void 0;
			try {
				return mainSessionId(sessionsList.getSnapshot());
			} catch (_error) {
				return void 0;
			}
		}

		/**
		 * After deleting the session the main view is showing, put the main view back to a blank page (the official
		 * archive-current-session path does the same): ui-workspace's own `clearMain` must be called so its internal
		 * mainReference and selection are reset together.
		 */
		function clearMainView() {
			try {
				const uiWorkspace = pluginCtx?.get?.("uiWorkspace");
				if (typeof uiWorkspace?.clearMain === "function") uiWorkspace.clearMain();
			} catch (_error) {
				// Failing to clear it only leaves an empty view; it must not affect a delete that already succeeded.
			}
		}
		// #endregion

		// #region Open with
		/** Open-with targets available per working directory, cached for good (the host is asked once per cwd). */
		const applicationCache = new Map();

		/** Host platform (`darwin` / `win32` / …); asked once after the plugin mounts the Remote service, then kept. */
		let hostPlatform = "";

		/** Incremented on every Remote mount and unmount: used to drop late mount results instead of writing back a stale handle. */
		let remoteGeneration = 0;
		/** Maximum number of open-with entries in the submenu; it only guards against macOS returning a long list of handlers that blows up the menu, it does not trim a normal list. */
		const APPLICATION_LIMIT = 12;
		/**
		 * Which of the system-registered applications look like "for writing code": the official
		 * `workspacePathApplications` mixes in proxies, chat apps and unarchivers, so only editors / IDEs / terminals
		 * are kept here (the default application is always kept).
		 *
		 * ⚠️ This is a **supplementary channel**: removing an app from the host list **does not mean it cannot
		 * appear** — as long as it registered `public.folder` and its name matches this regex, it slips back in from
		 * here; `code` is a substring match, so names like OpenCode / ZCode hit it too.
		 */
		const DEVELOPER_APP_NAME = /terminal|iterm|warp|ghostty|kitty|alacritty|wezterm|hyper|tabby|xcode|visual studio|cursor|windsurf|zed|sublime|nova|textmate|bbedit|intellij|pycharm|webstorm|goland|clion|rider|rubymine|phpstorm|datagrip|android studio|fleet|emacs|vim|neovide|code/i;

		/**
		 * Normalize the system applications returned by the official service.
		 * @param entries - the return value of `workspacePathApplications`.
		 * @returns `[{ id, name, icon, source, isDefault }]`.
		 */
		function systemApplications(entries) {
			const list = [];
			for (const entry of entries) {
				if (typeof entry?.id !== "string" || entry.id === "") continue;
				list.push({
					id: entry.id,
					name: typeof entry?.name === "string" && entry.name !== "" ? entry.name : entry.id,
					icon: typeof entry?.icon === "string" ? entry.icon : "",
					source: "system",
					isDefault: entry.default === true
				});
			}
			return list;
		}

		/**
		 * Merge the "system handlers" with the "developer applications probed by the host", in this order: default
		 * application (Finder) → developer list → system-registered developer applications (to fill gaps); only one
		 * entry per path, and applications that are not registered, such as terminals and Xcode, can only come from
		 * the host list.
		 *
		 * @param system - system applications.
		 * @param catalog - developer applications probed by this plugin's host half.
		 * @returns the merged application array (already truncated to `APPLICATION_LIMIT`).
		 */
		function mergeApplications(system, catalog) {
			const seen = new Set();
			const merged = [];
			const push = (application) => {
				if (seen.has(application.id)) return;
				seen.add(application.id);
				merged.push(application);
			};
			for (const application of system) if (application.isDefault) push(application);
			for (const application of catalog) push(application);
			for (const application of system) {
				if (!application.isDefault && DEVELOPER_APP_NAME.test(application.name)) push(application);
			}
			return merged.slice(0, APPLICATION_LIMIT);
		}

		/**
		 * Ask the host which applications can open a path.
		 * @param path - working directory.
		 * @returns the application array (empty on failure or when not ready).
		 */
		function loadApplications(path) {
			const cached = applicationCache.get(path);
			if (cached !== void 0) return cached;
			const pending = (async () => {
				const [system, catalog] = await Promise.all([loadSystemApplications(path), loadDeveloperApplications()]);
				const merged = mergeApplications(system, catalog);
				/* An empty result usually means the host half is not ready yet (the Remote service is not mounted) — do not cache it as "this directory has no usable application". */
				if (merged.length === 0) applicationCache.delete(path);
				return merged;
			})();
			applicationCache.set(path, pending);
			return pending;
		}

		/**
		 * Official entry: which handlers are registered for that directory in Launch Services.
		 * @param path - working directory.
		 * @returns the system application array.
		 */
		async function loadSystemApplications(path) {
			if (sessionRemote === void 0) return [];
			try {
				const result = await sessionRemote.workspacePathApplications({ path });
				if (result?.ok !== true || !Array.isArray(result.value)) return [];
				return systemApplications(result.value);
			} catch (_error) {
				return [];
			}
		}

		/**
		 * This plugin's host entry: which IDEs / terminals are installed on this machine. The method does not exist
		 * yet when the host half has not been restarted, so the call fails — in that case it degrades to "only the
		 * system default application" instead of dropping the application section of the menu entirely.
		 *
		 * @returns the developer application array.
		 */
		async function loadDeveloperApplications() {
			if (sessionMenuRemote === void 0) return [];
			try {
				const result = await sessionMenuRemote.workspaceApplications();
				if (result?.ok !== true || !Array.isArray(result.value)) return [];
				return result.value
					.filter((entry) => typeof entry?.id === "string" && entry.id !== "")
					.map((entry) => ({
						id: entry.id,
						name: typeof entry?.name === "string" && entry.name !== "" ? entry.name : entry.id,
						icon: typeof entry?.icon === "string" ? entry.icon : "",
						source: "catalog",
						isDefault: false
					}));
			} catch (_error) {
				return [];
			}
		}

		/**
		 * Ask for the host platform once: the "Reveal in Finder" wording must follow the **host** platform — the open
		 * action runs on the host machine, and when the Web UI is accessed remotely the browser and the host may not
		 * be the same system, so `navigator.platform` cannot be used.
		 *
		 * @returns the platform string; an empty string when it could not be read or the call failed.
		 */
		async function loadHostPlatform() {
			if (hostPlatform !== "" || sessionMenuRemote === void 0) return hostPlatform;
			try {
				const result = await sessionMenuRemote.hostPlatform();
				if (result?.ok === true && typeof result.value === "string") hostPlatform = result.value;
			} catch (_error) {
				/* The method does not exist yet when the host half has not been restarted — fall back to the generic wording instead of blocking the menu. */
			}
			return hostPlatform;
		}

		/**
		 * Host platform (late is fine: components re-render once it arrives).
		 * @returns `darwin` / `win32` / `linux` / …, an empty string when unknown.
		 */
		function useHostPlatform() {
			const [value, setValue] = React.useState(hostPlatform);
			React.useEffect(() => {
				if (value !== "") return void 0;
				let alive = true;
				void loadHostPlatform().then((result) => {
					if (alive && result !== "") setValue(result);
				});
				return () => {
					alive = false;
				};
			}, [value]);
			return value;
		}

		/**
		 * Subscribe to the open-with targets of a path.
		 * @param path - working directory; nothing is queried when undefined.
		 * @returns the application array.
		 */
		function useApplications(path) {
			const [state, setState] = React.useState({ path: void 0, list: [] });
			React.useEffect(() => {
				if (path === void 0 || path === "") return void 0;
				let alive = true;
				void loadApplications(path).then((list) => {
					if (alive) setState({ path, list });
				});
				return () => {
					alive = false;
				};
			}, [path]);
			return state.path === path ? state.list : [];
		}

		/**
		 * The application list behind the "Open with" second-level switches in Settings.
		 *
		 * The settings page has no session and therefore no working directory, so only the path-independent
		 * developer catalog is listed here. Handlers that only show up for one directory come from Launch Services
		 * and have no row of their own; they stay on unless their id was switched off from this list.
		 *
		 * An empty list is the honest answer for every "no applications" case (host half not mounted yet, the probe
		 * failed, none of the probed applications is installed, non-macOS), and the settings page says so in words
		 * instead of showing an empty block.
		 *
		 * @returns the application array; empty until the host has answered.
		 */
		function useDeveloperApplications() {
			const [list, setList] = React.useState([]);
			React.useEffect(() => {
				let alive = true;
				void loadDeveloperApplications().then((applications) => {
					if (alive) setList(applications);
				});
				return () => {
					alive = false;
				};
			}, []);
			return list;
		}
		// #endregion

		// #region Delete dialog request state
		/** Pending delete request: `{mode:"one", sessionId, displayTitle}` or `{mode:"all", sessionIds}`; null when the dialog is not open. */
		let deleteRequest = null;
		/** Subscribers of the delete request. */
		const deleteListeners = new Set();

		function subscribeDelete(listener) {
			deleteListeners.add(listener);
			return () => {
				deleteListeners.delete(listener);
			};
		}

		function readDeleteRequest() {
			return deleteRequest;
		}

		/** Open the delete confirmation dialog. */
		function openDeleteDialog(request) {
			deleteRequest = request;
			for (const listener of [...deleteListeners]) listener();
		}

		/** Close the delete confirmation dialog (the caller blocks this while a delete is running). */
		function closeDeleteDialog() {
			if (deleteRequest === null) return;
			deleteRequest = null;
			for (const listener of [...deleteListeners]) listener();
		}
		// #endregion

		// #region Open failure overlay notice
		/**
		 * The most recent "open failed": `{ seq, text }`, null when there is none. The increasing `seq` is used as the
		 * key rather than the text — when the same failure happens twice in a row, an unchanged key makes React reuse
		 * the same Toast instance and the auto-dismiss timer never restarts.
		 */
		let openNotice = null;
		let openNoticeSeq = 0;
		const openNoticeListeners = new Set();

		function subscribeOpenNotice(listener) {
			openNoticeListeners.add(listener);
			return () => {
				openNoticeListeners.delete(listener);
			};
		}

		function readOpenNotice() {
			return openNotice;
		}

		/** Show an open-failure notice. */
		function showOpenFailure(message) {
			openNoticeSeq += 1;
			openNotice = { seq: openNoticeSeq, text: message };
			for (const listener of [...openNoticeListeners]) listener();
		}

		/** Clear it after the notice fades out (the Toast `onDone`). */
		function dismissOpenNotice() {
			if (openNotice === null) return;
			openNotice = null;
			for (const listener of [...openNoticeListeners]) listener();
		}

		/**
		 * Read a string outside React: prefer the `t` passed in by the caller (which follows the current language) and
		 * fall back to the Chinese source text.
		 *
		 * @param key - string key.
		 * @param params - values for `{name}` placeholders; no interpolation when omitted.
		 * @param t - the string function injected by the component.
		 * @returns the string in the current language.
		 */
		function text(key, params, t) {
			if (typeof t === "function") {
				const localized = t(key, params);
				if (typeof localized === "string" && localized !== "") return localized;
			}
			const fallback = zh[key] ?? key;
			if (params === void 0) return fallback;
			return fallback.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
		}
		// #endregion

		// #region Icons
		/**
		 * Eye icon used by "Mark as unread": the official icon set has no eye icon, so it is drawn in the official
		 * style (16-unit viewBox, fill=none, stroke=currentColor, stroke width 1).
		 */
		function EyeIcon({ size = 16, className }) {
			return h("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				"aria-hidden": "true",
				strokeWidth: 1
			}, h("path", {
				d: "M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4S1.5 8 1.5 8Z",
				stroke: "currentColor",
				strokeLinejoin: "round"
			}), h("circle", {
				cx: 8,
				cy: 8,
				r: 1.75,
				stroke: "currentColor"
			}));
		}
		// #endregion

		// #region Settings section
		/**
		 * The switch rows: `[switch key, string key prefix]`.
		 *
		 * The label is always `<prefix>.label` and the second line is always `<prefix>.hint`.
		 */
		const SETTINGS_ROWS = [
			["markUnread", "settings.markUnread"],
			["copy", "settings.copy"],
			["reveal", "settings.reveal"],
			["openWith", "settings.openWith"],
			["delete", "settings.delete"],
			["deleteArchived", "settings.deleteArchived"],
			["statusDots", "settings.statusDots"],
			["hoverInfo", "settings.hoverInfo"]
		];

		/** Child rows of the copy group: `[child key, string key]`; the strings are the same ones the submenu uses. */
		const COPY_CHILD_ROWS = [["sessionId", "menu.copyId"], ["cwd", "menu.copyPath"]];

		/**
		 * One second-level switch row.
		 *
		 * The row stays visible (dimmed) while the group's own switch is off, because the choice is remembered and
		 * comes back with the group; only the input is refused, and the tooltip says why.
		 *
		 * @param group - `copy` / `openWith`.
		 * @param childKey - child key (`sessionId` / `cwd` / an application id).
		 * @param label - the row's text.
		 * @param checked - current value.
		 * @param locked - true while the parent switch is off.
		 * @param groupLabel - the parent's text, for the locked tooltip.
		 * @param t - string function.
		 * @returns the row element.
		 */
		function settingsChildRow(group, childKey, label, checked, locked, groupLabel, t) {
			return h("div", {
				key: childKey,
				className: "dsm-settings-child",
				"data-session-menu-child": `${group}:${childKey}`,
				"data-locked": locked ? "true" : void 0
			}, h("div", { className: "dsm-settings-child-label" }, label), h(primitives.Switch, {
				checked,
				disabled: locked,
				className: "dsm-switch-child",
				label,
				title: locked ? t("settings.childLocked", { name: groupLabel }) : void 0,
				onChange: (next) => setChildItem(group, childKey, next)
			}));
		}

		/**
		 * The second-level block of one expandable group, mounted right below the group's row.
		 *
		 * The copy group lists its two fixed entries; the open-with group lists whatever the host probes, and when
		 * that list is empty (host half not mounted yet, non-macOS) it shows one line saying so instead of an empty
		 * shell — a group with no applications must not look like a broken one.
		 *
		 * @param group - `copy` / `openWith`.
		 * @param items - the top-level switch snapshot (whether the parent is on).
		 * @param children - the child switch snapshot.
		 * @param applications - the host-probed application catalog (open-with only).
		 * @param groupLabel - the parent's text, for the locked tooltip.
		 * @param t - string function.
		 * @returns the block element.
		 */
		function settingsChildBlock(group, items, children, applications, groupLabel, t) {
			const locked = items[group] === false;
			/* The copy child that the kernel already provides defaults to off — the Settings switch says so, and turning
			   it on is how a user gets our own row back (or keeps both). */
			const nativeId = hostCopiesSessionId();
			const rows = group === "copy"
				? COPY_CHILD_ROWS.map(([childKey, labelKey]) => settingsChildRow(group, childKey, t(labelKey), childItemOn(children, group, childKey, !(childKey === "sessionId" && nativeId)), locked, groupLabel, t))
				: applications.map((application) => settingsChildRow(group, application.id, appName(application, t), childItemOn(children, group, application.id), locked, groupLabel, t));
			if (rows.length === 0) rows.push(h("div", { key: "empty", className: "dsm-settings-empty" }, t("settings.appsUnavailable")));
			return h("div", { className: "dsm-settings-children", "data-session-menu-children": group }, rows);
		}

		/**
		 * This plugin's page in Settings: one switch per menu entry / row decoration.
		 *
		 * The switches write straight to the browser store instead of staging a form — they are a view preference,
		 * not deployment configuration, and every seat subscribes to the same store, so a flip takes effect while the
		 * settings panel is still open (no save button, no restart).
		 *
		 * The two groups that own a submenu carry a triangle left of their title: only those rows can be folded, so
		 * the other six keep exactly the layout they had. Both groups start unfolded, and folding is page-local state
		 * (nothing about it is stored).
		 *
		 * Every row is a label plus a hint line, and each group's children sit in an inset block behind a vertical
		 * guide, so a second-level switch is never mistaken for another top-level one.
		 *
		 * @param props - the framework's standard slot props; only `t` (bound to this namespace) is used.
		 */
		function SettingsSection({ t }) {
			const items = useItems();
			const children = useChildItems();
			const applications = useDeveloperApplications();
			const [expanded, setExpanded] = React.useState(() => new Set(CHILD_GROUPS));
			const toggleExpanded = (key) => setExpanded((previous) => {
				const next = new Set(previous);
				if (next.has(key)) next.delete(key);
				else next.add(key);
				return next;
			});
			return h("section", { className: "dsm-settings" },
				h("h2", { className: "dsm-settings-title" }, t("settings.title")),
				h("div", { className: "dsm-settings-list" }, SETTINGS_ROWS.map(([key, prefix]) => {
					const groupLabel = t(`${prefix}.label`);
					const open = expanded.has(key);
					const expandable = CHILD_GROUPS.includes(key);
					const column = [expandable ? h("div", { className: "dsm-settings-label-row" }, h("button", {
						type: "button",
						className: "dsm-settings-expander",
						"data-session-menu-expander": key,
						"data-expanded": open ? "true" : "false",
						"aria-expanded": open,
						"aria-label": t(open ? "settings.collapse" : "settings.expand"),
						onClick: () => toggleExpanded(key)
					}, h(primitives.IconTriangleRightFillRegular, { className: "dsm-settings-triangle" })), h("div", { className: "dsm-settings-label" }, groupLabel)) : h("div", { className: "dsm-settings-label" }, groupLabel)];
					column.push(h("div", { className: "dsm-settings-hint" }, t(`${prefix}.hint`)));
					return h(Fragment, { key },
						h("div", {
							className: "dsm-settings-row",
							"data-session-menu-setting": key
						}, h("div", { className: "dsm-settings-copy" }, ...column),
						h(primitives.Switch, {
							checked: items[key] !== false,
							label: groupLabel,
							onChange: (next) => setItem(key, next)
						})),
						expandable && open ? settingsChildBlock(key, items, children, applications, groupLabel, t) : null);
				})));
		}
		// #endregion

		// #region Settings nav icon
		/**
		 * Mark the settings-nav button that carries this plugin's label, so the CSS above can swap the
		 * fallback gear for the plugin icon.
		 *
		 * DSH 0.1.x reads only `id`, `order` and `label` from a `settings.section` registration and
		 * chooses the glyph inside the settings shell from a closed list of built-in ids (`navIcon()` in
		 * @deepseek-ai/dsh-client-ui-settings-general), where every unknown id falls back to the gear.
		 * Until that public contract grows an icon field, the row is recognised here after the dialog
		 * mounts, by the visible text of the same localized label the section registers. The marker owns
		 * no shell structure and is removed on fiber disposal, so the adaptation stays HMR-safe.
		 *
		 * A label that matches nothing is the normal case before the dialog opens: then nothing is marked
		 * and nothing happens.
		 *
		 * @param label - locale-aware label resolver, i.e. the same value the section registration returns for `label`.
		 * @returns a cleanup function that disconnects the observer and removes every marker this call set.
		 */
		function markSettingsNav(label) {
			if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return () => {};
			if (document.body === void 0 || document.body === null) return () => {};
			let disposed = false;
			const sync = () => {
				if (disposed) return;
				let buttons;
				try {
					buttons = document.querySelectorAll('[role="dialog"] nav button');
				} catch (_error) {
					return;
				}
				const current = String(label() ?? "").trim();
				for (const button of buttons) {
					if (current.length > 0 && button.textContent?.trim() === current) button.setAttribute(SETTINGS_NAV_MARKER, "");
					else button.removeAttribute(SETTINGS_NAV_MARKER);
				}
			};
			sync();
			/* The dialog mounts, unmounts and re-renders (language switches included) long after this effect runs, so the marker follows the DOM. */
			const observer = typeof MutationObserver === "function" ? new MutationObserver(sync) : null;
			if (observer !== null) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
			return () => {
				disposed = true;
				if (observer !== null) observer.disconnect();
				document.querySelectorAll(`[${SETTINGS_NAV_MARKER}]`).forEach((element) => {
					element.removeAttribute(SETTINGS_NAV_MARKER);
				});
			};
		}
		// #endregion

		// #region Menu item components
		/**
		 * Extract the menu close function; the menu item framework injects the useMenuOpenState hook as a prop.
		 * @param useMenuOpenState - the menu open/close hook injected by the framework.
		 * @returns the function that closes the menu.
		 */
		function menuCloser(useMenuOpenState) {
			if (typeof useMenuOpenState !== "function") return void 0;
			const state = useMenuOpenState();
			return Array.isArray(state) && typeof state[1] === "function" ? state[1] : void 0;
		}

		/** Menu item: mark as unread / mark as read. */
		function MarkUnreadMenuItem({ sessionId, useMenuOpenState, t }) {
			const unread = useUnreadIds();
			const marked = unread.has(sessionId);
			const closeMenu = menuCloser(useMenuOpenState);
			if (useItems().markUnread === false) return null;
			return h(primitives.MenuItemButton, {
				icon: marked ? h(primitives.IconCheckOutlineRegular) : h(EyeIcon),
				onSelect: () => {
					if (marked) markRead(sessionId);
					else markUnread(sessionId);
					closeMenu?.(false);
				}
			}, marked ? t("menu.markRead") : t("menu.markUnread"));
		}

		// #region Submenu
		/**
		 * Compute the submenu panel position: by default it sits to the right of the trigger row with its bottom edge
		 * aligned to the row's bottom edge (the same geometry as the official data-driven menu's .submenu); it flips to
		 * the left when there is no room on the right, and is pulled back inside when it overflows the viewport.
		 * @param anchor - snapshot of the trigger row's getBoundingClientRect.
		 * @param size - the measured panel size; null until it has been measured.
		 * @returns `{ left, top, side }`.
		 */
		function panelGeometry(anchor, size) {
			const margin = 12;
			const gap = 10;
			const viewportWidth = globalThis.innerWidth ?? 0;
			const viewportHeight = globalThis.innerHeight ?? 0;
			const width = size?.width ?? 0;
			const height = size?.height ?? 0;
			const fitsRight = viewportWidth === 0 || width === 0 || anchor.right + gap + width <= viewportWidth - margin;
			const left = fitsRight ? anchor.right + gap : Math.max(margin, anchor.left - gap - width);
			let top = anchor.bottom - height - 4;
			if (top < margin) top = Math.max(margin, anchor.top - 4);
			if (height > 0 && top + height > viewportHeight - margin) top = Math.max(margin, viewportHeight - margin - height);
			return { left, top, side: fitsRight ? "right" : "left" };
		}

		/**
		 * Menu item with a submenu panel: a slot seat can only add nodes to the official menu's children and cannot use
		 * the data-driven menu's submenu, so it is drawn by hand.
		 *
		 * The panel is positioned with `position:fixed`: there is no new fixed containing block inside the menu, so
		 * `.viewport` cannot clip it; a 10px transparent bridge connects the row and the panel, and the panel is a
		 * descendant of this component, so moving the pointer over does not fire pointerleave and the parent menu's
		 * closeOnPointerLeave does not close the menu.
		 *
		 * @param props - `{ icon, label, items, useMenuOpenState }`; items is `[{key, label, icon, run}]`.
		 */
		function SubmenuMenuItem({ icon, label, items, useMenuOpenState }) {
			const closeMenu = menuCloser(useMenuOpenState);
			const [anchor, setAnchor] = React.useState(null);
			const [size, setSize] = React.useState(null);
			const rowRef = React.useRef(null);
			const panelRef = React.useRef(null);
			React.useLayoutEffect(() => {
				if (anchor === null) return;
				const node = panelRef.current;
				if (node === null) return;
				const box = node.getBoundingClientRect();
				if (size === null || size.width !== box.width || size.height !== box.height) setSize({ width: box.width, height: box.height });
			});
			const disabled = items.length === 0;
			const openPanel = () => {
				const node = rowRef.current;
				if (node === null) return;
				const box = node.getBoundingClientRect();
				setAnchor({ top: box.top, right: box.right, bottom: box.bottom, left: box.left });
			};
			const closePanel = () => {
				setAnchor(null);
				setSize(null);
			};
			const geometry = anchor === null ? null : panelGeometry(anchor, size);
			const bridgeTop = anchor === null || geometry === null ? 0 : Math.min(anchor.top, geometry.top);
			return h("div", {
				className: "dsm-submenu-host",
				onPointerEnter: disabled ? void 0 : openPanel,
				onPointerLeave: closePanel
			}, h("button", {
				ref: rowRef,
				type: "button",
				role: "menuitem",
				className: "dsm-menu-row",
				disabled,
				"aria-haspopup": "menu",
				"aria-expanded": geometry !== null,
				onFocus: disabled ? void 0 : openPanel,
				onClick: (event) => {
					event.stopPropagation();
					if (disabled) return;
					if (geometry === null) openPanel();
					else closePanel();
				}
			}, h("span", { className: "dsm-menu-icon" }, icon), h("span", { className: "dsm-menu-label" }, label), h("span", {
				className: "dsm-menu-chevron",
				"aria-hidden": "true"
			}, h(primitives.IconChevronRightOutlineRegular, { size: 14 }))), geometry === null ? null : h(Fragment, null, h("div", {
				className: "dsm-submenu-bridge",
				style: {
					left: anchor.right,
					top: bridgeTop,
					width: 10,
					height: Math.max(anchor.bottom, geometry.top + (size?.height ?? 0)) - bridgeTop
				}
			}), h(primitives.MenuSurface, {
				ref: panelRef,
				role: "menu",
				className: "dsm-submenu",
				style: { left: geometry.left, top: geometry.top }
			}, items.map((entry) => h(primitives.MenuItemButton, {
				key: entry.key,
				icon: entry.icon,
				onSelect: () => {
					closePanel();
					closeMenu?.(false);
					entry.run();
				}
			}, entry.label)))));
		}

		/** Menu item: copy (submenu: session ID / working directory). */
		function CopySubmenuMenuItem({ sessionId, useMenuOpenState, t }) {
			const row = useSessionRow(sessionId);
			const children = useChildItems();
			const cwd = typeof row?.cwd === "string" && row.cwd !== "" ? row.cwd : void 0;
			const items = [{
				key: "id",
				label: t("menu.copyId"),
				icon: h(primitives.IconCopyOutlineRegular),
				run: () => {
					void primitives.writeClipboard(sessionId);
				}
			}];
			if (cwd !== void 0) items.push({
				key: "cwd",
				label: t("menu.copyPath"),
				icon: h(primitives.IconFolderOpenRegular),
				run: () => {
					void primitives.writeClipboard(cwd);
				}
			});
			if (useItems().copy === false) return null;
			/* The kernel ships its own "copy Session ID" row, so our identical entry stays off until the user asks for
			   it in Settings — an untouched entry reads as "default", never as "the user turned this off". */
			const nativeId = (key) => key === "id" && hostCopiesSessionId();
			/* Second-level switches: an entry switched off in Settings leaves no row behind, and a group whose entries
			   are all off leaves no trigger either — the separator goes with it. */
			const visible = items.filter((entry) => childItemOn(children, "copy", COPY_CHILD_KEYS[entry.key], !nativeId(entry.key)));
			if (visible.length === 0) return null;
			const closeMenu = menuCloser(useMenuOpenState);
			/* One entry left is not a submenu: a second level holding a single row costs a click and hides the label it
			   would have shown, so that row moves up and keeps its own icon and text. */
			if (visible.length === 1) {
				const [only] = visible;
				return h(Fragment, null,
					h(MenuSeparator),
					h(primitives.MenuItemButton, {
						icon: only.icon,
						onSelect: () => {
							closeMenu?.(false);
							only.run();
						}
					}, only.label));
			}
			return h(Fragment, null,
				h(MenuSeparator),
				h(SubmenuMenuItem, {
					icon: h(primitives.IconCopyOutlineRegular),
					label: t("menu.copy"),
					items: visible,
					useMenuOpenState
				}));
		}
		// #endregion

		/** Menu item: reveal the working directory in Finder. */
		function RevealMenuItem({ sessionId, useMenuOpenState, t }) {
			const row = useSessionRow(sessionId);
			const platform = useHostPlatform();
			const closeMenu = menuCloser(useMenuOpenState);
			const cwd = typeof row?.cwd === "string" && row.cwd !== "" ? row.cwd : void 0;
			if (useItems().reveal === false) return null;
			if (cwd === void 0) return null;
			return h(primitives.MenuItemButton, {
				icon: h(primitives.IconBrowseOutlineRegular),
				onSelect: () => {
					closeMenu?.(false);
					void openPath(cwd, { t });
				}
			}, t(REVEAL_LABEL_KEYS[platform] ?? "menu.reveal"));
		}

		/**
		 * Read one Remote call result: the client Remote layer folds every call into `{ ok: true, value }` or
		 * `{ ok: false, error }`, and a `RemoteError` thrown by the host only lands in `error` and is **not rethrown**;
		 * this plugin's own host methods put another `{ ok, error }` inside `value` to report the business result — so
		 * "the call succeeded" does not mean "the thing was done", and both layers must be checked.
		 *
		 * @param result - the Remote call result.
		 * @returns `{ ok, value, message }`; on failure `message` is the one line shown to the user (may be empty).
		 */
		function readRemoteResult(result) {
			if (result === null || typeof result !== "object") return { ok: false, value: void 0, message: "" };
			if (result.ok !== true) {
				const message = result.error?.message;
				return { ok: false, value: void 0, message: typeof message === "string" ? message : "" };
			}
			return { ok: true, value: result.value, message: "" };
		}

		/**
		 * Call a host method, folding protocol-layer failures (`ok:false` / a thrown error) and business-layer failures
		 * (`value.ok`) into a single line.
		 * @param invoke - a no-argument callback that issues the Remote call.
		 * @returns `{ ok, value, message }`.
		 */
		async function callHost(invoke) {
			let result;
			try {
				result = await invoke();
			} catch (error) {
				return { ok: false, value: void 0, message: error instanceof Error ? error.message : String(error) };
			}
			return readRemoteResult(result);
		}

		/**
		 * "Reveal in Finder" changes name per host platform: Finder on macOS, File Explorer on Windows, and the generic
		 * `menu.reveal` string everywhere else.
		 */
		const REVEAL_LABEL_KEYS = {
			darwin: "menu.revealFinder",
			win32: "menu.revealExplorer"
		};

		/**
		 * Host failure code → string key: the host only guarantees that `code` is stable, and the English sentence in
		 * `error` is a fallback for logs and unknown consumers; **a code missing from this table always falls back to
		 * the host's own text** (the stderr reported by macOS `open`, for instance — that is the system talking and
		 * cannot be translated).
		 */
		const HOST_FAILURE_KEYS = {
			"session-id-required": "host.sessionIdRequired",
			"session-ids-required": "host.sessionIdsRequired",
			"path-unverified": "host.pathUnverified",
			"application-required": "host.applicationRequired",
			"batch-failed": "host.batchFailed",
			"remove-failed": "host.removeFailed"
		};

		/**
		 * A business failure reported by this plugin's own host method inside `value`: translate the error code first
		 * and only use the host's own text when there is no code.
		 * @param value - the host return value.
		 * @param t - the string function injected by the component.
		 * @returns the one line shown to the user (may be empty).
		 */
		function businessFailure(value, t) {
			if (value === null || typeof value !== "object") return "";
			const key = typeof value.code === "string" ? HOST_FAILURE_KEYS[value.code] : void 0;
			if (key !== void 0) return text(key, void 0, t);
			return typeof value.error === "string" ? value.error : "";
		}

		/**
		 * Ask the host to open a path (without an application it opens the system default way): applications registered
		 * with the system go through the official `session.openWorkspacePath`, while the ones in this plugin's list
		 * (terminals, Xcode — not registered) go through `sessionMenu.openWorkspaceWith`.
		 *
		 * Every failure shows an overlay notice — an application that fails to start or a path the host refuses to
		 * verify is otherwise invisible, and the user just thinks the click did nothing.
		 *
		 * @param path - target path.
		 * @param options - `{ action, application, source, t }`.
		 */
		async function openPath(path, options) {
			const say = (key, params) => text(key, params, options?.t);
			const failed = (message) => {
				showOpenFailure(message === "" ? say("open.failed") : say("open.failedWith", { message }));
			};
			const application = options?.application;
			if (application !== void 0 && options?.source === "catalog") {
				if (sessionMenuRemote === void 0) {
					showOpenFailure(say("open.unavailable"));
					return;
				}
				const call = await callHost(() => sessionMenuRemote.openWorkspaceWith(path, application));
				if (!call.ok) {
					failed(call.message);
					return;
				}
				const value = call.value;
				if (value === null || typeof value !== "object" || value.ok !== true) failed(businessFailure(value, options?.t));
				return;
			}
			if (sessionRemote === void 0) {
				showOpenFailure(say("open.unavailable"));
				return;
			}
			const call = await callHost(() => sessionRemote.openWorkspacePath({
				path,
				...options?.action === void 0 ? {} : { action: options.action },
				...application === void 0 ? {} : { application }
			}));
			if (!call.ok) failed(call.message);
		}

		/** Menu group separator (a bit more visible than the official 0.5px hairline, see the STYLE comment). */
		function MenuSeparator() {
			return h("div", { className: "dsm-sep", role: "separator" });
		}

		/**
		 * The application names that must follow the **interface language** (the key is the lowercase .app file name
		 * without its extension): the host's `name` comes from macOS `displayNameAtPath()`, which follows the **system
		 * language**, so it keeps the system's own wording after the interface is switched to English; everything else
		 * goes through `appName()`.
		 */
		const APP_NAME_KEYS = {
			finder: "app.finder",
			terminal: "app.terminal"
		};

		/**
		 * The name an application shows in the menu: known applications → the interface-language dictionary; the rest →
		 * the `.app` file name (independent of the system language); only entries without a usable path fall back to
		 * the `name` given by the host.
		 *
		 * @param application - `{ id, name }`; `id` is the absolute .app path.
		 * @param t - the string function injected by the component.
		 * @returns the display name.
		 */
		function appName(application, t) {
			const id = typeof application?.id === "string" ? application.id : "";
			const base = id.endsWith(".app") ? id.slice(0, -".app".length).split("/").pop() : "";
			if (base !== "") {
				const key = APP_NAME_KEYS[base.toLowerCase()];
				return key === void 0 ? base : t(key);
			}
			return typeof application?.name === "string" && application.name !== "" ? application.name : id;
		}

		/** Menu item: open with (submenu: one entry per available application). */
		function OpenWithSubmenuMenuItem({ sessionId, useMenuOpenState, t }) {
			const row = useSessionRow(sessionId);
			const children = useChildItems();
			const cwd = typeof row?.cwd === "string" && row.cwd !== "" ? row.cwd : void 0;
			const applications = useApplications(cwd);
			const items = applications.map((application) => ({
				key: application.id,
				label: t("menu.openWith", { name: appName(application, t) }),
				// The application icon is a 32×32 PNG data URL rendered by the host with JXA; falls back to the generic arrow when absent.
				icon: typeof application.icon === "string" && application.icon !== ""
					? h("img", { className: "dsm-app-icon", src: application.icon, alt: "" })
					: h(primitives.IconRightUpOutlineRegular),
				run: () => {
					void openPath(cwd, { application: application.id, source: application.source, t });
				}
			}));
			if (useItems().openWith === false) return null;
			/* Second-level switches: an application switched off in Settings is not listed. Unlike the copy group the
			   trigger row stays when nothing is left — an empty list usually means the host half is not ready yet, and
			   dropping the entry entirely would then look like the plugin lost the feature (see loadDeveloperApplications). */
			const visible = items.filter((entry) => childItemOn(children, "openWith", entry.key));
			return h(SubmenuMenuItem, {
				icon: h(primitives.IconRightUpOutlineRegular),
				label: t("menu.openWithTitle"),
				items: visible,
				useMenuOpenState
			});
		}

		/** Menu item: permanently delete the session (danger color, opens the confirmation dialog). */
		function DeleteMenuItem({ sessionId, displayTitle, useMenuOpenState, t }) {
			const closeMenu = menuCloser(useMenuOpenState);
			if (useItems().delete === false) return null;
			return h(Fragment, null,
				h(MenuSeparator),
				h(primitives.MenuItemButton, {
					icon: h(primitives.IconTrashOutlineRegular),
					danger: true,
					onSelect: () => {
						closeMenu?.(false);
						openDeleteDialog({ mode: "one", sessionId, displayTitle: typeof displayTitle === "string" && displayTitle !== "" ? displayTitle : sessionId });
					}
				}, t("menu.delete")));
		}

		/**
		 * Menu item: delete all archived sessions (only appears for an archived row): the official UI hides archived
		 * sessions behind the "show archived only" filter and right-clicking each one is too slow; the workspace header
		 * row (the row holding the filter menu) has no slot, so the plugin cannot get in, see DESIGN.md limitation 6.
		 */
		function DeleteArchivedMenuItem({ sessionId, useMenuOpenState, t }) {
			const archived = useArchivedIds();
			const closeMenu = menuCloser(useMenuOpenState);
			if (useItems().deleteArchived === false) return null;
			if (!archived.has(sessionId) || archived.size === 0) return null;
			return h(primitives.MenuItemButton, {
				icon: h(primitives.IconTrashOutlineRegular),
				danger: true,
				onSelect: () => {
					closeMenu?.(false);
					openDeleteDialog({ mode: "all", sessionIds: [...archived] });
				}
			}, t("menu.deleteArchived"));
		}
		// #endregion

		// #region Seats on the session row
		/**
		 * Extra information in the session row hover card: working directory, last error, unread mark; inserted between
		 * the relative time and the status row of the official hover card, reusing its font size and palette, and only
		 * adding what the official card does not have.
		 */
		function SessionHoverInfo({ sessionId, t }) {
			const row = useSessionRow(sessionId);
			const unread = useUnreadIds();
			const status = row?.projectionValues?.sessionMenuStatus;
			const cwd = typeof row?.cwd === "string" && row.cwd !== "" ? row.cwd : void 0;
			const message = typeof status?.message === "string" && status.message !== "" ? status.message : void 0;
			if (useItems().hoverInfo === false) return null;
			const lines = [];
			if (cwd !== void 0) lines.push(h("div", {
				key: "cwd",
				className: "dsm-hover-status",
				title: cwd
			}, h(primitives.IconFolderOpenRegular, { size: 14 }), h("span", { className: "dsm-hover-path" }, cwd)));
			if (status?.phase === "error") lines.push(h("div", {
				key: "error",
				className: "dsm-hover-status"
			}, h(primitives.StateDot, { state: "error" }), h("span", null, message === void 0 ? t("status.error") : t("status.errorWith", { message }))));
			if (unread.has(sessionId)) lines.push(h("div", {
				key: "unread",
				className: "dsm-hover-status"
			}, h("span", { className: "dsm-dot" }), h("span", null, t("hover.unread"))));
			if (lines.length === 0) return null;
			return h("div", { className: "dsm-hover-lines" }, lines);
		}

		/**
		 * Seat at the start of a session row: the red error dot first, then the blue unread dot.
		 *
		 * The seat is not rendered while the session row's main status is not idle (running / pending / finished
		 * unread) — that is decided by a rendering branch in ui-workspace and this plugin cannot get around it, see
		 * DESIGN.md limitation 1.
		 */
		function SessionRowLeadingMark({ sessionId, t }) {
			const row = useSessionRow(sessionId);
			const unread = useUnreadIds();
			const status = row?.projectionValues?.sessionMenuStatus;
			const phase = typeof status?.phase === "string" ? status.phase : "idle";
			if (useItems().statusDots === false) return null;
			if (phase === "error") {
				const message = typeof status?.message === "string" && status.message !== "" ? status.message : t("status.error");
				return h("span", {
					className: "dsm-dot",
					"data-tone": "error",
					"data-session-menu-mark": "error",
					title: t("status.errorWith", { message })
				});
			}
			if (!unread.has(sessionId)) return null;
			return h("span", {
				className: "dsm-dot",
				"data-session-menu-mark": "unread",
				title: t("status.unread")
			});
		}

		/**
		 * One-click delete button inside a session row: only appears for archived rows — the in-row seat is rendered for
		 * archived rows too (ui-workspace only blocks blank rows).
		 */
		function SessionRowDeleteButton({ sessionId, displayTitle, t }) {
			const archived = useArchivedIds();
			if (useItems().delete === false) return null;
			if (!archived.has(sessionId)) return null;
			return h(primitives.Tooltip, {
				label: t("menu.delete"),
				side: "bottom",
				align: "end",
				delayMs: 500
			}, h("button", {
				type: "button",
				className: "dsm-icon-button",
				"data-tone": "danger",
				"aria-label": t("menu.delete"),
				onClick: (event) => {
					event.stopPropagation();
					openDeleteDialog({ mode: "one", sessionId, displayTitle: typeof displayTitle === "string" && displayTitle !== "" ? displayTitle : sessionId });
				}
			}, h(primitives.IconTrashOutlineRegular, { size: 14 })));
		}

		/**
		 * "Delete all archived sessions" button in the "Workspaces" header row: ui-workspace leaves no slot in the
		 * header row, so it has to be mounted into the DOM directly, and its only dependency is the CSS module's
		 * **local class name** `sectionHeader` (the build-time hash prefix changes between versions, the local name is
		 * stable). It hides silently when the anchor is missing, the header row is too narrow, or the current view
		 * still has unarchived rows; the entry with the same name in the session row context menu is always available.
		 */
		const HEADER_ANCHOR = '[class*="sectionHeader"]';
		const HEADER_BUTTON_ATTR = "data-session-menu-header";
		const HEADER_MIN_WIDTH = 150;
		/** The same artwork as primitives' IconTrashOutlineRegular, needed here as a string that can go into a native DOM node. */
		const TRASH_ARTWORK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" stroke-width="1">' +
			'<path d="M1.28149 3.88831H14.7187" stroke="currentColor"></path>' +
			'<path d="M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833" stroke="currentColor"></path>' +
			'<path d="M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831" stroke="currentColor"></path>' +
			'<path d="M6.44946 6.98926V11.1238" stroke="currentColor"></path>' +
			'<path d="M9.55054 6.98926V11.1238" stroke="currentColor"></path>' +
			'</svg>';

		/**
		 * Whether every currently visible session row is an archived row — i.e. the user is in the "show archived only"
		 * view (or all sessions happen to be archived). Neither the header row nor the filter state exposes an
		 * interface, so it is inferred from the rows' `data-row-key`.
		 * @param archived - the set of archived session ids.
		 * @returns whether the bulk delete entry may be shown.
		 */
		function archivedRowsOnly(archived) {
			if (archived.size === 0) return false;
			if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return false;
			let rows;
			try {
				rows = document.querySelectorAll('[data-row-key^="session:"]');
			} catch (_error) {
				return false;
			}
			if (rows.length === 0) return false;
			for (let index = 0; index < rows.length; index += 1) {
				const key = rows[index].getAttribute("data-row-key") ?? "";
				if (!archived.has(key.slice("session:".length))) return false;
			}
			return true;
		}

		/**
		 * Mount the bulk delete button into the workspace header row; returns a cleanup function.
		 * @param ctx - the client plugin context (used to read strings).
		 * @returns a cleanup function that removes the button and every listener.
		 */
		function installHeaderButton(ctx) {
			if (typeof document === "undefined" || document.body === void 0 || document.body === null) return () => {};
			const bound = typeof ctx.locale?.bind === "function" ? ctx.locale.bind(NS) : null;
			const labelOf = (count) => (bound === null ? `Delete archived (${count})` : bound("menu.deleteArchivedCount", { n: count }));
			const button = document.createElement("button");
			button.type = "button";
			button.className = "dsm-header-button";
			button.setAttribute("data-tone", "danger");
			button.setAttribute(HEADER_BUTTON_ATTR, "");
			button.innerHTML = TRASH_ARTWORK;
			button.addEventListener("click", (event) => {
				event.stopPropagation();
				openDeleteDialog({ mode: "all", sessionIds: [...archivedSnapshot()] });
			});
			/** The current anchor (the header row); `sync` refreshes it every time. */
			let anchorNode = null;
			const sync = () => {
				const anchor = typeof document.querySelector === "function" ? document.querySelector(HEADER_ANCHOR) : null;
				anchorNode = anchor;
				/* Switched off: the button leaves the DOM entirely (a hidden node would still be a rendered shell). */
				if (readItems().deleteArchived === false || anchor === null) {
					if (button.parentNode !== null && button.parentNode !== void 0) button.remove();
					return;
				}
				if (button.parentNode !== anchor) anchor.appendChild(button);
				const archived = archivedSnapshot();
				const show = archived.size > 0 && anchor.clientWidth >= HEADER_MIN_WIDTH && archivedRowsOnly(archived);
				button.style.display = show ? "" : "none";
				if (show) {
					const label = labelOf(archived.size);
					button.title = label;
					button.setAttribute("aria-label", label);
				}
			};
			/** The global DOM changes every frame (streaming output especially), so only changes that can affect the button's visibility are worth syncing. */
			const relevant = (records) => {
				for (let index = 0; index < records.length; index += 1) {
					const record = records[index];
					if (record.target === button || button.contains(record.target)) continue;
					if (button.parentNode === null || anchorNode === null) return true;
					const nodes = [...record.addedNodes, ...record.removedNodes];
					for (const node of nodes) {
						if (node === button || node.nodeType !== 1) continue;
						if (node === anchorNode) return true;
						if (typeof node.querySelector !== "function") continue;
						if (node.contains(anchorNode)) return true;
						if (node.querySelector('[data-row-key]') !== null) return true;
					}
				}
				return false;
			};
			let frame = 0;
			const schedule = () => {
				if (typeof requestAnimationFrame !== "function") {
					sync();
					return;
				}
				if (frame !== 0) return;
				frame = requestAnimationFrame(() => {
					frame = 0;
					sync();
				});
			};
			const observer = typeof MutationObserver === "function" ? new MutationObserver((records) => {
				if (relevant(records)) schedule();
			}) : null;
			if (observer !== null) observer.observe(document.body, { childList: true, subtree: true });
			if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("resize", schedule);
			const unsubscribe = workspacesList !== void 0 && typeof workspacesList.subscribe === "function" ? workspacesList.subscribe(schedule) : null;
			/** Flipping the switch off/on must show/hide the button without waiting for the next list push. */
			const unsubscribeItems = subscribeItems(schedule);
			sync();
			return () => {
				if (observer !== null) observer.disconnect();
				if (typeof window !== "undefined" && typeof window.removeEventListener === "function") window.removeEventListener("resize", schedule);
				if (typeof unsubscribe === "function") unsubscribe();
				unsubscribeItems();
				if (frame !== 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
				button.remove();
			};
		}
		// #endregion

		// #region Delete confirmation dialog
		/** Confirmation before permanent deletion: the same skeleton as the official archive dialog, danger-colored confirm button, no checkbox. */
		function DeleteConfirmForm({ request, t }) {
			const bulk = request.mode === "all";
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState(null);
			const [partial, setPartial] = React.useState(null);
			const close = () => {
				if (!busy) closeDeleteDialog();
			};
			/** Failure reason: reuse what the host reported, otherwise fall back to the "service is not ready" string. */
			const reasonOf = (message) => (message === "" ? t("delete.unavailable") : message);
			const confirm = () => {
				if (busy) return;
				setBusy(true);
				setError(null);
				setPartial(null);
				void (async () => {
					try {
						if (sessionMenuRemote === void 0 && pluginCtx !== void 0) await mountRemote(pluginCtx);
						if (sessionMenuRemote === void 0) throw new Error(t("delete.unavailable"));
						if (bulk) {
							const ids = request.sessionIds;
							const wasMainView = ids.includes(currentMainSessionId());
							const call = await callHost(() => sessionMenuRemote.deleteSessions(ids));
							const value = call.value;
							/* A protocol-layer failure (not connected / endpoint gone) yields no business result at all, so the whole batch counts as failed. */
							if (!call.ok) throw new Error(reasonOf(call.message));
							if (value === null || typeof value !== "object") throw new Error(t("delete.unavailable"));
							/* Only zero deletions count as a total failure (the host may have rejected the whole batch). */
							if (value.ok !== true && (value.deleted ?? 0) === 0) throw new Error(reasonOf(businessFailure(value, t)));
							for (const id of ids) setMarked(id, false);
							if (wasMainView) clearMainView();
							/* On partial failure stay in the dialog and report the counts, so the user knows which step did not work. */
							if ((value.failed ?? 0) > 0) {
								setPartial({ done: value.deleted ?? 0, failed: value.failed });
								return;
							}
							closeDeleteDialog();
							return;
						}
						const wasMainView = currentMainSessionId() === request.sessionId;
						const call = await callHost(() => sessionMenuRemote.deleteSession(request.sessionId));
						const value = call.value;
						if (!call.ok) throw new Error(reasonOf(call.message));
						if (value === null || typeof value !== "object" || value.ok !== true) throw new Error(reasonOf(businessFailure(value, t)));
						setMarked(request.sessionId, false);
						if (wasMainView) clearMainView();
						closeDeleteDialog();
					} catch (reason) {
						setError(reason instanceof Error ? reason.message : String(reason));
					} finally {
						setBusy(false);
					}
				})();
			};
			return h(primitives.Modal, {
				open: true,
				onClose: close,
				closeLabel: t("close"),
				title: bulk ? t("delete.archivedTitle") : t("delete.title"),
				description: bulk ? t("delete.archivedDesc", { n: request.sessionIds.length }) : t("delete.desc"),
				footer: h(Fragment, null,
					h(primitives.Button, { variant: "outline", disabled: busy, onClick: close }, t("delete.cancel")),
					h(primitives.Button, { variant: "outline", disabled: busy, onClick: confirm },
						h("span", { className: "dsm-danger-label" }, bulk ? t("delete.archivedConfirm") : t("delete.confirm")))),
				children: [
					busy && h("div", { className: "dsm-status-text", role: "status", key: "busy" }, bulk ? t("delete.archivedPending") : t("delete.pending")),
					partial !== null && h("div", { className: "dsm-status-text", role: "status", key: "partial" },
						t("delete.archivedPartial", { done: partial.done, failed: partial.failed })),
					error !== null && h("div", { className: "dsm-error-text", role: "alert", key: "error" }, t("delete.failedWith", { message: error }))
				]
			});
		}

		/**
		 * Overlay notice for an open failure: mounted on `shell.overlay` rather than on the menu item that started the
		 * action — the menu closes as soon as it is clicked, and a notice mounted inside it would be unmounted with it.
		 */
		function OpenFailureToast() {
			const notice = React.useSyncExternalStore(subscribeOpenNotice, readOpenNotice, readOpenNotice);
			if (notice === null) return null;
			return h(primitives.Toast, {
				key: notice.seq,
				text: notice.text,
				icon: h(primitives.IconWarningOutlineRegular, {}),
				onDone: dismissOpenNotice
			});
		}

		/** Dialog host: mounted on shell.overlay, renders nothing while there is no request. */
		function SessionDeleteDialog({ t }) {
			const request = React.useSyncExternalStore(subscribeDelete, readDeleteRequest, readDeleteRequest);
			if (request === null) return null;
			return h(DeleteConfirmForm, { key: request.mode === "all" ? "all" : request.sessionId, request, t });
		}
		// #endregion

		// #region Host Remote
		/**
		 * Local codec stub: the host resolves this endpoint in source mode, and the client side only requires the shape
		 * `mode === "strict"`; the schema is never executed.
		 */
		function strictCodec(typeSymbol) {
			const schema = { parse: (value) => value };
			return { mode: "strict", typeSymbol, create: () => schema, schema };
		}

		const REMOTE_CONTRIBUTION = {
			package: PKG,
			descriptors: [{
				id: `${PKG}#${REMOTE_NS}/deleteSession`,
				service: REMOTE_NS,
				namespace: REMOTE_NS,
				method: "deleteSession",
				invocation: { kind: "direct" },
				parameters: [{
					name: "sessionId",
					wire: "sessionId",
					source: "json",
					codec: strictCodec(`${PKG}#${REMOTE_NS}/deleteSession:param:sessionId`)
				}],
				result: strictCodec(`${PKG}#${REMOTE_NS}/deleteSession:result`)
			}, {
				/* In source mode the wire parameter name is the host method's parameter name, so this must match index.js's `deleteSessions(sessionIds)` verbatim. */
				id: `${PKG}#${REMOTE_NS}/deleteSessions`,
				service: REMOTE_NS,
				namespace: REMOTE_NS,
				method: "deleteSessions",
				invocation: { kind: "direct" },
				parameters: [{
					name: "sessionIds",
					wire: "sessionIds",
					source: "json",
					codec: strictCodec(`${PKG}#${REMOTE_NS}/deleteSessions:param:sessionIds`)
				}],
				result: strictCodec(`${PKG}#${REMOTE_NS}/deleteSessions:result`)
			}, {
				/* Host platform (darwin / win32 / linux): decides what the "Reveal in Finder" string is called. No parameters. */
				id: `${PKG}#${REMOTE_NS}/hostPlatform`,
				service: REMOTE_NS,
				namespace: REMOTE_NS,
				method: "hostPlatform",
				invocation: { kind: "direct" },
				parameters: [],
				result: strictCodec(`${PKG}#${REMOTE_NS}/hostPlatform:result`)
			}, {
				/* The developer application list for "Open with": no parameters. */
				id: `${PKG}#${REMOTE_NS}/workspaceApplications`,
				service: REMOTE_NS,
				namespace: REMOTE_NS,
				method: "workspaceApplications",
				invocation: { kind: "direct" },
				parameters: [],
				result: strictCodec(`${PKG}#${REMOTE_NS}/workspaceApplications:result`)
			}, {
				/* Open a directory with the given application; the parameter names match index.js's `openWorkspaceWith(path, application)` verbatim. */
				id: `${PKG}#${REMOTE_NS}/openWorkspaceWith`,
				service: REMOTE_NS,
				namespace: REMOTE_NS,
				method: "openWorkspaceWith",
				invocation: { kind: "direct" },
				parameters: [{
					name: "path",
					wire: "path",
					source: "json",
					codec: strictCodec(`${PKG}#${REMOTE_NS}/openWorkspaceWith:param:path`)
				}, {
					name: "application",
					wire: "application",
					source: "json",
					codec: strictCodec(`${PKG}#${REMOTE_NS}/openWorkspaceWith:param:application`)
				}],
				result: strictCodec(`${PKG}#${REMOTE_NS}/openWorkspaceWith:result`)
			}]
		};

		/**
		 * Mount the Remote service and fetch the namespace.
		 * @param ctx - the client plugin context.
		 */
		async function mountRemote(ctx) {
			const generation = ++remoteGeneration;
			const remote = ctx.get("remote");
			if (remote === void 0 || typeof remote.$mount !== "function") return;
			try {
				await remote.$mount(REMOTE_CONTRIBUTION);
			} catch (error) {
				ctx.logger?.warn?.(`${PKG}: remote mount failed: ${String(error)}`);
			}
			/* $mount is asynchronous and the plugin may already be unmounted meanwhile — then the handle must not be written back. */
			if (generation !== remoteGeneration) return;
			sessionMenuRemote = ctx.get(`remote.${REMOTE_NS}`);
			sessionRemote = ctx.get("remote.session");
		}
		// #endregion

		// #region Plugin body
		/** The client services this plugin needs. */
		const inject = ["slots", "locale", "sessions", "workspaces", "remote"];

		/**
		 * Register the plugin: styles, strings, menu items, the leading status dot, the in-row delete button, the delete
		 * dialog, and "opening marks as read".
		 * @param ctx - the client plugin context.
		 */
		function apply(ctx) {
			pluginCtx = ctx;

			ctx.effect(() => {
				const style = document.createElement("style");
				style.textContent = STYLE;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, `${PKG}: style`);

			ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${PKG}: dictionaries`);

			/* Only remembered, never released: a service reference owns nothing, and clearing it on teardown would make
			   a still-rendering component read the menu as "no native row" and fall back to our duplicate entry. */
			ctx.effect(() => {
				slotsService = ctx.slots;
			}, `${PKG}: slots`);

			ctx.effect(() => {
				sessionsList = ctx.get("sessions")?.list;
				workspacesList = ctx.get("workspaces")?.list;
				if (typeof sessionsList?.subscribe !== "function" || typeof sessionsList?.getSnapshot !== "function") sessionsList = void 0;
				if (typeof workspacesList?.subscribe !== "function" || typeof workspacesList?.getSnapshot !== "function") workspacesList = void 0;
				if (sessionsList === void 0) return () => {};
				const reconcile = () => {
					const mainId = mainSessionId(sessionsList.getSnapshot());
					if (openGuard !== void 0 && mainId !== openGuard.sessionId) openGuard.leftMain = true;
					if (mainId === void 0) return;
					if (openGuard !== void 0 && openGuard.sessionId === mainId && !openGuard.leftMain) return;
					if (unreadIds.has(mainId)) setMarked(mainId, false);
				};
				reconcile();
				return sessionsList.subscribe(reconcile);
			}, `${PKG}: mark opened session as read`);

			ctx.effect(() => {
				void mountRemote(ctx).then(() => loadHostPlatform());
				return () => {
					remoteGeneration += 1;
					sessionMenuRemote = void 0;
					sessionRemote = void 0;
					hostPlatform = "";
				};
			}, `${PKG}: remote`);

			ctx.slots.inject("shell.overlay", function* () {
				yield ctx.slots.register({
					name: "shell.overlay",
					id: "session-menu-delete-dialog",
					order: 60,
					locale: NS
				}, SessionDeleteDialog);
				yield ctx.slots.register({
					name: "shell.overlay",
					id: "session-menu-open-toast",
					order: 61,
					locale: NS
				}, OpenFailureToast);
			});

			ctx.slots.inject("sidebar.workspaces.session.menu.item", function* () {
				yield ctx.slots.register({
					name: "sidebar.workspaces.session.menu.item",
					id: "session-menu-mark-unread",
					order: 150,
					locale: NS
				}, MarkUnreadMenuItem);
				yield ctx.slots.register({
					name: "sidebar.workspaces.session.menu.item",
					id: "session-menu-copy",
					order: 500,
					locale: NS
				}, CopySubmenuMenuItem);
				yield ctx.slots.register({
					name: "sidebar.workspaces.session.menu.item",
					id: "session-menu-reveal",
					order: 520,
					locale: NS
				}, RevealMenuItem);
				yield ctx.slots.register({
					name: "sidebar.workspaces.session.menu.item",
					id: "session-menu-open-with",
					order: 530,
					locale: NS
				}, OpenWithSubmenuMenuItem);
				yield ctx.slots.register({
					name: "sidebar.workspaces.session.menu.item",
					id: "session-menu-delete",
					order: 600,
					locale: NS
				}, DeleteMenuItem);
				yield ctx.slots.register({
					name: "sidebar.workspaces.session.menu.item",
					id: "session-menu-delete-archived",
					order: 610,
					locale: NS
				}, DeleteArchivedMenuItem);
			});

			ctx.effect(() => installHeaderButton(ctx), `${PKG}: header button`);

			ctx.slots.inject("sidebar.workspaces.session.row.action", function* () {
				yield ctx.slots.register({
					name: "sidebar.workspaces.session.row.action",
					id: "session-menu-row-delete",
					order: 300,
					locale: NS
				}, SessionRowDeleteButton);
			});

			ctx.slots.inject("sidebar.session.row.hover", function* () {
				yield ctx.slots.register({
					name: "sidebar.session.row.hover",
					id: "session-menu-hover-info",
					order: 20,
					locale: NS
				}, SessionHoverInfo);
			});

			ctx.slots.inject("sidebar.session.row.leading", function* () {
				yield ctx.slots.register({
					name: "sidebar.session.row.leading",
					id: "session-menu-unread-mark",
					order: 20,
					locale: NS
				}, SessionRowLeadingMark);
			});

			/* The nav row shows the same text the section registers as `label`, so both resolve through the one dictionary key (no new key, no hard-coded title). */
			const settingsLabel = () => (typeof ctx.locale?.bind === "function" ? ctx.locale.bind(NS)("settings.title") : "");
			ctx.effect(() => markSettingsNav(settingsLabel), `${PKG}: settings nav icon`);

			ctx.slots.inject("settings.section", function* () {
				return ctx.slots.register({
					name: "settings.section",
					id: "session-menu",
					order: 30,
					label: () => ctx.locale.bind(NS)("settings.title"),
					locale: NS
				}, SettingsSection);
			});
		}
		// #endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
