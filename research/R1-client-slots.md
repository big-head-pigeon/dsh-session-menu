# R1 — 第三方客户端插件：会话行右键菜单 / 状态点 插槽调研

- 调研对象：DSH 0.2.0-rc.2（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`）
- 调研日期：2026-10-16
- 调研范围：**只读**，未修改任何被测文件
- 结论一句话：四个目标插槽全部存在且对第三方客户端插件开放；**菜单项、hover 按钮、hover 卡都可以自由注册**；**`sidebar.session.row.leading`（行前座位）在"非 idle"时根本不渲染**，所以"红色报错点"**不能**通过该座位实现，但 `StateDot` 本身**已经支持 `error` 红色状态**，只是会话行状态机从不产出它。

---

## 0. 证据来源与符号约定

本报告全部结论来自 asar 内真实代码（非 README）。为可读性使用短别名，**完整路径见下表**，读到本报告的人可直接用下列 asar 路径 grep 复核：

| 别名 | asar 内绝对路径 |
|---|---|
| **W** | `/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js`（4425 行） |
| **S** | `/dsh/node_modules/@deepseek-ai/dsh-client-ui-session/lib/client.js`（499 行） |
| **P** | `/dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js`（12383 行） |
| **PCSS** | `/dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/StateDot.module.css` |
| **T** | `/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js` |
| **CMI** | `/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js`（宿主半边，982 行） |
| **CMC** | `/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js`（浏览器半边，模块加载器本体） |
| **WF** | `/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js`（web 壳，压缩后的单行 bundle） |
| **WREADME** | `/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/README.md` |
| **SK** | `/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/`（**官方插件开发 skill**，含模板） |
| **3P** | `$HOME/.dsh/profiles/desktop/node_modules/@michengai/dsh-archive-manager/`（已装第三方插件，真实范例） |

> **重要发现**：asar 里随包附带了一份官方插件开发 skill `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/`，含 `SKILL.md` + `references/ui-plugin.md` + `templates/decoration/{package.json,cordis.patch.yml,index.js,client.js}`。这是插件开发的**一等公民文档**，本报告多处引用。

复现命令：
```bash
python3 /tmp/asar.py ls <路径子串>          # 列文件
python3 /tmp/asar.py cat <asar内绝对路径>   # 打印内容
```

---

## 1. 可用插槽清单（总览）

四个座位**全部由 `@deepseek-ai/dsh-client-ui-workspace` 的 `WorkspaceBrowser` 入口声明**（不是 ui-sidebar 声明的；ui-sidebar 里完全没有这些名字）。

声明位置：**W:4299-4330**，`ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({ name: "sidebar.workspaces", children: {...} }, WorkspaceBrowser))`

```js
// W:4301-4326
children: {
  "sidebar.workspaces.directoryFlow":            { kind: "single", scope: "root" },
  "sidebar.workspaces.session.menu.item":        { kind: "list", scope: "root",
                                                   inject: { hooks: {
                                                     menuOpenState: menuOpenStateFactory,
                                                     shortcuts: ctx.shortcuts.catalog } } },
  "sidebar.workspaces.session.row.action":       { kind: "list", scope: "root" },
  "sidebar.session.row.leading":                 { kind: "list", scope: "root" },
  "sidebar.session.row.hover":                   { kind: "list", scope: "root" },
}
```

| 插槽 | kind | scope | 渲染位置（W 行号） | 渲染时机 | 传给 entry 的 props |
|---|---|---|---|---|---|
| `sidebar.workspaces.session.menu.item` | list | root | "…" 菜单的 children，W:1661 | 菜单打开时 | `sessionId`, `displayTitle` + 注入面 |
| `sidebar.workspaces.session.row.action` | list | root | 行右侧 hover 操作条，W:1665 | 行 hover 时 | `sessionId`, `displayTitle` + 注入面 |
| `sidebar.session.row.leading` | list | root | 行首 `span.slot`，W:1622-1623 | **仅当 primary status 为 idle 且非 archived/blank** | `sessionId` |
| `sidebar.session.row.hover` | list | root | hover 卡内部，W:1472 | hover 卡打开时（**不受行状态限制**） | `sessionId` |

hover 卡本身：`HoverCard` 包整行，`content: <SessionHoverContent/>`，`openDelayMs: 800`，`disabled: menuOpen || drag?.active === true`（W:1672-1680）。所以**菜单打开时 hover 卡不弹**。

---

## 2. `sidebar.workspaces.session.menu.item` 完整契约

### 2.1 注册对象字段

真实调用（内置 4 个菜单项，W:4331-4360）：

```js
ctx.slots.inject("sidebar.workspaces.session.menu.item", function* () {
  yield ctx.slots.register({
    name: "sidebar.workspaces.session.menu.item",   // 必填，必须与插槽名一致
    id: "pin",                                      // 必填，本插槽内唯一；复用内置 id 会"遮蔽"该动作
    order: 100,                                     // 可选，排序权重（pin 100 / rename 200 / fork 300 / archive 400）
    locale: NS,                                     // 本 entry 的 i18n 命名空间（NS = "workspace"）
    inject: pinInjected,                            // 注入工厂，见 2.3
  }, PinSessionMenuItem);
});
```

- `name` / `id` / `order` / `locale` / `inject` / `store` 都是注册对象字段；`children` 只有**声明者**用（entry 不用）。
- `priority` 字段在 `register` 里也存在（第三方插件用 `priority: -0.5` 覆盖整棵 `sidebar.workspaces`，见 3P client.js 中 `_e={name:"sidebar.workspaces",priority:-.5,...}`）。README（WREADME:98）说明：**复用内置 id 时 `priority` 可以让你的注册遮蔽内置动作**。

### 2.2 Component 收到的 props

从真实组件签名取证：

```js
// W:3634  PinSessionMenuItem
const { sessionId, useMenuOpenState, pinSession, unpinSession, t } = props;
// W:3685  RenameSessionMenuItem
function RenameSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, useShortcuts, requestSessionRename, t })
// W:3424  ArchiveSessionMenuItem
function ArchiveSessionMenuItem({ sessionId, useArchived, useMenuOpenState, useShortcuts, archiveSession, unarchiveSession, t })
// W:3599  ForkSessionMenuItem
function ForkSessionMenuItem({ sessionId, useMenuOpenState, useShortcuts, forkSession, t })
```

| prop | 来源 | 说明 |
|---|---|---|
| `sessionId` | 框架（owner 传） | W:1661 `renderSlot("sidebar.workspaces.session.menu.item", { sessionId: node.id, displayTitle: row.title }, ...)` |
| `displayTitle` | 框架（owner 传） | 同上；会话显示标题 |
| `useMenuOpenState` | 插槽声明层的 `inject.hooks.menuOpenState` | **hook 命名规则：注册名 `menuOpenState` → prop 名 `useMenuOpenState`**（加 `use` 前缀并首字母大写）。同理 `pinned → usePinned`、`archived → useArchived`、`shortcuts → useShortcuts` |
| `t` | 注册对象的 `locale: NS` | 由框架按命名空间绑定的翻译函数 |
| 其余键 | 注册对象的 `inject` 工厂返回值 | 原样展开成 props |

### 2.3 `inject` 工厂（行为注入面）

`inject` 可以是**函数**（推荐）或对象。函数形态 `(standardProps, hookContext) => Record<string, unknown>`：

```js
// W:4180-4195
const pinInjected = () => ({
  hooks: { pinned: pinnedSet, archived: archivedSet },   // hooks 子对象 → useXxx(props) hook
  pinSession:   (sessionId) => { uiWorkspace.pinSession(sessionId).catch(...) },
  unpinSession: (sessionId) => { ... },
});
```

- 返回值里 **`hooks` 子对象**会被投影成 `useXxx` 形式的 **selector hook**（形如 `usePinned(sel)`，见 W:3621-3628 `usePinState`）。
- 其余键直接成为组件 props（`pinSession`、`archiveSession`、`requestSessionRename`…）。
- 工厂可以闭包捕获插件通过 Cordis `inject` 拿到的服务（WREADME:163）。

### 2.4 如何关闭菜单

**菜单不会自动关闭**，每个 entry 自己关。插槽声明层提供的 hook：

```js
// W:21（插槽声明层的 hook 工厂）
const menuOpenStateFactory = (_standard, state) => () => state;   // state = [open, setOpen]
// W:1580（行渲染处把 React state 作为 hookContext 绑进渲染事件）
const menuOpenState = react.useMemo(() => [menuOpen, setMenuOpen], [menuOpen]);
// W:1664
renderSlot("...menu.item", { sessionId, displayTitle }, { hookContext: menuOpenState })
```

用法（内置实现统一写法）：

```js
const [, setMenuOpen] = useMenuOpenState();
// onSelect 里：
setMenuOpen(false);
```

见 W:3635 + W:3644-3647（Pin）、W:3425 + W:3600、W:3686。README 原文（WREADME:100）：“dismisses the menu through the slot-level `useMenuOpenState` hook, the menu's own open state bound from the row's render occurrence”。

菜单本体是 `Menu` 组件，`portal: true`、`closeOnPointerLeave: true`、anchor 是行上的 `button.iconButton`（IconEllipsisOutlineRegular）（W:1650-1663）。

### 2.5 `MenuItemButton` 来自哪个包

来自 **`@deepseek-ai/dsh-client-ui-primitives`**（W:11 `let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives")`；使用处 W:3640、W:3645-3648）。

