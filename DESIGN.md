# DSH 会话菜单增强插件 · 方案

> 目标：把 Claude Code / Codex 会话右键菜单里 DSH 缺失的能力补进 DSH 侧边栏，并补上「会话行首状态点」里缺的**报错红点**与**手动未读**。
> 状态：**P1 + P2 + P3 代码全部落盘**（菜单项、行首状态点、归档行一键删除、永久删除弹窗），已装进 desktop profile（`dsh-session-menu`，link 到本目录）；宿主半与 `package.json` 的改动**需要重启 DSH 应用**才加载，重启后待 GUI 目视验收。
> 调研证据见 `research/R1-client-slots.md`、`research/R2-host-api.md`。

---

## 1. 三边菜单对照（Claude Code / Codex → DSH 现状）

| Claude Code | Codex（中文） | DSH 现状 | 本插件 |
|---|---|---|---|
| Pin `P` | 置顶 | ✅ 置顶会话 | — |
| Mark as read `U` | 标记为未读 | ❌ 无（未读是"看过即清"的内存态） | ✅ **标记为未读 / 标记为已读** |
| Rename `R` | 重命名 | ✅ 重命名 `⌘G` | — |
| Fork `F` | 分叉 | ✅ 分叉会话 `⌘F` | — |
| Move to group | 项目 / 分区 | ✅ 工作区目录即分组 | — |
| Archive `A` | 归档 | ✅ 归档会话 `⇧⌘A` | — |
| **Delete `D`（红）** | **永久删除** | ❌ **完全没有删除会话** | ✅ **永久删除会话…（红）** |
| Open in | 在新窗口中打开 / 打开方式 | ❌ 无 | ✅ **复制会话 ID / 复制工作目录**（等价的信息获取；不做"在访达打开"，需宿主 shell 权限，v2 再议） |
| — | 分享 / 复制 | ❌ 无 | ✅ 复制两项（上格） |
| — | 分区（自定义分组） | ❌ DSH 无此概念 | ⛔ 不做（需改内置分组模型，属上游需求） |

**结论：DSH 真正缺的是「标记为未读」和「删除会话」，其余是等价能力不同名。**

---

## 2. 会话行首状态点对照

| 语义 | Claude Code | DSH 现状 | 本插件 |
|---|---|---|---|
| 运行中 | 转圈 | ✅ 转圈（`ongoing`） | — |
| 待回复/待选择（待审批、待审计划、待回答） | 橙点 | ✅ 橙点 `warning` | — |
| 完成未查看 | 绿点 | ✅ 绿点 `done` | — |
| **报错** | 红点/警告三角 | ❌ **没有 error 状态** | ✅ **红点（空闲时显示于行首）+ 悬浮卡常显** |
| **手动未读** | — | ❌ 无 | ✅ **品牌蓝点** |

DSH 的颜色源自 `--dsw-alias-state-*`：绿 `success-primary`、橙 `warn-primary`、红 `error-primary`、灰 `idle-primary`；本插件新增的"未读"用 **`--dsw-alias-state-business-primary`（DeepSeek 品牌蓝）**，与四态互相区分。

---

## 3. 硬限制（必须写进 README，避免"看起来没生效"的误会）

1. **行首座位只在"空闲"时可插入。**
   `ui-workspace` 的行渲染是三元表达式：`showStatus ? <SessionStatusDots/> : renderSlot("sidebar.session.row.leading")`，
   其中 `showStatus = 主状态 !== "idle"`。⇒ 行上已有转圈/橙点/绿点时，第三方**无法**在那格渲染任何东西。
   本插件的红点/蓝点因此设计为：**会话空闲时显示在行首**；运行中或"完成未查看"时，改在**悬浮卡**里显示，并在 README 说明。
2. **报错红点的语义是"最近一回合失败且当前空闲"。** 正在运行的会话还没结束，不存在"已失败"状态。
   用户查看过报错会话后（官方绿点清除、行回到空闲），红点会出现在行首，起到"这行上次失败了"的提醒作用。
3. **"删除会话"没有官方 API。** 宿主只有归档；永久删除必须由插件自建（照 `@michengai/dsh-archive-manager` 的九步流程）。
   日志是物理删除，**不可恢复**，因此必须强确认。风险：无版本兼容承诺，DSH 升级后需回归验证。
