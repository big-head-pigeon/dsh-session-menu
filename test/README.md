# 离线验证（不需要重启应用）

宿主半边只有应用启动时才会被加载，客户端嵌入的 bundle 也只能在浏览器里被物化 —— 所以这四份测试用替身与真包把两边都真跑一遍，
把「改完重启才发现写错」的风险提前拦掉。**它们不能替代 GUI 目视验收**，只保证逻辑与契约层面没有明显错误。

```bash
cd 01_Projects/dsh-session-menu

# 宿主半边：投影折叠 + 永久删除 / 批量删除 + 打开方式的路径边界与应用清单（31 项）
node --import ./test/register.mjs test/host.test.mjs

# 客户端半边：bundle 加载 + 插槽注册表 + 二级菜单/悬浮卡/批量入口/失败提示 + 设置面板开关 + 复制去重（64 项）
node test/client.test.mjs

# 真协议：用真 cordis + 真 @deepseek-ai/dsh-typert-protocol 启动宿主半并验证 config 透传（7 项，缺包时自动跳过）
python3 test/extract-asar-pkgs.py            # 只需在 /tmp 被清理、或内核更新后重建
node test/real-protocol.test.mjs             # 快照内核与当前内核不一致时直接失败，不会拿旧包跑出绿的

# 内核兼容：清单里的 dsh 要求 + 我们依赖的插槽/原语，对着本机每个 DSH 内核逐条核（65 项，改 peerDependencies 或升级 DSH 后必跑）
node test/compat.test.mjs
```

| 文件 | 作用 |
| --- | --- |
| `host.test.mjs` | 直接 import `../index.js`（真实文件，非副本），用替身 ctx 驱动投影与 `deleteSession` |
| `stub-typert-protocol.mjs` | `@deepseek-ai/dsh-typert-protocol` 的替身（只补 `TypertRemoteService` 的绑定语义） |
| `loader.mjs` + `register.mjs` | 解析钩子：让 `index.js` 里那句 peer import 指向替身，其余走 Node 原生解析 |
| `client.test.mjs` | 打桩 `window.__ModuleLoader__` / `require` / `document`，加载真实 `../client.js` 并渲染每个座位 |
| `extract-asar-pkgs.py` | 从 `app.asar` 解出真包到 `/tmp/dsm-real/node_modules`，并从 profile 软链它们自己的依赖；同时写出内核版本戳 `kernel.json` |
| `real-protocol.test.mjs` | 把 `index.js` 复制到临时目录后用**真 cordis + 真协议**启动，验证手写的 Remote 标记真被认成端点 |
| `kernel.mjs` | 找本机的 DSH 内核、从 `app.asar` 读内核版本、在 asar 里扫字符串（compat 与真协议共用） |
| `compat.test.mjs` | 把 `package.json` 里的内核要求喂给本机每个内核版本（含未来的 patch/minor/major），并确认 `client.js` 用到的每个插槽名与 primitives 导出在新内核里还在 |

## 内核兼容自检为什么值得单开一套

内核激活插件时会用 `semver.satisfies(内核版本, range, { includePrerelease: true })` 逐条核对 `engines.dsh` 或
`@deepseek-ai/dsh*` 的 peer，任何一条不满足就往 profile 写 `disabled: true` —— 插件直接消失，且只有重启才看得到。
0.1.0 的精确值 `0.2.0-rc.2` 就是这么在内核升到 `0.2.1-rc.2` 时被禁用的。

还有**第二个匹配器**：npm 装包时用默认规则（不带 `includePrerelease`），预发布版本只有范围里出现**同一个 x.y.z** 的比较符时才认。
只写 `>=0.2.0-rc.2` 时，对着已经装好的 `0.2.1-rc.2` 会直接 `npm error code ERESOLVE`（已实测复现，退出码 1）。
所以 `package.json` 里把每个预发布分支各开一段，两条检查都跑：内核那条保「不被禁用」，npm 那条保「装得上」。

`compat.test.mjs` 因此同时管两头：**当前装着的内核**（本机有官方版和社区版两个，版本还不一样）必须都被接受，
**下一个 patch / minor / major** 也必须被接受 —— 后者才是「下次内核更新会不会又炸」的答案。
内核版本不是从 `Info.plist` 的 `CFBundleShortVersionString` 读的（社区版那是 `0.12.0`，跟内核版本无关），
而是按内核自己的做法从 `app.asar` 里的启动包 `package.json` 读 `version`。
想拿别的内核版本试：`DSH_VERSION=0.3.0 node test/compat.test.mjs`（`0.3.1-rc.1` 这种新分支的预发布版本会故意跑红，提醒去补一段范围）。

## 内核更新后插件报错的三条路径

版本范围只挡得住第一条，三条都各有测试兜住：

| 路径 | 表现 | 谁挡 |
| --- | --- | --- |
| 清单范围匹配不上新内核 | 插件被写 `disabled: true`，界面显示「异常」，重启才发现 | `compat.test.mjs` 的版本检查 |
| 我们依赖的客户端符号被改名/删掉 | 菜单少一块，或渲染时抛错 | `compat.test.mjs` 从 `client.js` 里现取插槽名与 `primitives.*`，逐个回内核里找 |
| 协议包被改名或改形状 | 宿主半加载失败 | `real-protocol.test.mjs`（版本戳保证它跑的不是旧快照） |