实现（**P:3830-3863**）：

```js
function MenuItemButton({ children, shortcut, icon, disabled = false, danger = false,
                          separatorBefore = false, onSelect }) {
  return div.itemWrap[
    separatorBefore && div.separator[role="separator"],     // ← 分隔线
    button[type=button][role=menuitem].item(.danger)[disabled][aria-keyshortcuts][onClick=onSelect][
      icon && span.itemIcon, span.itemLabel(children), shortcut && span.shortcut(ShortcutKeys)
    ]
  ]
}
```

| prop | 类型 | 语义 |
|---|---|---|
| `children` | ReactNode | 标签文本 |
| `icon` | ReactNode | 左侧图标 |
| `shortcut` | `{ aria, keys }` | 右侧快捷键提示 |
| `disabled` | bool | 禁用 |
| `danger` | bool | 危险样式（红） |
| `separatorBefore` | bool | **该行上方画一条发丝分隔线**（`role="separator"`），用于分组开始。README：`separatorBefore` opens the plugin group（WREADME:100、WREADME:141、152） |
| `onSelect` | `() => void` | 行激活回调（**不负责关菜单**） |

注意：`separatorBefore` 的分隔线**在 `div.itemWrap` 内部**，所以组件 `return null` 时整行（含分隔线）一起消失——不会留下孤儿分隔线。

### 2.6 内置占位

`order` 已占用：`100 pin` / `200 rename` / `300 fork` / `400 archive`（菜单）。**`order: 500` 是官方 README 示例推荐给插件的落点**（WREADME:152），第三方插件 @michengai/dsh-archive-manager 也用的 500。

---

## 3. 其余三个插槽的契约

### 3.1 `sidebar.workspaces.session.row.action`（hover 按钮）

渲染处 **W:1665-1668**：

```js
renderSlot("sidebar.workspaces.session.row.action", { sessionId: node.id, displayTitle: row.title })
```

完整包裹容器（W:1638-1668）：`span.rowActions`（`onClick` 里 `e.stopPropagation()`，防止点按钮时打开会话），内部是 `Menu`（"…"）+ `row.action` 的 renderSlot。

注册（W:4361-4376）：`{ name, id: "archive"|"pin", order: 100|200, locale: NS, inject }`，props 同菜单项（`sessionId`、`displayTitle`、注入面、`t`）。**没有 `useMenuOpenState`**（不在菜单里）。
约定：**一个 entry 渲染一个 icon button**（WREADME:163）。内置范例 W:3652+（`PinSessionRowButton` 用 `Tooltip` + icon button）。`order: 100 = archive`（最左）、`200 = pin`（最右）。

### 3.2 `sidebar.session.row.leading`（行前座位）