4. **"未读"没有宿主概念。** 官方 `completionUnread` 只是 `ui-session` 进程内内存 `Set`，刷新即丢。
   本插件的未读标记持久化在**客户端本地存储**，因此：只对本机本浏览器有效，不跨设备、不跨窗口同步（v2 可改为宿主存储域 + 投影键）。
5. **「工作区」标题行没有插槽。** `ui-workspace` 只向 `sidebar.workspaces` 声明了 5 个子座位
   （`directoryFlow` / `session.menu.item` / `session.row.action` / `session.row.leading` / `session.row.hover`），
   标题行里的搜索 / 筛选 / 新建工作区三个按钮是组件内硬编码的（`ViewOptionsMenu` 的 `items` 数组写死，`selectedIds` 只读），
   归档筛选状态 `archivedFilter` 又关在私有 `viewStore` 里（`dsh-client-ui-workspace/lib/client.js` 的 view store，`:665` 定义 / `:704` setter），
   既没有服务也没有 props 暴露给插件（`headerActions` 还带 `max-width:60px; overflow:hidden`，第四个按钮塞不进去）。
    ⇒ 批量删除按钮改为**注入标题行的原生节点**：`document.querySelector('[class*="sectionHeader"]')` → `appendChild`
   （唯一依赖 CSS 模块本地名 `sectionHeader`，哈希前缀随版本变），并用 MutationObserver 保活、窄栏/无锚点时隐身；
   回退入口是归档行的菜单项。另：`sidebar.panellist`（侧边栏面板位）需要同时提供一个主区面板，属另一个量级。
6. 无 `move to group` / `share` / 在访达中打开（需宿主新增能力或 shell 权限）。

---

## 4. 插件设计

**包名**：`dsh-session-menu`（本地私有包，`private: true`）
**形态**：宿主半 + 客户端半，官方 `cordis-plugin-development` skill + `templates/decoration` 四件套为骨架。

```
01_Projects/dsh-session-menu/          # 包根目录 = 可直接 install_bundle 的路径
├── package.json           # dsh.bundle.patch + dsh.client{platform:web, immediately:true}
├── cordis.patch.yml       # insert: [{id: dsh-session-menu, name: 'dsh-session-menu'}]
├── index.js               # 宿主半（ESM）：P1 为空；P2/P3 放投影注册 + 删除服务 + typert FACE
├── client.js              # 客户端半：window.__ModuleLoader__.load({id, factory})
├── README.md              # 安装、能力、限制
└── research/              # 调研报告（不随包发布）
```

客户端半只 `require` 两个包，都在平台 seed 表里（**无需**在 `dsh.client.inject` 里声明依赖）：
`react`、`@deepseek-ai/dsh-client-ui-primitives`。seed 表的完整内容为
`react / react/jsx-runtime / react-dom / react-dom/client / @deepseek-ai/cordis /
@deepseek-ai/dsh-client-store / @deepseek-ai/dsh-client-ui-slots /
@deepseek-ai/dsh-client-ui-primitives / @deepseek-ai/dsh-client-ui-dockkit`。

### 4.1 客户端半（`client.js`）

| 扩展点 | 内容 |
|---|---|
| `sidebar.workspaces.session.menu.item` | **已实现**：标记为未读 / 标记为已读（order 150）、复制（order 500，自绘二级菜单）、在访达中显示（520）、打开方式（530，自绘二级菜单，来源见 §4.2）、永久删除会话（order 600，`danger` + `separatorBefore`） |
「复制」那一组的重复处理：内核自己也会往这个插槽里注册一行 `id: "session-id"`、`order: 450` 的「复制 Session ID」
（`dsh-client-ui-workspace/lib/client.js`），内核文档也写明这一行的 `id` 是稳定的公开约定（“Use a package-namespaced `id`”）。
所以插件的做法是**问注册表**而不是查版本表：`ctx.slots.entriesOfSlot("sidebar.workspaces.session.menu.item")` 里出现
`session-id` 时，我们那条同名子项默认关掉（用户从没动过 → 读作「默认」，不写盘），二级菜单只剩一条时**拍平成普通行**
（少一次点击）。探测失败一律按「没有原生行」处理：宁可重复一条，也不能把功能弄丢。
| `sidebar.workspaces.session.row.action` | **已实现**：归档行的一键删除按钮（order 300，仅 `archivedSessionIds` 命中时渲染） |
| `sidebar.session.row.leading` | **已实现**：报错红点优先，其次未读蓝点 |
| `sidebar.session.row.hover` | **已实现**：悬浮卡补三行——工作目录 / 上次运行出错 / 已标记为未读（order 20，三行皆空时不渲染） |
| `shell.overlay` | **已实现**：删除二次确认弹窗（order 60，单删/批量共用） |
| （无插槽）工作区标题行 | **已实现（DOM 注入）**：「删除所有已归档会话（N 个）」红色垃圾桶挂在 `div.sectionHeader` 末尾；仅当可见会话行全是归档行时显示，找不到锚点或行宽 < 150px 时隐身；`ctx.effect` 卸载时移除节点并断开 observer |