插槽名与 primitives 名字是**用正则从 `client.js` 现取的**，不是写死的清单：改代码时自检跟着变，不用同步。
官方版内核根本不发货 `@deepseek-ai/dsh-client-ui-primitives` 这个包（seed 表由客户端 bundle 解析），
所以原语是在 `@deepseek-ai/dsh-client-ui-*` 这一层里找的 —— 它证明的是「内核的客户端 UI 层还有人用这个名字」，
不是「导出列表签名没变」，够挡住改名和删除，挡不住语义变化。

## 真协议验证为什么值得单开一套

手写 Remote 标记（`Object.defineProperty(prototype, "@deepseek-ai/dsh-typert-protocol/remote-methods", …)`）绕开了装饰器语法，
替身测试只能证明「按我读到的规则写是对的」。这一套把真包解出来实跑，证明的是：真 cordis 能启动这个服务、
`typertRemote` 绑定满足网关 `readBinding` 的四条判据、`remoteMethods()` 真能读出手写的标记 —— 也就是重启后
`ctx.get("remote.sessionMenu").deleteSession(id)` 这条路真的能通。真包目录不存在时它打印一行跳过并返回 0，不影响 CI/日常。

## 覆盖到的行为

**宿主半边**：投影 `turn/start` 重置与 `turn/end` 对 completed / error / aborted 的折叠、schema 只接受合法形状、**四个 Remote 方法**的标记与 `typertRemote` 绑定、形参名与客户端 wire 名一致、空 id 拒绝、未知会话幂等、冷会话删目录且不动兄弟目录、运行中先 `cancel` 再摘除、摘除失败只警告、`locate` 抛错退化为扫描、**目录名与会话 id 不一致时拒绝删除**、`emit` 抛错不影响结果、**打开方式的路径校验**（路径不存在 / 不是目录 / 空串一律拒绝、有 `fs` 服务时要求往返一致、应用名为空拒绝 —— 这一节不会真的起 `open`）、**应用清单的默认值与配置覆盖**（默认含 Claude / ChatGPT 且排在 IDE 之后终端之前；配置能整体替换；写坏时退回默认；形状错的条目丢掉、合法的留下）。

**客户端半边**：bundle 只注册一次且 id 与包名一致、`require` 只请求冻结基线里的两个模块、`inject` 列表、12 个座位注册（插槽 / id / order 全表比对）、中英文案键对齐、样式与订阅 effect、五个菜单项都能渲染、**两个二级菜单**（触发行带 `aria-haspopup`、面板里列出应用与复制项、点面板项调 `writeClipboard` / `openWorkspacePath` / `openWorkspaceWith` 且点完关菜单）、未读标记与行首蓝点、**悬浮卡三行**（工作目录 / 上次报错 / 已标记未读，皆空时返回 `null`）、报错投影亮红点、归档行垃圾桶按钮阻止冒泡、弹窗渲染（无勾选框）、点确认后调用 `sessionMenu.deleteSession` 并关弹窗清未读、删主视图会话时把主视图归位（删非主视图时不调）、**打开方式的来源合并**（顺序为默认应用 → 宿主探测的开发者清单 → 系统列表里名字像开发工具的补充项；同路径去重 —— Claude / ChatGPT 在两张表里都有，各只留一项；Shadowrocket / 归档实用工具 / 图书 这类噪声一个都不进菜单，从默认清单删掉的 TRAE CN 与 WorkBuddy 也不会从系统列表那条补充通道溜回来；终端这类未注册应用走自建 `openWorkspaceWith`、已注册的走官方 `openWorkspacePath`；**应用名走字典而不是宿主报的中文名** —— 夹具里终端的 `name` 故意写成「终端」，断言证明菜单里不会出现它）、**打开失败必上报**（宿主内层 `ok:false` / 协议层外层 `ok:false` / 官方入口失败三种形状都弹出带原因的 `Toast`，宿主给错误码时翻成当前语言、没码才原样显示原文，成功后不留提示，`onDone` 后自己清掉）、**删除失败不静默**（宿主内层 `ok:false` 时留在弹窗里报错而不是当成功关掉；批量部分失败时显示「已删除 x 个，y 个失败」）、**批量入口**（标题行注入按钮：归档视图里出现并带数量提示、还有未归档的行或归档集为空时隐身、锚点消失时摘掉节点、卸载时移除并断开 observer、点击调 `deleteSessions`；归档行菜单项只在归档行出现、批量弹窗标题/正文带数量）。

二级菜单与悬浮卡的测试细节：替身 React 不提交 DOM，所以渲染之后会手工把元素树上的 `ref.current` 填成假节点（`getBoundingClientRect` 返回固定矩形），等价于真实 React 的提交阶段；`openSubmenu()` 先渲染外层菜单项组件、再 `renderComponent(outer.type, outer.props)` 往下渲染一层 —— 因为替身不会递归渲染子组件；点二级项则直接调用面板项 `MenuItemButton` 替身收到的 `onSelect`。

## 两个坑（写测试时踩到，改代码时别再踩）

1. 打桩的 `useEffect` **不能立刻执行清理函数** —— 组件里的 `alive` 标志会被置假，异步取回的应用列表被丢弃，测试会误报「列表为空」。
2. 嵌套组件（弹窗里的确认表单）必须走同一套 hooks 运行时（`renderComponent(host.type, host.props)`），否则 `useState` 拿不到当前组件，直接抛 `Invalid value used as weak map key`。