渲染处 **W:1622-1623**（唯一一处）：

```js
jsx("span", {
  className: Rows_module_css_default.slot,
  children: !row.archived && !row.blank && (
    showStatus ? jsx(SessionStatusDots, { statuses })
               : renderSlot("sidebar.session.row.leading", { sessionId: node.id })
  )
})
```

props **只有 `sessionId`**。README（WREADME:90）明确：“Both take the row's Session identity and nothing else, so an occupant reads its own data by that id; a Session-scoped seat would force a Session binding, which would activate and retain every listed Session.”

渲染条件 = `!archived && !blank && !showStatus`，其中 `showStatus` 定义于 **W:1577**：`const showStatus = primaryStatus.state !== "idle";`

搜索模式下**没有 leading 座位**（搜索结果用另一个组件，W:1512-1513：`!result.archived && primaryStatus.state !== "idle" && <SessionStatusDots/>`，没有 else 分支的 renderSlot）。

### 3.3 `sidebar.session.row.hover`（悬浮卡座位）

渲染处 **W:1472**，在 `SessionHoverContent` 内：

```js
// W:1459-1483 简化
div.hoverContent[
  div.hoverTitle(title), div.hoverTime(...),
  renderSlot("sidebar.session.row.hover", { sessionId: node.id }),      // ← W:1472
  div.hoverStatus[ StateDot(state) + label ] per status,                 // W:1475
  archived && div.hoverArchived(...)
]
```

props **只有 `sessionId`**。README（WREADME:179）：“A Session card also renders its `sidebar.session.row.hover` seat between the relative time and the trailing status lines **whenever the card is open, independent of the row's own state.**” —— 这是**唯一不受状态限制**的座位。

---

## 4. 状态点现状（关键）

### 4.1 状态机：`sessionStatuses()` — **W:1386-1435**

```js
function sessionStatuses(node, t) {
  // W:1389
  label: t(node.runningSubagentCount === 1 ? "status.subagentsRunning.one"
                                            : "status.subagentsRunning.other",
           { n: node.runningSubagentCount })
  // W:1396-1399  pendingInteraction === "approval"    → { state: "warning", label: 等待审批, trailingLabel: 待审批 }
  // W:1403-1406  pendingInteraction === "plan-review" → { state: "warning", label: 计划待审, trailingLabel: 计划待审 }
  // W:1410-1413  pendingInteraction === "question"    → { state: "warning", label: 等待回答, trailingLabel: 待回答 }
  // W:1422        node.running                        → { state: "ongoing", label: 进行中 }
  // W:1429        node.completed                      → { state: "done",    label: 已完成 }
  // W:1433        兜底                                 → { state: "idle",   label: 空闲 }
}
```

**行内渲染的状态全集 = `warning` / `ongoing` / `done` / `idle` 四种，没有 `error`。**

优先级：`pendingInteraction(approval|plan-review|question)` > `running` > `runningSubagentCount`（追加一条 ongoing） > `completed` > `idle`。

渲染：**W:1437-1442**

```js
function SessionStatusDots({ statuses }) {
  return div[ <StateDot state={statuses[0].state} />,
              ...statuses.map(s => <span.visuallyHidden>{s.label}</span>) ]
}
```
⇒ **只画 primary（数组第一个）一个点**，其余状态只进屏幕阅读器。

行内还用 primary 状态做两件事：
- `trailingLabel` 替换行尾相对时间（W:1636-1637）；
- `timeLabel` 回退。

### 4.2 `StateDot` 组件 — **P:3040-3095**，CSS **PCSS**

签名：`function StateDot({ state, size, className, appearance = "dot" })`，`state ∈ done | warning | ongoing | error | idle`。默认尺寸 `ongoing = 14px`，其余 `10px`；`ongoing` 渲染 SVG 转圈（1.5s 线性旋转 + arc），其余渲染 `span.dot`/`span.step`，带 `data-state` 属性。

颜色（**PCSS**）：

| state | CSS 变量 | 亮色值 | 暗色值 | 形状 |
|---|---|---|---|---|
| `done` | `--dsw-alias-state-success-primary` | `--dsw-static-green-500` = **`#22c55e`** | 同 | 实心 6px 圆点 |
| `warning` | `--dsw-alias-state-warn-primary` | `--dsw-static-amber-500` = **`#f59e0b`** | 同 | 实心 |
| **`error`** | `--dsw-alias-state-error-primary` | `--dsw-static-red-600` = **`#ec1313`** | `--dsw-static-red-400` = **`#f25a5a`** | 实心 |
| `idle` | `--dsw-alias-state-idle-primary` | `--dsw-static-neutral-300` = **`#d4d4d4`** | `--dsw-static-neutral-600` = **`#545557`** | 实心 |
| `ongoing` | `--dsw-alias-label-tertiary` | — | — | SVG 转圈（非点） |

圆点画法（PCSS）：`.dot { position: relative; display: inline-block; flex: none }` + `.dot::after { content:''; position:absolute; inset:20%; border-radius:50%; background: currentColor }`。

令牌定义处：**T:1148**，常量 `design_platform_css_default`（一整个 CSS 字符串，含亮/暗两套 `body{...}` 块；亮色块偏移 ≈ 59647，暗色块偏移 ≈ 66531）。静态色板同文件：
`--dsw-static-green-500:#22c55e; --dsw-static-red-600:#ec1313; --dsw-static-red-400:#f25a5a; --dsw-static-amber-500:#f59e0b; --dsw-static-neutral-300:#d4d4d4; --dsw-static-neutral-600:#545557;`

> **注意**：`dsh-client-ui-theme` 包里**没有独立的 token CSS 文件**，令牌全部内联在 `lib/client.js:1148` 这个字符串里。

### 4.3 有没有"报错=红色"这一状态？

- **`StateDot` 支持 `error` 红色**，且**在别处真的被用**：
  - `/dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js:3498` 与 `:3560`：`<StateDot state="error" />`
  - `/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js:1291`：`state: "error"`
  - `/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js:2570,2577` 与 `lib/types/client/sessions/manager.js:286,294`：projection 加载错误 `{ state: "error", error }`（这是数据层状态，不是会话行状态）