依赖：`require("react")`、`require("@deepseek-ai/dsh-client-ui-primitives")`（`MenuItemButton`、`StateDot`、图标、`Modal`/`Button`），其余能力走 Cordis 服务（`slots`、`locale`、`remote`、`sessions`）。

### 4.2 宿主半（`index.js`）

| 能力 | 做法 |
|---|---|
| 报错状态 | 注册 **session projection** `sessionMenuStatus`：`turn/start` 重置为 `idle`，`turn/end` 记录 `data.reason.kind` 与 `reason.error.message`。投影值经 `summary.projections.values.sessionMenuStatus` 下发客户端（`row.projectionValues.sessionMenuStatus`） |
| 永久删除 | 自建服务 `sessionMenu`（`TypertRemoteService` + 原型上的 `remote-methods` 标记，走 gateway 的 **SRC 回退**，不注册 typert FACE）。客户端 `ctx.get("remote.sessionMenu").deleteSession(id)` 调用。实现顺序：活会话先 `sessionController.cancel({sessionId})` 并轮询 `agents.get(id).status` → `sessions.liveEntryFor` + `detachEntered`（触发 `session/disposed` → `api-session/removed`）→ `sessionPersistence.locate({id,cwd})` 定位后 `rm -rf` 会话目录 → `workspaceRegistry.unarchiveSession/unpinSession` 清账本 → `ctx.emit("api-session/removed", id)` |
| 批量删除 | 同一服务的 `deleteSessions(sessionIds)`：逐个调用单删流程，单个失败不打断，最后返回 `{ok, deleted, failed, error}`；上限 `BATCH_LIMIT = 500` 个/次（只防意外传入超长列表，不限制正常使用）。客户端两个入口（标题行注入按钮 / 归档行菜单项）都调它 |
| 打开方式（清单） | `workspaceApplications()`：按 `DEFAULT_DEVELOPER_APPS` 里的已知安装位置探测 `/Applications` 与 `~/Applications`（顺序 = 菜单顺序：IDE / 编辑器 → AI 助手 → 终端），命中后用**一次** JXA（`osascript -l JavaScript`）批量问显示名与 32×32 图标 data URL，结果缓存 `APPLICATION_CACHE_MS = 10min`。**清单可用插件配置整体覆盖**：`config.applications = [{ kind, paths: [...] }]`，`normalizeApplications()` 逐条校验，整段不可用时退回默认值。为什么不用官方 `workspacePathApplications`：它只列 Launch Services 注册为「可打开文件夹」的应用，终端与 Xcode 根本不在里面；而 Claude / ChatGPT 正好相反，它们注册了但会被客户端的「名字像开发工具」正则挡掉，所以显式放进清单 |
| 删除的契约 | `deleteSession(id)` = 删这个会话**连同它的全部子智能体会话**（递归，靠 `header.parentSession` 找；子会话在磁盘上与父会话同级，`rm` 父目录碰不到它们）。**磁盘删成功之后**才 `forget()` 账本 + 发 `api-session/removed`；删不掉（路径对不上 / `rm` 失败 / 删完又被写侧 `mkdir` 回来）一律返回 `{ ok:false, code }` 且不动账本 —— 客户端的行不会消失，用户可以重试。`rm` 之后复查 3 次共 450ms：jsonl 持久化的写句柄在 agent teardown 前一直持有，未落盘的活跃会话可能被写回来 |
| 平台边界 | 本插件的「打开方式」额外清单与应用图标**只在 macOS 成立**（依赖 `/usr/bin/osascript` 与 `/usr/bin/open`）。Windows / Linux 上：系统默认应用与系统已注册的开发工具仍会列出并可用（走官方跨平台 Remote），只是没有那份额外清单与图标。DSH 自身是跨平台的（macOS LaunchServices / Windows Shell 关联 / Linux GIO） |
| 「在访达中显示」的文案 | 客户端 `REVEAL_LABEL_KEYS` 按**宿主平台**取键：`darwin` → 访达 / `win32` → 文件资源管理器 / 其余 → 文件管理器。平台来自新增的 Remote `hostPlatform()`（宿主返回 `process.platform`）。**为什么不能用 `navigator.platform`**：打开动作在宿主那台机器上执行，Web UI 远程访问时浏览器和宿主可能不是同一个系统 |
| 打开方式（应用名） | 客户端 `appName()`：`.app` 文件名去后缀、转小写查 `APP_NAME_KEYS`（目前只有 `finder` / `terminal` 真的中英不同），命中就走 locale 字典；其余用 **`.app` 文件名**（应用自称的名字）；只有拿不到路径的条目才退回宿主给的 `name`。**为什么不能直接用宿主那句**：它是 macOS `displayNameAtPath()` 的结果，跟随**系统语言**而不是 DSH 界面语言 —— 界面切英文了它还是「访达 / 终端」。官方 `dsh-client-ui-open-in-app` 同样是字典方案（`APP_LABEL_KEY`） |
| 打开方式（执行） | `openWorkspaceWith(path, application)`：先走与官方同一套路径校验（`fs.processPathFromHostPath` → `resolve` → 往返一致），再 `/usr/bin/open -a <应用> <目录>`。**故意不校验注册表** —— 官方 `openWorkspacePath` 会拒绝未注册的终端 / Xcode；路径不过关或应用名为空时返回 `{ok:false, opened:false, error}`，客户端弹出带原因的提示 |
| 未读 | 不做宿主侧（见限制 4） |