- **但会话行（sidebar 的 Session row）永远不会显示红点**：`sessionStatuses`（W:1386-1435）没有任何 `error` 分支；会话运行失败不会反映到行状态点。

### 4.4 有没有 done 绿点？

**有。** `node.completed === true` → `{ state: "done" }`（W:1429）→ `StateDot data-state="done"` → `#22c55e` 绿点。
但**只在"完成但未查看"时出现**，逻辑见 4.5。

### 4.5 unread（finished-but-unviewed）判定与存储

判定逻辑在 **S:314-341**（`class UiSession extends cordis.Service`，服务名 `"uiSession"`，S:132）：

```js
// S:314-321
observeRunning(sessionId, running) {
  const previous = this.running.get(sessionId);
  const beforeBaseline = this.sessions.list.getSnapshot().phase === "pending";
  this.running.set(sessionId, running);
  if (running) this.completionUnread.delete(sessionId);
  else if ((previous === true || (previous === void 0 && beforeBaseline))
           && !this.isMain(sessionId)) this.completionUnread.add(sessionId);
  this.publishStatus();
}

// S:322-338 reconcileStatus()  —— 主视图会话一律不算 unread
for (const id of present) if (this.isMain(id)) this.completionUnread.delete(id);

// S:339-341  isMain：被主视图 retain 的会话
isMain(sessionId) { return (this.sessions.list.getSnapshot().byId[sessionId]?.retainedBy.mainView ?? 0) > 0; }
```

**存储形式：纯内存 `Set`** —— `completionUnread = new Set()`（**S:141**），同类的还有 `running = new Map()`（S:140）、`statusSnapshot`（S:142）。

对外暴露：`sessionStatus` 服务（S:148-156，`getSnapshot()` + `subscribe()`），发布在 **S:342-358** `publishStatus()`，产出 `{ running, pendingInteraction, completionUnread }`（S:350-354）。ui-workspace 读的就是它（W:461、W:607 `completed: status?.completionUnread === true`）。

数据源：`ctx.remote.$on("api-session/status", (sessionId, running) => this.observeRunning(...))`（S:180-182）。

> **⚠️ 关键结论：unread 状态不落盘。** 全 asar 里 `localStorage` 的键只有：
> - ui-conversation：`` `${CONVERSATION_STORE_KEY}.${sessionId}` `` 与 width 偏好键
> - ui-schedule：`STORAGE_KEY` 与 `` `dsh.schedule.task-tab.v1.${sessionId}` ``
> - ui-sidebar-right：`` `dsh.sidebar-right.v1.${sessionId}` ``
> - ui-shortcuts：`dsh.keybindings.v1`
>
> **没有任何 unread/completionUnread 的 localStorage / sessionStorage 键**。刷新页面 → `uiSession` 服务重建 → 所有未读绿点消失（只有仍处于 pending 列表基线之前的 running 会被重新计入）。

---

## 5. `sidebar.session.row.leading` 的渲染条件 → 能否加"非 idle 时的自定义点"？

### 5.1 代码事实

W:1622-1623 是一个**三元表达式**，`showStatus === true` 时渲染 `SessionStatusDots`，**`renderSlot` 根本不执行**。
⇒ **第三方插件无法借 `leading` 在 running / warning / done 时显示任何东西。** 这不是"文档约定"，是渲染分支的硬事实。

### 5.2 替代方案与可行性

| 方案 | 可行性 | 依据 / 代价 |
|---|---|---|
| **A. 用 `sidebar.session.row.hover` 座位** | ✅ **完全可行、官方推荐** | W:1472；README:179 明确 "whenever the card is open, **independent of the row's own state**"。代价：需要 hover（800ms 延迟，W:1677），不能做"一眼可见的状态点" |
| **B. 用 `sidebar.workspaces.session.row.action` 做常驻图标** | ⚠️ 半可行 | 只在行 hover 时出现，且行为 icon button，位置在行尾不在行首 |
| **C. 自己注册 `sidebar.workspaces` 整棵子树** | ⚠️ 高风险 | 第三方插件 @michengai 曾用 `priority: -0.5` 覆盖整个 `sidebar.workspaces` 来镜像插槽（3P client.js）。会与内置 WorkspaceBrowser 竞争，升级易碎 |
| **D. CSS 覆盖 + `data-row-key`** | ⚠️ 技术可行但违反官方规则 | 行容器带 **`data-row-key="session:<sessionId>"`**（**W:1592**），所以 `[data-row-key="session:abc"] .jJkEga_slot::after{...}` 这类选择器能命中。但 (1) CSS module 类名是**构建期哈希**（`Rows_module_css_default`，W:1070-1090，前缀 `jJkEga_`），升级即失效；(2) SK `references/practices.md` 明确 "Do not write DOM outside your component"、"Do not read another plugin's DOM, stylesheet, or component source to estimate placement" |
| **E. 插槽整体替换 / portal 到行内** | ❌ 不推荐 | 同上，且会破坏 AnimatedRows 的行动画与拖拽（W:1729 `clone.removeAttribute("data-row-key")`） |

### 5.3 关于"红色报错点"的可行结论

1. **`StateDot` 有 `error` 红色**（PCSS `.dot[data-state='error']`），但**会话行不会产出该状态**。
2. **`leading` 座位在非 idle 时不可用** → 想"在 running/done 时并排加一个红点"**做不到**。
3. **能做的最接近方案**：
   - 在 `sidebar.session.row.hover` 里渲染自己的 `<StateDot state="error" />`（但需 hover）；
   - 或等 idle 时在 `leading` 渲染自定义红点（此时行本身无点，`leading` 可用）——**但"报错"通常伴随非 idle，语义错位**；
   - 或**先用官方途径确认宿主是否真的会把"报错"反映为某个 pendingInteraction/running 变化**——目前代码里没有。
4. 若要"行首永远显示自定义点"，**唯一稳定途径是向上游提需求**（新增 `sidebar.session.row.trailing` 之类的座位，或让 `leading` 接受 `kind: list` 且不 gate 状态）。

---

## 6. i18n：插件如何注册自己的文案

### 6.1 注册调用（真实代码）

**W:4143-4146**（`apply` 内，包在 `ctx.effect` 里以便卸载时回收）：

```js
ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-workspace: dictionaries");
```

- `NS` = **W:4099**：`const NS = "workspace"; /** Dictionary namespace owned by this plugin. */`
- 字典**键名是语言 id**：**`zh` / `en`**（`dsh-client-locale/lib/client.js:922` `const LOCALE_IDS = ["zh", "en"];`，`lib/index.js:11` 同）。
- 值：**内联进 client.js 的普通对象字面量**，不是外部文件 —— 中文在 **W:3860-3979**（`const zh = {...}`），英文在 **W:~3980-4095**（`const en = {...}`）。示例键：`"status.idle": "空闲"`（W:3962）、`"status.completed": "已完成"`（W:3969）、`"status.subagentsRunning.other": "{n} 个子智能体运行中"`（W:3961）。
- 其它真实调用点：`dsh-client-ui-approval/lib/client.js:316`、`dsh-client-ui-chat/lib/client.js:12321`、`dsh-client-ui-commands/lib/client.js:1418`、`dsh-client-ui-cordis/lib/client.js:1348`、`dsh-client-ui-conversation/lib/client.js:17950`、`dsh-client-ui-agent-preset/lib/client.js:1591`（`ctx.locale.register("settings.agentPreset", {...})` 内联字符串命名空间同样合法）。

### 6.2 `t` 从哪来

两种方式：

1. **命令式绑定**（非组件代码用）：**W:105** `const t = ctx.locale.bind("workspace");`
2. **组件 props**（声明式）：注册对象写 `locale: NS`，框架把绑定好的 `t` 注入组件 props。签名（从 runner 的类型 dump）：

```ts
// @deepseek-ai/dsh-cordis-client-runner/lib/client.js:1214
register<N extends Extract<keyof LocaleNamespaceMap, string>>(
  ns: N, dicts: Record<BuiltInLocaleId, LocaleDictOf<N>>): () => void
// :1246
bind<N extends Extract<keyof LocaleNamespaceMap, string>>(ns: N): TranslateNS<N>
```

**支持插值**：`t("status.subagentsRunning.other", { n: 3 })` → `"{n} 个子智能体运行中"`（W:1389 真实调用；WREADME:126-127、142 示例 `t('export', { title: displayTitle })`）。

返回值 `() => void` 是 disposer（所以包 `ctx.effect`）。

### 6.3 `LocaleNamespaceMap` 声明合并

- 类型定义（runner 的类型 dump）：
  ```ts
  // dsh-cordis-client-runner/lib/client.js:1915
  export type LocaleDictOf<N extends keyof LocaleNamespaceMap & string>
    = Record<LocaleNamespaceMap[N] & string, string>;
  // :1763  CommonKeyOf —— common 命名空间的键在所有 ns 都可用
  // :1923  LocaleKeysOf<N> = LocaleNamespaceMap[N] & string | CommonKeyOf
  ```
- 插件侧写法（WREADME:120-124）：
  ```ts
  import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
  import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'   // ← 加载 SlotMap 声明，否则不知道插槽键
  declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap { 'acme.sessionActions': 'export' }   // ns → 键的联合类型
  }
  ```
- `README.i18n.yaml` 是**包文档的 i18n 元数据**（用于文档站翻译），**不是**运行时文案来源；运行时文案在 `lib/client.js` 内联。

### 6.4 第三方插件用外部 `locale/*.json`？

`3P/locale/` 有 `en.json`、`ru.json`、`zh.json`，且 `3P/package.json` 声明了 `"./locale/*.json": "./locale/*.json"` 导出。但这**不是宿主自动加载机制** —— 从 `3P/lib/client.js` 的证据看，它的文案最终仍以 JS 对象形式打进 bundle（`Ui="archive-manager-workspace"` 为 ns，用 `P.locale.bind(Ui)(...)` 取词）。**未找到**宿主扫描 `locale/` 目录的代码；`locale/*.json` 更可能是作者自用/构建期输入。第三方包**推荐直接把字典内联进 `lib/client.js`**。

---

## 7. 客户端 ↔ 宿主通信

### 7.1 两个不同的 `inject`（**最容易踩的坑**）

| 位置 | 内容 | 语义 |
|---|---|---|
| `package.json` → `dsh.client.inject` | **包名**（如 `"@deepseek-ai/dsh-client-ui-workspace"`） | **仅加载顺序 / 预取元数据**，不参与 apply 时序 |
| 客户端模块导出的 `export const inject` | **Cordis 服务名**（如 `"slots"`, `"sessions"`, `"locale"`, `"remote"`） | Cordis fiber 依赖注入，apply 前等待这些服务 |

ui-workspace 的真实注释（**W:4100-4107**）：

> “Required services (cordis fiber inject). The target slots are declared by the ui-sidebar / ui-conversation applies, whose activation order relative to this one is NOT constrained: **dsh.client.inject edges are informational (loading/prefetch metadata, never apply sequencing)** and neither owner provides a waitable service. apply therefore depends on each slot declaration through `slots.inject()` instead of assuming order.”

⇒ **注册插槽必须用 `ctx.slots.inject(slotName, cb)` 包住 `ctx.slots.register(...)`**，不能假设别人已经 apply 了。

### 7.2 客户端服务清单

`package.json` 的 `dsh.client.inject`（包名）示例（W package.json）：

```
@deepseek-ai/dsh-api-remotes, dsh-api-session-controller, dsh-api-workspace-controller,
dsh-client-connection, dsh-client-locale, dsh-client-shortcuts,
dsh-client-ui-conversation, dsh-client-ui-layout, dsh-client-ui-renderer,
dsh-client-ui-session, dsh-client-ui-sidebar
```

客户端模块的 Cordis `inject`（服务名）示例（**W:4108-4117**）：

```js
const inject = ["slots", "sessions", "workspaces", "locale", "remote",
                "remote.directoryPicker", "layout", "shortcuts"];
// W:4419-4420
exports.apply = apply; exports.inject = inject;
```