### 4.2.1 客户端读 Remote 结果的正确姿势（踩过的坑）

客户端的 Remote 层（`@deepseek-ai/dsh-api-remotes` 的 `invoke()`）把每次调用折成一个**包装结果**，宿主抛的 `RemoteError` **不会往外抛**：

```js
// 成功：宿主的返回值在 value 里
return { ok: true, value: descriptor.result.decode(...) };
// 失败（含宿主抛 RemoteError、连接没了、方法被卸载）
return { ok: false, error: rebuiltFailure(result.error) };
```

插件自己的宿主方法**还会在 `value` 里再放一层** `{ ok, opened/removed/deleted, error }` 表示业务结果，于是有四种组合。
只判断外层 `ok` 会把「删除失败」「打开失败」当成成功 —— 这正是 2026-10-16 修掉的两个静默 bug
（删除弹窗会把失败当成功关掉；打开方式是整个失败都被吞掉）。现在统一走 `client.js` 的
`callHost()` / `readRemoteResult()` / `businessFailure()` 三个小函数：外层看 `ok`，内层看 `value.ok`，两层都过才算办成。

### 4.3 未读状态

- 存储：客户端本地存储，键 `dsh.session-menu.unread.v1`（`ui-schedule` 的 `dsh.schedule.task-tab.v1.<id>` 为同类先例），写入 `localStorage`，读失败静默降级为纯内存。
- 写入：菜单「标记为未读」加入；「标记为已读」移除。
- 自动清除：会话被打开成为主视图时自动移除（订阅客户端 `sessions` 控制器的列表快照，取 `retainedBy.mainView > 0` 的那一行；订阅不可用则退化为纯手动切换）。
- **「正在查看」守卫**：在当前会话上点「标记为未读」时，自动清除会立刻把它抹掉（看上去没反应）。
  因此标记时若该会话正是主视图，先记下守卫，等主视图切走再切回来才允许自动清除。

### 4.4 运行期契约核验（用 Inspect 读实时宿主，非静态源码）

P2/P3 要用的三份契约已按**运行中的宿主**核对过一遍（`cordis_inspect_query` → host/Service），实现时直接照签名写：

| 服务 | 实测签名 | 用途 |
|---|---|---|
| `sessionProjections` | `register(definition): () => void`，`definition = {key, stateSchema, init(header, inheritedEventCount), apply(state, event), stateVersion, wire: {viewSchema, view}}` | P2 报错投影。**带 `wire` 才会进客户端快照**（`wire` 可选是类型层面的区分）；注册是**调用 fiber 上的 effect**，插件卸载即摘除该键 |
| `sessionProjections` | `stateOf(session, key)`、`snapshot(session, keys?)`、`onChanged(listener)` | 宿主侧自测投影是否按预期折叠 |
| `workspaceRegistry` | `archiveSession(sessionId, options?)`、`unarchiveSession`、`pinSession`、`unpinSession`、`get/list/create/delete/resolveByPath` | 归档/置顶官方 API；**列表里没有 `deleteSession`**（再次确认删除无官方 API） |
| `storageDomain` | `open(spec)`、`get(name)`、`closeAll()` | 若要给未读/墓碑换宿主存储（v2） |
| `typert` | `register(contribution)`、`getPackage(pkg, face)`、`listPackages(filter)` | P3 的 remote FACE 注册与自检 |
| `clientModules` | `graph()`、`clientPath(id)`、`fetchBundle(request)`、`artifactBaseline(id)`、`rebuilt(id)`、`onRebuilt(listener)` | 排查「插件装了但客户端没加载」时，用它看 bundle 是否进了 web 插件表 |