第三方插件（3P client.js 压缩后可见）：`Sk=["slots","sessions","workspaces","locale","remote","typert"]`。

常用服务速查：
- `ctx.slots` — `inject/register/entries/subscribe/provideRoot/bindStoreScope`
- `ctx.locale` — `register(ns, dicts)` / `bind(ns)`
- `ctx.get("sessions")` / `ctx.get("workspaces")` — 客户端数据控制器（W:4125-4126）
- `ctx.remote` — 宿主 RPC 代理；`ctx.remote.$host`（W:4159）、`ctx.remote.$on(event, cb)`（S:180-182）
- `ctx.effect(fn, label)` / `ctx.on(event, cb)` — 生命周期
- `ctx.shortcuts.catalog`（W:4311）
- `ctx.loader.internal`（模块系统自省）
- `ctx.reflect.provide(name, value)`（CMC 里用来把模块系统发布成 `ctx.modules`）

### 7.3 调宿主 API 的两种真实方式

**(a) 类型化 RPC（typert）** —— 推荐

宿主半边（3P `lib/host-install.js:1-8`）：

```js
import { bindArchiveManagerRemote, installArchiveWorkspace, ... } from "./workspace.js";
const inject = ["workspaceRegistry", "sessionProjectionCache", "typert"];
async function apply(ctx) { ... unbindRemote = bindArchiveManagerRemote(ctx); ... }
```

宿主注册描述符（3P `lib/workspace.js:245-275`）：

```js
import { bindTypertRemote, Remote } from "@deepseek-ai/dsh-typert-protocol";
const ARCHIVE_MANAGER_TYPERT = {
  package: "@michengai/dsh-archive-manager",
  face: "host",
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: ARCHIVE_MANAGER_INVOCATIONS,
};
function bindArchiveManagerRemote(ctx) {
  const typert = ctx.get("typert");
  if (typert === void 0 || typeof typert.register !== "function")
    throw new Error("archive-manager: typert is unavailable");
  try { const dispose = typert.register(ARCHIVE_MANAGER_TYPERT); ... }
  catch (error) { if (!error.message.includes("already registered")) throw error; }   // 幂等
}
```

客户端调用（3P `lib/client.js`，压缩后）：

```js
const tt = async (method, ...args) => {
  const api = ctx.get("remote.workspaceRegistry");         // typert 绑定的远程服务代理
  if (!api || typeof api[method] !== "function") throw new Error(ctx.locale.bind(NS)("service.unavailable"));
  const result = await api[method].apply(api, args);
  if (!result.ok) throw new Error(result.error.message);   // ← 统一结果信封 { ok, value } | { ok, error }
  return result.value;
};
```

⇒ **约定：客户端 `ctx.get("remote.<serviceName>")` 拿到代理，方法调用返回 `{ok:true,value}` / `{ok:false,error}`，必须自己解包。**

内置范例（W:4177）：

```js
const result = await sessions.using(sessionId, { source: "workspaceOperation" },
                                   (reference) => reference.binding.session.rename(title));
if (!result.ok) throw new Error(result.error.message);
```

**(b) 直接 HTTP 路由（`webServer`）** —— 3P 也用了，但只在宿主半边

3P `lib/index.js:1-3`：`const inject = ["webServer", ...hostInject];`（宿主半边注入 `webServer` 以注册路由）。**未在 `lib/host-install.js` 里找到 `ctx.webServer` 的路由调用**（grep 无命中），说明它主要靠 typert。

### 7.4 客户端 ↔ 宿主最小骨架

```js
// 客户端半边（lib/client.js 内）
const api = ctx.get("remote.myService");           // 需在 dsh.client.inject 里声明提供方包
const r = await api.doThing(payload);
if (!r.ok) throw new Error(r.error.message);
return r.value;

// 监听宿主事件
ctx.effect(() => ctx.remote.$on("api-session/status", (id, running) => { /* ... */ }),
           "my-plugin: status subscription");

// 宿主就绪信号
ctx.remote.$host;                                   // 返回宿主信息快照
ctx.on("connection/reset", listener);               // 连接重置
```

---

## 8. 客户端 bundle 的形态与加载链路

### 8.1 形态：**不是 ESM，是 `window.__ModuleLoader__.load({id, factory})`**

`@deepseek-ai/dsh-client-ui-workspace/lib/client.js` 第 1-11 行：

```js
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-client-ui-workspace",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let _deepseek_ai_dsh_client_store   = require("@deepseek-ai/dsh-client-store");
    let _deepseek_ai_cordis             = require("@deepseek-ai/cordis");
    let react_jsx_runtime               = require("react/jsx-runtime");
    let react                           = require("react");
    let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    ...
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
//# sourceMappingURL=client.js.map
```

- **官方模板完全相同**（SK `templates/decoration/client.js`）：
  ```js
  window.__ModuleLoader__.load({
    id: '@local/my-decoration',
    factory(require) {
      const React = require('react');
      ...
      return { inject: ['slots'], apply(ctx) { ctx.slots.inject('...', () => ctx.slots.register({...}, Decoration)) } };
    },
  });
  ```
- 第三方 3P `lib/client.js` 开头 30 行同样是这个形态：`globalThis.__dshArchiveReact = require("react"); ... require("react/jsx-runtime"); require("react-dom"); require("react-dom/client");`
- **`id` 必须等于包名**（SK `references/ui-plugin.md`：“The browser artifact registers a lazy factory **whose id equals the package name**”）。

### 8.2 外部依赖如何解析

**基线模块表（frozen static table）** 定义在 **WF:126** 的 `function rM()`（web 壳）：

```js
function rM(){ return {
  "react": Ef,
  "react/jsx-runtime": If,
  "react-dom": Rf,
  "react-dom/client": Df,
  "@deepseek-ai/cordis": sf,
  "@deepseek-ai/dsh-client-store": lh,
  "@deepseek-ai/dsh-client-ui-slots": hh,
  "@deepseek-ai/dsh-client-ui-primitives": sE,
  "@deepseek-ai/dsh-client-ui-dockkit": XS,
}; }
```

调用处（同文件 WF:126）：

```js
const o = globalThis.__ModuleLoader__;
if (o === undefined) throw new Error("web boot: window.__ModuleLoader__ bootstrap facade is missing");
const s = globalThis.__DSH_TRANSPORT__;
this.modules = o.create({ boot: n.__DSH_BOOT__, staticModules: rM(),
                          ...(s?.loadBundle === undefined ? {} : { loadBundle: s.loadBundle }),
                          ...this.seams });
```

⇒ **只有这 9 个 specifier 可以直接 `require()`**（无需声明）。要在基线外 `require` 别的包，必须在 `package.json` 的 **`dsh.client.external`** 里声明（CMI:67 `const external = optionalStringArray(pkgName, "dsh.client.external", decl.external);`，CMI:426-428 校验：供应商缺失 / 自引用 / 同步环都会被拒绝）。

`CMC` 中的解析器：`this.seed = new Map(Object.entries(options.staticModules))`（**CMC:548**）；`createClientModuleSystem(target, bootstrapModule, options)`（**CMC:850-864**）。

> **⚠️ 与官方 rules 冲突的点**：`SK/references/practices.md` 的 UI 章节明确写 “**Do not `require('@deepseek-ai/dsh-client-ui-primitives')`** or load any other Harness Client package as a module; `dsh.client.inject` entries only order activation and stay allowed…… Write your own controls and match the host instead”。而 **WREADME:167** 又说 “A Module Loader package (`factory(require)` …) gets `@deepseek-ai/dsh-client-ui-primitives` as an implicit baseline external: resolve `MenuItemButton` through the loader's `require`”。**两者矛盾**。稳妥做法：**自己用 `React.createElement` 实现 `role="menuitem"` 按钮 + 自建样式类**（只用 `--dsw-alias-*` 令牌），只在确定锁定 DSH 版本时才 `require` primitives。

### 8.3 宿主如何把 client.js 送进浏览器

全部在 **CMI**（`@deepseek-ai/dsh-client-modules` 宿主半边）：

- **判定客户端插件**：`package.json` 的 `dsh.client` 声明（`platform: "web"` + `./client` 导出子路径 + 可选 `immediately` / `external`），解析函数 `parseDshClient`（CMI:63-72，校验 `platform` 必须 string、`immediately` 必须 boolean）。
- **扫描与发布**：`scan` → `ClientModuleRegistry` → 对每个 `client.js` 做 artifact 快照（`mtimeMs`/`ctimeMs`/size 派生 revision，不 hash 内容，CMI 注释）。
- **路由前缀**：**CMI:200** `const PLUGIN_ROUTE = "/plugins";`
- **两种 URL**：
  - Combo（多个包合成一个响应）：`/plugins/??<id>/client.js,<id>/client.js&rev=<rev>`（CMI:203-215，`comboSearch` / `comboUrl` / `comboReference`）
  - 单包 chunk（按需）：`/plugins/<package>/client.<name>.js?rev=<rev>`（CMI:219-225 `chunkUrl`）
- **Content-Type**：`text/javascript; charset=utf-8`（CMI:661、673、953）；source map `application/json; charset=utf-8`
- **不打包、不转换**：直接拼接已发布的 `client.js` 文本（README:74 “creates combo descriptors **without building response bodies**”、“A script body is combined once on its first `GET`”）。**没有 esbuild/rollup 步骤**——编译必须由包作者自己完成。
- **注入 `<head>` 的顺序**（CMI:453-498 `bootInjections`）：① `window.__ModuleLoader__` 队列 facade（内联脚本）② 所有 application combo 的 `<link rel=preload>` ③ 阻塞式 bootstrap combo `<script src>` ④ `globalThis.__DSH_BOOT__ = graph`（CMI:492-496）。
- **`__ModuleLoader__` facade 源码**（CMI:454-475，逐字）：
  ```js
  (()=>{
  const pendingQueue=[]
  window.__ModuleLoader__={
    mode:"queue",
    pendingQueue,
    load(registration){pendingQueue.push(registration)},
    create(options){
      if(this.mode!=="queue")throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot")
      const index=pendingQueue.findIndex(r=>r.id==="@deepseek-ai/dsh-client-modules")
      const registration=pendingQueue[index]
      if(registration===undefined)throw new Error("client-modules: HTML did not preload .../client.js")
      pendingQueue.splice(index,1)
      const exports=registration.factory(specifier=>{ throw new Error('... requested external "'+specifier+'" before the module system existed') })
      if(typeof exports!=="object"||exports===null||typeof exports.createClientModuleSystem!=="function"||typeof exports.apply!=="function")
        throw new Error("client-modules: .../client.js did not export the bootstrap module face")
      return exports.createClientModuleSystem(this,{id:registration.id,exports},options)
    }
  }
  })()
  ```
  ⇒ **`load()` 只是入队**；真正的模块系统由 `@deepseek-ai/dsh-client-modules/client.js` 导出 `createClientModuleSystem` 构建，随后 shell 把它装成 Loader 的 `internal`，CMC 再 `ctx.reflect.provide("modules", modules)` 发布为 `ctx.modules`（CMC 末尾 `apply`）。
- **HMR**：`reload(id, rev)`（CMC:298），重复 revision 忽略（CMC:292）；替换 bootstrap 模块要求整页刷新（CMC:541 `"replacing bootstrap module ... requires a page reload"`）。**重复注册同一 id**：boot manifest 解析阶段直接抛 `duplicate graph entry "<id>"`（CMC:122）。
- **`dsh.client.inject` 的作用**：只影响**预取/加载批次顺序**（把 provider 排在 consumer 之前），**不参与 apply 时序**（W:4100-4107）。

### 8.4 第三方客户端插件骨架

```
my-plugin/
├── package.json
├── cordis.patch.yml
├── index.js          # 宿主半边（可以是空 apply）
└── client.js         # 浏览器半边（__ModuleLoader__ 形态）
```

`package.json`（照抄官方模板 + 加 external）：