`turn/end` 的 `reason` 在实时契约里是 7 个分支的联合（比只看 emit 点更全）：
`completed` / `aborted{reason: AgentCancelCause}` / `blocked` / `error{error: LlmFailure}` / `max-tokens` / `interrupted` / `forked`，
其中 `LlmFailure = {message, code, status?, providerRetryAfterMs?, requestId?, offloadImages?}`。
⇒ P2 的判定：`reason.kind === "error"` 取红点；`aborted`/`interrupted`/`forked` **不算错**（用户主动打断或分叉不是失败），`blocked`/`max-tokens` 归为「未完成但非报错」，可只进悬浮卡。

---

## 5. 分期与验收

| 阶段 | 内容 | 验收 | 状态 |
|---|---|---|---|
| P1 | 骨架插件 + 菜单项（未读切换、复制 ID）+ 未读蓝点 | `plugin_manager install_bundle` 成功；GUI 里出现 2 个菜单项；点「标记为未读」后行首出现蓝点；刷新后仍在 | ✅ 已装进 desktop profile，**待目视验收** |
| P2 | 宿主投影 + 报错红点（悬浮卡未做） | 制造一次失败回合（如断网/坏模型），会话空闲后行首出现红点 | ✅ 代码落盘；冷会话需重新落盘投影缓存，**待重启后验收** |
| P3 | 永久删除会话（菜单项 + 归档行一键删除按钮） | 菜单最后一项红色；弹窗确认后会话消失、日志目录被清、列表不再出现；归档的会话也能删 | ✅ 代码落盘；**待重启后验收**（宿主半需要重启才加载） |
| P1.5 | 三个新项的快捷键 | 菜单右侧出现快捷键提示，按下生效 | ⏳ 未开工（可选） |

每阶段用 `dsh-client-modules` 的 HMR 就地重载验证（改 `client.js` 后刷新页面即生效）；改 `index.js`（宿主半）或 `package.json` 后需要**重启 DSH 应用**。

---

## 6. 证据索引

| 事实 | 证据 |
|---|---|
| 四个插槽声明与内置 order（100/200/300/400） | `@deepseek-ai/dsh-client-ui-workspace/lib/client.js:4299-4330`、`:4331-4360` |
| 行首座位渲染分支（非 idle 不渲染） | 同文件 `:1621-1624`，`showStatus` 定义 `:1577` |
| 状态机无 error 分支 | 同文件 `:1386-1435` |
| `StateDot` 支持 error | `@deepseek-ai/dsh-client-ui-primitives/lib/index.js:3040-3095` + `StateDot.module.css` |
| `MenuItemButton`（danger/separatorBefore） | 同文件 `:3830-3863` |
| 未读是内存 Set、刷新即丢 | `@deepseek-ai/dsh-client-ui-session/lib/client.js:141`、`:314-341` |
| 宿主无删除 API | `R2-host-api.md`（三处反证）；archive-manager 自造 | 
| 删除九步实现 | `@michengai/dsh-archive-manager/lib/workspace.js:915-961` |
| `turn/end` 的 `reason.kind==="error"` | `@deepseek-ai/dsh-agent-loop/lib/index.js:1018-1029` |
| typert FACE 描述符形状 | `@michengai/dsh-archive-manager/lib/workspace.js:188-208` |
| 客户端 bundle 形态与 9 个可 require 基线 | `@deepseek-ai/dsh-client-modules/lib/client.js:122`、`dsh-web-frontend/dist/assets/index-5SrrfWpU.js:126` |
| 手写 Remote 标记真被协议接受（非替身推断） | `test/real-protocol.test.mjs`（真 cordis 4.0.4 + 真 `dsh-typert-protocol` 0.2.0-rc.2 实跑，见 `test/README.md`） |