```json
{
  "name": "@local/my-plugin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js", "./client": "./client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-workspace", "@deepseek-ai/dsh-client-locale"]
    }
  }
}
```
- `immediately: true`：立即加载（否则按需）。`dsh.client.external`：**只有**要 require 基线 9 个之外的东西才写。

`cordis.patch.yml`（官方模板逐字）：

```yaml
- insert:
    - id: my-plugin
      name: '@local/my-plugin'
```

`index.js`（宿主半边，官方模板逐字）：

```js
/** Host half of the decoration bundle; the Client module owns the rendering. */
export function apply() {}
```

`client.js`（浏览器半边，含会话行菜单项 —— **本报告核心交付骨架**）：

```js
window.__ModuleLoader__.load({
  id: '@local/my-plugin',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'local.myPlugin';

    const zh = { export: '导出 {title}' };
    const en = { export: 'Export {title}' };

    function ExportRow(props) {
      // 插件不引 primitives 时，自己渲染等价的 menuitem 按钮
      const [, setMenuOpen] = props.useMenuOpenState();
      return h('button', {
        type: 'button', role: 'menuitem',
        className: 'myPlugin_menuItem',
        onClick: () => { setMenuOpen(false); props.exportSession(props.sessionId); },
      }, props.t('export', { title: props.displayTitle }));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'my-plugin: dictionaries');
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'local.export-session',
          order: 500,                       // 排在内置 archive(400) 之后
          locale: NS,
          inject: () => ({ exportSession: (id) => { /* ... */ } }),
        }, ExportRow));
      },
    };
  },
});
```

> 注意 `useMenuOpenState` 是**组件 prop**，它是 hook，必须在组件函数体顶层调用；示例里 `props.useMenuOpenState()` 写在组件体内，符合规则。

---

## 9. 踩坑清单

1. **`dsh.client.inject` 与客户端模块的 `export const inject` 是两套东西**：前者是**包名**（只管加载顺序/预取），后者是**Cordis 服务名**（决定 apply 依赖）。写成同一套会静默失效。
2. **不要假设插槽已声明**。必须用 `ctx.slots.inject(slotName, cb)`；直接 `ctx.slots.register` 会在宿主 apply 顺序变化时抛错/失效（W:4100-4107）。
3. **菜单不会自动关闭**，每个 entry 自己调 `useMenuOpenState()[1](false)`。
4. **`useXxx` hook 命名是隐式的**：注册 `inject.hooks.menuOpenState` → 组件收到 `useMenuOpenState`。写成 `menuOpenState` 会拿到 `undefined` → 调用即崩。
5. **`sidebar.session.row.leading` 在非 idle 时不渲染**（W:1623 三元分支），想在 running/done 时加自定义点**此路不通**。
6. **unread 绿点不持久化**（S:141 内存 Set），刷新即丢；没有任何 localStorage 键可复用/覆盖。
7. **会话行没有 `error` 状态**。`StateDot` 的红色 `error` 只在 plugin-manager / chat 用。
8. **`primitives` 能不能 require 存在官方文档冲突**（practices.md 禁止 vs ui-workspace README 允许为隐式 baseline external）。`PLATFORM_MODULES` 基线表（WF:126）里确实有它，但升级风险自担。
9. **CSS module 类名是构建期哈希**（`jJkEga_*`，W:1070 起），任何 CSS 覆盖都会在升级后失效。唯一稳定的 DOM 钩子是 **`data-row-key="session:<id>"`**（W:1592），但 practices.md 禁止 DOM hack。
10. **`client.js` 不经过任何构建**，宿主只做文本拼接（README:74）。必须自己产出 `__ModuleLoader__.load(...)` 形态；纯 ESM（`import`/`export`）**不会**被解析。
11. **`id` 必须等于包名**，且同一 id 重复注册会在 manifest 解析阶段直接抛错（CMC:122）。
12. **`dsh.client.external` 校验很严**：供应商缺失、自引用、同步环都会被 composition 拒绝（CMI:426-428）。
13. 第三方插件 3P 的 client.js **把 React 自己也打进了 bundle**（同时 `require("react")` 存到 `globalThis.__dshArchiveReact`）—— 这是**反面教材**，会导致两份 React。
14. 3P 为了兼容不同版本的 sidebar，写了 `hostSidebarDeclaresSessionMenu()` 探测：`ctx.slots.entries("sidebar.workspaces").some(e => e.children?.[Fr] !== undefined)`，并在 `To()` 为旧版时整棵 `sidebar.workspaces` 用 `priority: -0.5` 自己注册一遍（3P client.js）。**这是升级防御的范例，也说明插槽结构并非永久稳定。**
15. `cordis_inspect_query` 的 client provider（`Slots.listSubTree` / `Theme.listTokens`）需要**有页面连着**才能回答；本次调研期间超时（`Client inspect query Slots.listSubTree timed out after 10000ms`），所以全部契约来自源码而非运行时 introspection。日后写代码时应先用它确认。

---

## 10. 未确认 / 待办

- **未拿到运行时插槽契约**（`Slots.listSubTree` 超时）。源码证据已充分，但建议在有人打开 Web UI 时补一次 `cordis_inspect_query({platform:"client", provider:"Slots", method:"listSubTree", input:{root:"sidebar.workspaces.session.menu.item"}})` 交叉验证 props 列表。
- **未找到宿主自动加载第三方包 `locale/*.json` 的代码**。倾向结论：不存在该机制，文案应内联进 client.js。
- **未确认 `Menu` 组件的完整关闭行为**（Escape / 外点关闭）—— 它来自 primitives 的 `Menu`，本次只确认了 `portal` / `closeOnPointerLeave` / anchor。
- **未确认 `sidebar.session.row.leading` 的 `slot` 类是否有固定宽度**（`Rows_module_css_default.slot`，实际样式在构建后的 CSS 中，asar 内 `dsh-client-ui-workspace/lib` 只有 `client.js` 与 `index.js`，样式被内联进 client.js 的 `styles.insert(...)` 调用，未逐条展开）。
- **"报错红色点"的最终方案**需要产品决策（见 5.3）。
