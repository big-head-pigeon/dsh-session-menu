# R3 · DSH 第三方插件：打包 / 构建 / 本地安装 调研报告

调研对象：DSH `0.2.0-rc.2`（Desktop 壳，GUI 跑在 `http://127.0.0.1:19387`）
环境：`DSH_HOME=$HOME/.dsh`，profile=`desktop`（`$HOME/.dsh/profiles/desktop`）
调研方式：只读。反编译 asar 内源码 + 阅读已装第三方插件的真实 `package.json` / 构建配置 + 在 `/tmp` 沙箱里对 pnpm 行为做实测。
**未安装、未修改任何 profile 文件。**

---

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 最省事的迭代路径 | 插件源码放工作区，`lib/` 产物在项目内构建，用 **`link:`** 装进 profile |
| 为什么不是 `file:` | `file:` 会被 pnpm **硬链接复制**进 `node_modules`，源码改动后必须重跑 `pnpm install` 才同步；`link:` 是**软链**，改完直接生效 |
| 宿主半改动生效 | 默认 `hmr.config.root = []` → **不监听源码**，需要重启；profile patch 里加一行 `- id: hmr / config: {root: [...]}` 可开启热重载 |
| 客户端半改动生效 | `@deepseek-ai/dsh-client-hmr` **每 500ms stat-poll** 客户端 bundle，改完 `lib/client.js` **浏览器自动热替换，不用重启不用刷新** |
| CLI 能不能装 | **不能**。`dsh plugin --profile desktop add ...` 会被 Desktop 锁拒绝（见 §3.5） |
| 推荐安装入口 | GUI 插件管理器 / `plugin_manager` 工具（等价于 `pnpm add` + 自动维护 `dsh.profile.bundles`），或手工编辑 profile 的 `package.json` 后跑 `pnpm install` |
| 版本声明 | `peerDependencies` 必须能匹配 `0.2.0-rc.2`，否则安装被"版本豁免"门禁拦下 |

---

## 1. 一个插件包的最小结构

### 1.1 `package.json` 里 `dsh` 字段逐项语义

| 字段 | 作用 | 证据 |
|---|---|---|
| `main` | cordis Loader `import()` 插件宿主半的入口。必须存在，否则行挂不上 | 四家插件全部 `main: "lib/index.js"` |
| `exports` | 决定宿主怎么按子路径 import；**客户端 bundle 的路径也必须在这里暴露**（键名固定为 `"./client"`） | `dsh-better-sidebar` / `@michengai/dsh-*` / `@changfenhuang/dsh-genui` 都有 `"./client"` |
| `dsh.bundle.patch` | **字符串或字符串数组**，指向随包发布的 cordis patch YAML。profile boot 会把这些 YAML **按 `dsh.profile.bundles` 的顺序串接**并合并进最终配置 | `@deepseek-ai/dsh-web-app` 用的是数组（5 个 patch，含 `presets/*.patch.yml`）；第三方包一般只写一个 `./cordis.patch.yml` |
| `dsh.client.platform` | 客户端这一半跑在哪个平台。当前只有 `"web"` 有意义；`parseDshClient` 只校验它是 string | `dsh-client-modules/lib/index.js` 的 `parseDshClient` |
| `dsh.client.inject` | **先加载但不产生 import 边**的对端插件包名数组。用于"我要用到某个插件的客户端 bundle 注册出来的能力/插槽" | `arriveGraphRow()` 里对 `row.inject` 逐个 `arriveDependency` 但**不塞进 `edges`**；对比 `row.external` 才产生 `require` 边 |
| `dsh.client.external` | bundle 里会被 `require()`、但**不属于平台种子表**的模块名。会被当作图上的依赖去解析 | 同上；`prune()` 保留 `external` + `inject` + `edges` |
| `dsh.client.immediately` | 是否在插件加载后立刻拉取客户端 bundle（`dsh-client-modules` 自己用 `true`） | 只有基础包用到，第三方通常不写 |
| `dsh.manifestVersion` | 可选整数，`dsh-better-sidebar` 写 `1` | 稳定标记，第三方可省略 |

`inject` vs `external` 的判据，一句话：

- **值来自别的插件**（要 `require()` 它） → 写 `external`
- **只是要求"它先加载"**（比如它注册了一个槽位/服务，我不 import 它） → 写 `inject`

`dsh-client-ui-layout` 就是纯 `inject` 的范例（5 个 `@deepseek-ai/dsh-client-*` 全在 inject 里，没有 external）。

### 1.2 四个真实样例对照

| | `@michengai/dsh-archive-manager` | `dsh-better-sidebar` | `@michengai/dsh-skills-manager` | `@changfenhuang/dsh-genui` |
|---|---|---|---|---|
| 版本 | 1.0.18 | 0.26.0 | 1.1.19 | 0.12.0 |
| `type` | `module` | `module` | `module` | `module` |
| `main` | `lib/index.js` | `lib/index.js` | `lib/index.js` | `lib/index.js` |
| `exports["./client"]` | `./lib/client.js` | `./lib/client.js` | `./lib/client.js` | `./lib/client.js` |
| `dsh.bundle.patch` | `./cordis.patch.yml` | `./cordis.patch.yml` | `./cordis.patch.yml` | `./cordis.patch.yml` |
| `dsh.client.platform` | `web` | `web` | `web` | `web` |
| `dsh.client.inject` | 6 项（locale / ui-conversation / ui-sidebar / ui-workspace / typert-registry / client-connection） | 5 项（locale / ui-slots / ui-conversation / ui-sidebar-right / **client-modules**） | 2 项（ui-slots / locale） | `[]` |
| `dsh.client.external` | 无 | 无 | 无 | 无 |
| 客户端产物 | `lib/client.js` | `lib/client.js`（**还有 6 个附带 chunk**：client-mermaid 7.0MB、client-editor 2.3MB、client-registry 1.4MB、client-locale 887KB、client-terminal 753KB） | `lib/client.js` | `lib/client.js` + `lib/assets/*.js` |
| 源码一起发布？ | 否 | **是**（`src/*.ts` 42 个 + `exports["./src/*"]`） | 否 | **是**（`src` + 连 `tsdown.config.ts`、`tsconfig.json` 都发） |
| 构建脚本 | `node scripts/build.mjs`（**构建配置未随包发布**） | `tsc -p tsconfig.build.json && tsdown`（**`tsdown.config.ts` 未随包发布**，`scripts/` 只剩 `install.sh`/`install.ps1`） | `node scripts/build.mjs`（未发布） | `tsc -p tsconfig.json && tsdown`（**`tsdown.config.ts` 已发布 → 唯一可直接抄的完整配置**） |
| peer 版本写法 | 白名单枚举 `"0.1.2-rc.1 \|\| … \|\| 0.2.0-rc.2 \|\| 0.2.1-alpha.2"` | 简单 caret `"^0.2.0-rc.2"` | 白名单枚举（同 archive-manager） | `"^0.1.2-rc.1 \|\| ^0.1.5-alpha.1 \|\| ^0.1.6-alpha.1 \|\| ^0.1.7-alpha.1 \|\| >=0.2.0-rc.1 <0.3.0-0"` |

**三者共有且必须的最小集合**：`type: module` + `main` + `exports["./client"]` + `dsh.bundle.patch` + `dsh.client.platform`。

`dsh-better-sidebar` 把 `src/*.ts` 一起发，是为了让 `exports["./src/*"]` 能被别的包直接引用源码——**不是本地开发必需的**，只是它作为"被聚合包依赖的库"的选择。

### 1.3 `cordis.patch.yml` 里 `insert` 怎么写（全部是真实片段）

文件本身是**一个顶层 YAML 数组**，每一项是一条"加载器补丁条目"。最常用的是 `insert:`，值是一个**行数组**：

**最小形态** —— `dshmarket/cordis.patch.yml`（全文）：

```yaml
# dsh bundle patch: inserts this plugin into a profile's layer stack.
- insert:
    - id: dsh-market
      name: 'dshmarket'
```

**带 config 与 `!!js` 表达式** —— `@cola1900/dsh-ppt/cordis.patch.yml`（全文）：

```yaml
# DSH 0.1.7 host-plane registration. Session tools and the Skill are mounted
# by presets/ppt.patch.yml through the native agent-preset mechanism.
- insert:
    - id: dsh-ppt
      name: '@cola1900/dsh-ppt'
      config:
        root: !!js dshHomePath('kimi-ppt')
```

**纯 `id` 覆写已有行（不需要 mount 新行时）** —— `billion-context/dsh.bundle.patch.yml` 片段：

```yaml
- insert:
    - id: bili-native
      name: billion-context
- id: compaction-basic
  config:
    auto: false
- id: llm-deepseek
  config:
    retryPolicy:
      mode: normal
      retryableCodes: [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, MALFORMED_RESPONSE]
```

**带防重挂载守卫** —— `dsh-better-sidebar/cordis.patch.yml`（全文，注释里有大量设计说明）：

```yaml
- insert:
    - id: better-sidebar
      name: 'dsh-better-sidebar'
      disabled: !!js "[...ctx.loader.entries()].some((e) => e.options.name === 'dsh-better-sidebar' && e.options.id !== 'better-sidebar' && !e.disabled)"
```

命名规则：`name` 必须是**包名**或**包名 + 子路径**（如 `'@michengai/dsh-agency-agents/remote'`、`'@michengai/dsh-agency-agents/preset'`、`'@deepseek-ai/dsh-plugin-manager/tools'`），由 Loader 从 profile 的 `node_modules` 解析。

**两条必须知道的语义**：

1. **`config:` 是整体替换，不是深合并。** `billion-context` 的注释原文：
   > "a patch replaces the targeted row's WHOLE config (no deep merge), so each row restates every default code plus MALFORMED_RESPONSE — dropping any default code silently removes its retries."

   所以覆写某行的 config 时要把用到的默认值全部重写一遍。
2. **补丁条目数组的顺序 = 应用顺序**；`dsh.profile.bundles` 里靠后的 bundle 优先级更高（后应用覆盖先应用）。`better-sidebar` 注释里也确认「`dsh plugin add` 把新 bundle 追加在最后」是标准安装顺序。

---

## 2. 客户端 bundle

### 2.1 线格式（wire format）

浏览器侧由 `window.__ModuleLoader__` 接管。一个客户端 bundle 就是一个**立即执行的脚本**，内容是：

```js
window.__ModuleLoader__.load({
  id: "<包名>",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    /* ===== 你的代码（CJS，require() 外部依赖） ===== */
    // ...
    /* ============================================ */
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
```

实测证据：

- `@michengai/dsh-skills-manager/lib/client.js` 头：`window.__ModuleLoader__.load({ id: "@michengai/dsh-skills-manager", factory: (require) => { … "use strict";var zT=Object.create;… } }); //# sourceMappingURL=client.js.map`
- `dsh-better-sidebar/lib/client.js` 头：`… factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" }); //#region \0rolldown/runtime.js … let react = require("react"); react = __toESM(react, 1); let react_dom_client = require("react-dom/client"); let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives"); let react_jsx_runtime = require("react/jsx-runtime"); let react_dom = require("react-dom");`
  尾：`exports.apply = apply; exports.inject = inject; return module.exports; } }); //# sourceMappingURL=client.js.map`

结论：

- **模块格式是 CJS + factory(require)，不是 ESM 默认导出。** 插件客户端半通过 `exports.apply` / `exports.inject` 暴露（cordis 惯例）。
- react / `@deepseek-ai/*` **保持 external**，不打进包（`dsh-better-sidebar/lib/client.js` 只有 1.4MB，而它单独的 `client-mermaid.js` 有 7.0MB —— 说明重型第三方库是被拆出去的 chunk，不是内联的）。
- 附属 chunk 用 `require.async(...)` 走同一个 loader（`dsh-better-sidebar` 的 6 个 `client-*.js` 就是这么用的）；**单文件插件完全不需要 code splitting**。

### 2.2 模块表（platform seed table）

`require()` 里有一批**由平台直接答**的名字，不需要声明、不需要打包。从 `@changfenhuang/dsh-genui/tsdown.config.ts` 的 `EXTERNALS` + 其 purity gate 注释可读出**至少**这些：

```
react
react/jsx-runtime
react-dom
react-dom/client
@deepseek-ai/cordis
@deepseek-ai/dsh-client-store
@deepseek-ai/dsh-client-ui-primitives
@deepseek-ai/dsh-client-ui-slots
@deepseek-ai/dsh-client-ui-dockkit
```

**版本实测**（asar 内 + shell bundle）：

- `@deepseek-ai/cordis` = **4.0.4**
- `@deepseek-ai/dsh-client-ui-slots` = **0.2.0-rc.2**
- **React = 18.3.1**（在 `/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js` 里 grep 到 `version:"18.3.1"`；所有插件包都只把 react 写进 `peerDependencies`，实际由 shell 提供）

(`genui` 自己只用其中 5 个，并把 `EXTERNALS` 之外的任何 `@deepseek-ai/*` 导入当作**构建期错误**抛出：

> `client bundle purity: "<pkg>" is not in the module table (EXTERNALS) — cross-plugin value imports are forbidden; collaborate through cordis services`)

这是个很好的工程约束：**客户端半边只准用平台种子模块**，要跟其他插件协作就走 cordis service / 槽位（并在 `dsh.client.inject` 里声明）。

### 2.3 推荐构建配置（可直接抄的真实配置）

`@changfenhuang/dsh-genui/tsdown.config.ts` 是已发布包中**唯一带完整构建配置**的插件，其头部注释明确说它 "Mirrors the dsh repo's `packages/client/tsdown.client.ts` preset, simplified for one package"。

**客户端半（关键部分）**：

```ts
const ID = '@yourscope/dsh-session-menu'

const EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-primitives',
  // 用槽位就再加 '@deepseek-ai/dsh-client-ui-slots'
]

const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',            // ← 必须是 cjs
  platform: 'browser',
  dts: false,
  minify: true,             // 宿主不压缩下发，每个字节都算
  sourcemap: false,
  clean: false,
  deps: {
    neverBundle: [...EXTERNALS],
    alwaysBundle: (id: string) => !EXTERNALS.includes(id),
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.MODE': '"production"',
    'import.meta.env': '{"MODE":"production"}',
  },
  outputOptions: {
    entryFileNames: 'client.js',
    codeSplitting: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
```

**宿主半**：

```ts
const libConfig: UserConfig = {
  name: ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],          // ← 宿主半边是 ESM
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  outputOptions: { entryFileNames: '[name].js' },
  clean: false,
}
```

`package.json`：

```json
"scripts": { "build": "tsc -p tsconfig.json && tsdown" }
```

**显然 `tsc` 要在 `tsdown` 之前跑**（`lib/` 先清、类型先出，再出 bundle）。

**不引入 tsdown 的等价 esbuild 命令**（未实测，但 esbuild 的输出顺序是 banner → intro → code → outro → footer，与上面模板一致）：

```bash
esbuild src/client/index.tsx \
  --bundle --format=cjs --platform=browser --minify --jsx=automatic \
  --external:react --external:react/jsx-runtime --external:react-dom/client \
  --external:@deepseek-ai/cordis --external:@deepseek-ai/dsh-client-ui-slots \
  --define:process.env.NODE_ENV='"production"' \
  --banner:js='window.__ModuleLoader__.load({ id: "@you/dsh-session-menu", factory: (require) => {' \
  --intro='var module = { exports: {} }; var exports = module.exports;' \
  --footer:js='return module.exports; } });' \
  --outfile=lib/client.js
```

（`@michengai/dsh-skills-manager/lib/client.js` 的产物风格是 esbuild 味儿的 `"use strict";var zT=Object.create;…`，说明 esbuild 路线在生产插件里确实在用。）

### 2.4 宿主在哪段代码里读取 `lib/client.js`

链路（全部在 asar 里验证过）：

1. `@deepseek-ai/dsh-client-modules/lib/index.js` —— 宿主半。
   - `static inject = ["loader"]`，`ctx.inject(["webServer"], registerWebCarrier)`，并监听 `ctx.on("webserver/index-inject", ...)`。
   - 从已加载的 loader 行读 `dsh.client` 声明（`parseDshClient`），构出 `graphRow(id, rev, fields) => { id, url: comboReference([id], rev), rev, inject?, immediately?, external? }`。
   - `orderByModuleGraph(entries)` 按 `external` 做拓扑排序，环会抛错（错误信息里用 `->` 连 id）。
   - 客户端 bundle 的 URL 也就是 profile 里 `exports["./client"]` 解析出来的那个文件。
2. `@deepseek-ai/dsh-client-ui-renderer` / web shell 侧（`dsh-client-modules/lib/client.js`）——
   `arriveGraphRow()` 递归拉取依赖、`materialize(id, ownerId)` 执行 `registered.factory(this.makeRequire(ownerId, edges))`。
3. URL 未写死后缀：`unwrapClientSpecifier` / `stripClientSuffix` 会把末尾的 `/client` 去掉，所以 `<id>/client` 和裸 `<id>` 等价。

已知错误串（排查时直接 grep 用）：

```
client-modules: could not load "<id>": <failures>
client-modules: "<consumerId>" not loaded because dependency "<dependency.id>" failed: ...
client-modules: module arrival cycle ..., (the host must reject this graph before serving it)
client-modules: no registered factory for "<id>"
client-modules: replacing bootstrap module <id> requires a page reload
```

---

## 3. 本地插件的安装与迭代

### 3.1 `link:` vs `file:` —— 实测对比（pnpm 11.7.0 / node v24.21.0）

沙箱用 bundled 运行时（**注意：不是系统 node/pnpm**）：

```bash
NODE=$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node
PNPM=$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs
"$NODE" -v        # v24.21.0
"$NODE" "$PNPM" -v   # 11.7.0
```

| | `file:/abs/path` | `link:/abs/path` |
|---|---|---|
| `node_modules/<name>` 形态 | **真实目录 + 硬链接文件**（`ls -lai` 两边 inode 相同 `70583856`） | **符号链接**（`dsh-test-plugin -> ../../../../../tmp/dsh-pnpm-link/plugin-link`） |
| 改源码后不重装 | 已同步（因为硬链接指向同一 inode） | 已同步 |
| 改**已存在文件内容** | 同步 | 同步 |
| **新增/删除文件**（比如新增一个 chunk、改名） | **不同步**（硬链接集合是打包时快照，`pnpm install` 报 `Already up to date` 也不刷新） | 同步 |
| 锁文件条目 | `dsh-test-plugin@file:...: {}` | `specifier: link:...` / `version: link:../../../../tmp/...` |
| 装 `dependencies` | 会按目标包的 `dependencies` 递归装 | **不装**（目标目录自带 `node_modules` 自己管） |

实测命令（以 `file:` 为例，`link:` 同理）：

```bash
cd /tmp/dsh-pnpm-test/profile
"$NODE" "$PNPM" add "file:/tmp/dsh-pnpm-test/plugin-src"     # → + dsh-test-plugin file:...（硬链接进 node_modules）
echo '…V2' > /tmp/dsh-pnpm-test/plugin-src/lib/index.js      # 改源码
"$NODE" "$PNPM" install                                      # → "Already up to date"
cat node_modules/dsh-test-plugin/lib/index.js                # → V2（硬链接，跟着变了）
"$NODE" "$PNPM" add "file:/tmp/dsh-pnpm-test/plugin-src"      # 重加同 spec → 仍 "Already up to date"
```

**结论：本地开发用 `link:`。**

- `link:` 创建的软链让「改代码 → 立刻生效」不需要 pnpm 参与；
- 且 `link:` **不会**顺手把目标的 `dependencies` 装进 profile（`file:` 会），profile 更干净；
- 且 `link:` 的 realpath 落在 profile 外 → 才能命中 §3.3 的"linked root"解析路径，也才**不被 hmr 的 `ignored: ["**/node_modules", ...]` 排除**（见 §4）。

### 3.2 精确命令

```bash
NODE=$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node
PNPM=$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs
PROJ=<repo>
PROFILE=$HOME/.dsh/profiles/desktop

# 0) 先备份（改 profile 前务必做）
cp "$PROFILE/package.json"      "$PROFILE/package.json.bak"
cp "$PROFILE/pnpm-lock.yaml"    "$PROFILE/pnpm-lock.yaml.bak"

# 1) 项目内构建
cd "$PROJ" && "$NODE" "$PNPM" run build        # → lib/index.js, lib/client.js

# 2) 装进 profile（link: 用绝对路径）
cd "$PROFILE" && "$NODE" "$PNPM" add "link:$PROJ"
#    等价于在 $PROFILE/package.json 的 dependencies 里加：
#    "@yourscope/dsh-session-menu": "link:<repo>"

# 3) 若插件声明了 dsh.bundle.patch，把包名追加到 dsh.profile.bundles 末尾
#    （这一步 GUI 插件管理器会自动做；手工装时自己加）
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('$HOME/.dsh/profiles/desktop/package.json')
m = json.loads(p.read_text())
name = '@yourscope/dsh-session-menu'
b = m.setdefault('dsh', {}).setdefault('profile', {}).setdefault('bundles', [])
if name not in b:
    b.append(name)
p.write_text(json.dumps(m, indent=2, ensure_ascii=False) + '\n')
PY
```

**不要**在 `$PROJ` 里跑 `pnpm add link:...` 去反指 profile —— 方向反了。

### 3.3 为什么 `link:` 能跑通：DSH 的 linked-root 解析

`@deepseek-ai/dsh-app-boot` 的 README 原文（关键段落）：

> **Process-local module resolution.** The launcher installs the runtime resolution on Node's internal ESM and CommonJS resolvers before profile rows mount.
> **Linked directories.** A profile link to an external directory admits its importers to peer-aware ancestor lookup, even without its own `package.json`. At each `D/node_modules` position, current `D/package.json` peer names present in the runtime table use the runtime package; other names use the physical candidate. A nearer physical package precedes a later peer declaration, and a peer position needs no physical `node_modules`.
> Runtime resolution entries occupy their package names at `$DSH_HOME/profiles/node_modules`, and every other name sees that directory as an ordinary ancestor.

源码侧对应：`/tmp/boot.js`（= asar 内 `@deepseek-ai/dsh-app-boot/lib/index.js`，181KB）里
`linkedProfileRoots(profile, profilesDir)` → `linkedRoots`，`routeLinked(request, name, parent, resolution, flavor, cjs)`，`readPeerNames(directory)` 读的正是 `D/package.json` 的 `peerDependencies`。

**实践含义（很重要）**：

- 插件把 **宿主包写进 `peerDependencies`**，运行时就一定拿到 profile 的**同一份**实例 —— 天然避免双实例（React hooks / cordis service 冲突的经典死法）。`dsh-better-sidebar` 的注释明确写过双挂载会 "register /sidebar/api twice and fail the whole plugin tree at boot (`duplicate prefix route`)"。
- 如果**不**声明 peer、而是把 `@deepseek-ai/dsh-session` 装成自己的 `devDependency`，那么 `<proj>/node_modules/@deepseek-ai/dsh-session` **不会**被 peer 规则遮蔽……实话说：peer 检查只在声明了 peer 的名字上生效。不声明就可能加载到你自己那份，出现两份实例。
  **结论：宿主包一律声明为 `peerDependencies`，本地为了类型/IDE 再把它装成 `devDependencies`（版本对齐 0.2.0-rc.2）。**

- `$DSH_HOME/profiles/node_modules` 下确实铺着全套 `@deepseek-ai/dsh-*`（实测 193 个条目），是"every other name 的普通祖先"。但注意里面有些是**指向 Desktop app 已升级掉路径的悬空软链**（例：`@deepseek-ai/cordis-plugin-hmr -> $HOME/Library/Application Support/io.github.hairyf.deepseek-harness-desktop/dependencies/dsh/node_modules/...` 已不存在）。所以**不要依赖物理解析兜底，声明 peer 才是稳的**。

### 3.4 直接复制产物进 `node_modules` 行不行？

**能跑，但不推荐做迭代主路径。** 需要同步的东西：

| 文件 | 手工复制路线 | `pnpm add link:` 路线 |
|---|---|---|
| `node_modules/<name>/` | 你手动放 | pnpm 建软链 |
| `package.json` (`dependencies`) | **必须手加**，否则下次 `pnpm install` 会被 prune 掉 | pnpm 自动写 |
| `pnpm-lock.yaml` | **必须同步**，否则下次 pnpm 操作会以 lock 为准把目录删掉 | pnpm 自动写 |
| `dsh.profile.bundles` | **必须手加**（否则 bundle patch 不参与合成） | 需手加（GUI 会自动） |
| `cordis.patch.yml` | 不会被覆盖 —— 那是**你自己的 patch 层**，DSH 从不写它 | 同左 |

`<profile>/cordis.patch.yml` 文件头注释（实测原文）：

> `# Your patch layer for this dsh profile, applied after every bundle layer:`
> `# a top-level YAML array of loader patch entries (id-targeted config`
> `# overrides, disables, and insert lists; \`!!js\` expressions allowed).`

DSH 会**写**它的只有插件自己（例：`dsh-remote-web-ui` 往里写了一段被 `# --- ... (managed - do not edit) ---` 包起来的 block，并且它同时也往 `package.json` 的 `dsh.profile.bundles` 里加了自己）。

> ⚠️ 有明确标记的托管块之外，**别手工编辑 `cordis.patch.yml`**——`dsh-remote-web-ui` 那段是它自己管理的。

**为什么不推荐手抄**：`pnpm install` / GUI 的任意一次插件操作都可能以 `package.json` + `pnpm-lock.yaml` 为准做 prune，把你手抄的目录清掉。**要么 `link:`，要么走 GUI**。

### 3.5 GUI / CLI 安装到底改了什么

**CLI（`@deepseek-ai/dsh` 的 `lib/bin.js`，255 行）**：

- `bin = { dsh: 'lib/bin.js' }`，用法 `dsh [--profile] <name> [options] [appArgs]`，插件子命令是 `dsh plugin --profile <p> <add|remove|...> <target>`。
- **对本 profile 不可用**：`parseDshArgs(..., manageDesktopProfile=true)` 里有一条 **`rejectElectronProfile`** —— Desktop 壳运行时，CLI 拒绝对 desktop profile 做插件管理。也就是说 `dsh plugin --profile desktop add link:/path` 会被挡。
  `dsh-better-sidebar/cordis.patch.yml` 里虽然把 `dsh plugin --profile <name> add dsh-better-sidebar@<version>` 写成了标准安装形式，本地 dev 用不上。

**Plugin Manager（`@deepseek-ai/dsh-plugin-manager`）**：

- 与 CLI 共用 `lib/types/operations.js`（588 行）：
  - `INSTALL_COMMANDS = new Set(['add', 'install', 'i'])`
  - 安装后逐个新依赖读包清单；**没有 `dsh.bundle`** 会警告：`<name> declares no dsh.bundle — installed as a plain dependency, not a profile layer`；**有**则把包名追加进 `dsh.profile.bundles` 并写回 profile manifest。
  - `parseInstallSpec` 支持 `kind === 'path'`（"A path spec is read from disk"）——**绝对路径，或 `file:` / `link:` 前缀**。错误信息：`a local path must be absolute`、`a relative path resolved against the profile would point inside it`。
- 支持 peer 版本门禁：`Plugin <key> is incompatible with dsh <runtimeVersion>: peerDependencies …`。要绕过必须对 **这个插件 × 这个 runtime 精确版本** 授权豁免（`dsh plugin allow-version` 或插件管理器）。**建议一开始就把版本范围写对，别走豁免。**
- 有卸载/启用/禁用/重装等操作，**"Direct Plugin Manager operations apply without waiting for file events"**（不用等文件监听，立刻生效）。
- 已装插件版本替换（升级）**仍然需要重启** —— `dsh-hmr` README 明写。

**dshmarket（`$HOME/.dsh/profiles/desktop/node_modules/dshmarket`，v1.66.26）**：

- 它自己不实现安装，而是 **委托给官方 CLI**（`runDshPlugin` → `dsh plugin --profile <p> add <target>`）。
- **它认识 `link:` 是"本地开发安装"并刻意保护**：包括 `isLocalSpec`、`restoreTargetForLocal`、以及"不把本地开发链接替换为线上版本"的行为，UI 也有"本地开发链接"的区分展示。
- **它没有"从本地目录安装"的入口** —— 只识别/保留**别的方式**创建的 `link:` 记录。所以：**本地 dev 链接得自己建（`pnpm add link:` 或 GUI 插件管理器），市场会尊重它。**

---

## 4. 生效与重载

### 4.1 客户端半：**有真 HMR，500ms 内自动热替换**

`@deepseek-ai/dsh-client-hmr/lib/index.js`（5131 字节）核心：

```js
/* stat-polls every graph row's client bundle (polling by design: network mounts …) */
const Config = z.object({ pollIntervalMs: z.number().step(1).min(1).default(500) });
const sameBundleStat = (left, right) => left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.size === right.size;
// Service.init: for each row → ctx.clientModules.artifactBaseline(row.id) → watchRow(id, baseline)
const timer = setInterval(pollWatches, pollIntervalMs);
```

- 它**逐行 stat-poll 每个 client bundle 的 `mtimeMs/ctimeMs/size`**，变了就通过 SSE 推给浏览器，浏览器重新拉取并重新 materialize 那个模块。
- **不受 `hmr` 的 `root: []` 影响**，也不受 `ignored: ["**/node_modules"]` 影响 —— 它盯的是 `clientModules.artifactBaseline(row.id)` 给出的**具体文件路径**（对 `link:` 插件就是工作区里的真实 `lib/client.js`）。
- 本 profile 里 `client-hmr` 与 `client-modules` 两行都在（`cordis.yml` 第 706 / 709 行），**是启用的**。

👉 **改 `lib/client.js` → 浏览器自动热替换，不用重启、不用刷页面。**（唯一例外见上文错误串：替换 bootstrap 模块需要刷页面。）

### 4.2 宿主半：**默认不监听源码，需要重启**

`@deepseek-ai/dsh-hmr/README.md` 原文：

> The base bundle enables HMR with `root: []` when the launcher supplies `profileContext`; hosts without that profile context leave this entry disabled. … **Disabling or omitting HMR applies changes on restart.** To enable source-module watching, configure the `hmr` entry supplied by the base bundle in the profile patch before launching:
> ```yaml
> - id: hmr
>   disabled: false
>   config:
>     root: ["."]
> ```

配置表：

| 字段 | 默认 | 含义 |
|---|---|---|
| `base` | Context base URL | 模块监听的基准目录 |
| `root` | `["."]` | 模块监听根；**`[]` 只保留"显式配置监听"** |
| `ignored` | `["**/node_modules", "**/.*", "cache", "data"]` | 排除路径 |
| `debounce` | `100` | 合并文件变更的毫秒数 |

源码实现（`/tmp/hmr.js`，`Service.init` 段）确认三件事：

1. **`profileContext` 存在时，这三条"配置监听"永远开**：
   - `<profile>/cordis.patch.yml`（`profile.patchPath`）
   - `<DSH_HOME>/cordis.patch.yml`（`join(profile.home, PROFILE_PATCH_FILENAME)`）
   - `<profile>/package.json`（`manifestPath`）

   → **改 profile patch 会立刻重组重载；改 `dsh.profile.bundles` 也会**（`refresh(manifestOnly)` 里 `if (manifestOnly && bundles === lastBundles) return;` —— 只有 bundles 列表真变了才重载）。这就是"手工编辑 packages.json 加 bundle 能当场生效、不用重启"的依据。
2. **模块监听是 `watch(root, { cwd: realpathSync(this.baseDir), ignored, ignoreInitial: true })`** —— `root` 为空就一个都不听。**当前 profile 里 `hmr` 行就是 `config: { root: [] }`（`cordis.yml` 第 9-11 行），所以本机默认：改宿主半源码不生效。**
3. 变更分派里 `canonicalPath(resolve(watchBaseDir, path))` —— 用 **realpath**。所以 `link:` 进来的插件，路径就落到工作区真实文件上，能被匹配（只要 `root` 覆盖到）。

**代价提示**：`ignored` 默认排除 `**/node_modules` —— **npm/bundle 渠道装的插件天然不会被源码监听**（它们在 profile 的 `node_modules` 里）。这正是 `link:` 的额外好处：realpath 在工作区，不在 `node_modules` 下。

**开启宿主半热重载（可选，改的是用户 profile，按需手动做）**：

```yaml
# 追加到 $HOME/.dsh/profiles/desktop/cordis.patch.yml
# 注意 config 是整体替换：base/ignored/debounce 会被重置为默认值（当前也就是默认值，无损）
- id: hmr
  config:
    root:
      - <repo>
```

两点注意：

- `dsh-hmr` 的 `awaitWriteFinish` **默认 true，写入稳定窗口 2 秒** → 编辑后大约 2 秒内触发。想更快就配 `awaitWriteFinish`（关掉可能丢快速连击）。
- 改 `package.json` 的依赖/版本（装/换包）**仍然需要重启**（README 的 Known Limitations）。

### 4.3 最小生效步骤（总结）

| 你改了什么 | 最少要做什么 | 依据 |
|---|---|---|
| `lib/client.js`（或它 require 的 chunk） | 重新构建即可。浏览器 500ms 内自动热替换 | `dsh-client-hmr` stat-poll |
| `src/client/*` 源码 | 跑 `pnpm run build` 出 `lib/client.js` | 同上 |
| `lib/index.js`（宿主半，**未开** `hmr.root`） | **重启 app** | `root: []` |
| `lib/index.js`（宿主半，**已开** `hmr.root` 指到项目） | 保存后 ~2 秒自动 reload | `dsh-hmr` + `awaitWriteFinish` |
| `cordis.patch.yml`（profile 的，或插件自己的 bundle patch） | 无需重启，立刻重组 | 显式 config 监听 |
| `package.json` 的 `dsh.profile.bundles` | 无需重启，立刻重组 | `refresh(manifestOnly)` |
| 新增/升级/删除依赖包 | **重启** | `dsh-hmr` Known Limitations |
| profile 的 `package.json` **其他**字段 | 不改 bundles 就不会触发重载 | 同上 |

---

## 5. 版本与兼容

### 5.1 真实写法对照

**archive-manager（1.0.18）** —— 白名单枚举，精确列出兼容的每个版本：

```json
"@deepseek-ai/dsh-session": "0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.5-rc.3 || 0.1.7-rc.1 || 0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-alpha.2",
"@deepseek-ai/cordis": "^4.0.1"
```

**better-sidebar（0.26.0）** —— 简单 caret，当前版本就是 `^0.2.0-rc.2`（最新包的做法）：

```json
"@deepseek-ai/cordis": "^4.0.4",
"@deepseek-ai/dsh-session": "^0.2.0-rc.2",
"react": "^18.2.0",
"react-dom": "^18.2.0"
```

**skills-manager（1.1.19）** —— 与 archive-manager 同款白名单；`cordis` 用范围：

```json
"@deepseek-ai/cordis": ">=4.0.1 <5.0.0",
"@deepseek-ai/dsh-client-ui-slots": "0.1.2-rc.1 || … || 0.2.0-rc.2 || 0.2.1-alpha.2"
```

**genui（0.12.0）** —— caret 链 + 开区间，兼容面最宽：

```json
"@deepseek-ai/dsh-session": "^0.1.2-rc.1 || ^0.1.5-alpha.1 || ^0.1.6-alpha.1 || ^0.1.7-alpha.1 || >=0.2.0-rc.1 <0.3.0-0",
"@deepseek-ai/cordis": "^4.0.1",
"react": "^18.0.0 || ^19.0.0"
```

### 5.2 对 0.2.0-rc.2 的建议

**推荐（跟最新的 better-sidebar 对齐，最省心）**：

```json
"peerDependencies": {
  "@deepseek-ai/cordis": "^4.0.4",
  "@deepseek-ai/dsh-session": "^0.2.0-rc.2",
  "react": "^18.2.0 || ^19.0.0",
  "react-dom": "^18.2.0 || ^19.0.0"
}
```

**要同时兼容 rc.1 / alpha 系列（上架市场时更稳）**：

```json
"peerDependencies": {
  "@deepseek-ai/cordis": "^4.0.1",
  "@deepseek-ai/dsh-session": ">=0.2.0-rc.1 <0.3.0-0",
  "react": "^18.0.0 || ^19.0.0"
}
```

要点：

- **`@deepseek-ai/cordis` 是包名，不是 `@deepseek-ai/cordis-plugin-*`。** 范围按 better-sidebar 写 `^4.0.4`（当前 runtime 是 4.0.4，genui/dshmarket 写 `^4.0.1`，skills-manager 写 `>=4.0.1 <5.0.0`，都通过）。
- **`0.2.0-rc.2` 是 prerelease**：semver 的 caret 对 prerelease 有坑 —— `^0.2.0-rc.2` 能匹配 `0.2.0-rc.2`；`^0.2.0` 也能（rc 小于正式版，会被 `>=0.2.0` 排除掉 `0.2.0-rc.2`，**不要用**）。
- **不申报的包就不要写。** 版本门禁只检查你**声明了**的 peer。

### 5.3 只用客户端插槽时，peer 能压到多低？

**能压得很低。** 依据 `genui` 的 purity gate：客户端半边只允许用平台**种子模块**，而其中就有 `@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`、`@deepseek-ai/cordis`、react 全家。

一个**纯客户端槽位插件**的最小 peer 集：

```json
"peerDependencies": {
  "@deepseek-ai/cordis": "^4.0.4",
  "react": "^18.2.0 || ^19.0.0"
},
"devDependencies": {
  "@deepseek-ai/cordis": "4.0.4",
  "react": "^18.3.1",
  "@types/react": "^18.0.0",
  "@deepseek-ai/dsh-client-ui-slots": "0.2.0-rc.2",
  "@deepseek-ai/dsh-client-ui-primitives": "0.2.0-rc.2",
  "tsdown": "^0.22.2",
  "typescript": "^5.6.0"
}
```

注意几点：

- 只 `import type` 的包（比如为了 TS 类型用 `@deepseek-ai/dsh-client-ui-slots`）**可以只放 `devDependencies`**，不必进 peer。**peer 只写运行时真会 `require()` 的。** 若要写，就写 `"^0.2.0-rc.2"`。
- **零宿主依赖也可以**：源码里不 `require` 任何 `@deepseek-ai/*`（只用 react），peer 就只剩 `cordis` + `react`。
- **但宿主半那一边（`lib/index.js`）如果 import 了 `@deepseek-ai/dsh-*`，必须写 peer** —— 这是 §3.3 的 linked-root peer-aware 解析生效的前提，也是避免双实例的关键。
- **纯客户端插件该长什么样**：宿主半是个**空 `apply`**，但**必须是一个能被 Loader 挂上的 cordis 插件行** —— 因为客户端 bundle 是通过"已加载的行的 manifest"被发现并进入 module graph 的。所以最小骨架仍然需要 `cordis.patch.yml` + `dsh.profile.bundles`（或手工 mount）。

---

## 6. 最小插件骨架模板

### 6.1 目录树

```
<repo>/
├── package.json
├── tsconfig.json
├── tsdown.config.ts
├── cordis.patch.yml
├── README.md
├── lib/                      ← 构建产物（.gitignore）
│   ├── index.js              ← 宿主半（ESM）
│   ├── client.js             ← 客户端半（__ModuleLoader__ 包装的 CJS）
│   └── assets/               ← 可选：按需加载的重型 chunk
├── src/
│   ├── index.ts              ← 宿主半入口
│   └── client/
│       └── index.tsx         ← 客户端半入口
└── research/                 ← 本调研目录（不进 files）
```

### 6.2 `package.json` 模板

```json
{
  "name": "@yourscope/dsh-session-menu",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "scripts": {
    "clean": "node -e \"require('node:fs').rmSync('lib',{recursive:true,force:true})\"",
    "build": "npm run clean && tsc -p tsconfig.json && tsdown",
    "dev": "tsdown --watch",
    "typecheck": "tsc --noEmit"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": [] }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@deepseek-ai/dsh-client-ui-slots": "^0.2.0-rc.2",
    "react": "^18.2.0 || ^19.0.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "4.0.4",
    "@deepseek-ai/dsh-client-ui-slots": "0.2.0-rc.2",
    "@deepseek-ai/dsh-client-ui-primitives": "0.2.0-rc.2",
    "@deepseek-ai/dsh-session": "0.2.0-rc.2",
    "@types/react": "^18.0.0",
    "react": "^18.3.1",
    "tsdown": "^0.22.2",
    "typescript": "^5.6.0"
  }
}
```

### 6.3 `cordis.patch.yml` 模板

```yaml
# 本插件的 bundle patch 层：profile 把包名列进 dsh.profile.bundles 时自动合成。
- insert:
    - id: session-menu
      name: '@yourscope/dsh-session-menu'
      # config:                  # 可选；注意 config 是整体替换，不是深合并
      #   someOption: true
```

> 若插件**不**声明 `dsh.bundle`（例如纯客户端、想手工 mount），改为在
> `$HOME/.dsh/profiles/desktop/cordis.patch.yml` 里加同样的一段 `- insert:`。

### 6.4 `tsdown.config.ts` 模板

见 §2.3，直接抄 `genui` 的 `libConfig` + `clientConfig`（本文已列出关键字段全文）。

### 6.5 `src/index.ts`（宿主半，纯客户端插件版）

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = '@yourscope/dsh-session-menu'
export const inject = []          // 需要宿主服务才填，如 ['webServer']

export function apply(ctx: Context): void {
  // 纯客户端插件：宿主半留空即可（仍然需要一个可被挂载的行）
  void ctx
}
```

### 6.6 `src/client/index.tsx`（客户端半）

```tsx
import type { Context } from '@deepseek-ai/cordis'

export const name = '@yourscope/dsh-session-menu'
export const inject = ['slots']   // 只写 cordis 服务名；跨插件依赖走 dsh.client.inject

export function apply(ctx: Context): void {
  // ctx.slots.… 注册 UI
  void ctx
}
```

构建产物必须落成 §2.1 的 `window.__ModuleLoader__.load({...})` 包装 —— 这就是 `tsdown` 那三行 `banner`/`intro`/`footer` 干的事。

---

## 7. 命令序列（照抄即可）

```bash
# ── 0. 常量 ────────────────────────────────────────────────
NODE=$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node
PNPM=$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs
PROJ=<repo>
PROFILE=$HOME/.dsh/profiles/desktop
PKG=@yourscope/dsh-session-menu

# ── 1. 项目内：装依赖 + 构建 ────────────────────────────────
cd "$PROJ"
"$NODE" "$PNPM" install
"$NODE" "$PNPM" run build          # → lib/index.js + lib/client.js

# ── 2. 首次装进 profile（先备份） ───────────────────────────
cp "$PROFILE/package.json"   "$PROFILE/package.json.bak"
cp "$PROFILE/pnpm-lock.yaml" "$PROFILE/pnpm-lock.yaml.bak"
cd "$PROFILE"
"$NODE" "$PNPM" add "link:$PROJ"

# ── 3. 登记 bundle 层（若声明了 dsh.bundle.patch） ──────────
python3 - <<PY
import json, pathlib
p = pathlib.Path("$PROFILE/package.json")
m = json.loads(p.read_text())
b = m.setdefault("dsh", {}).setdefault("profile", {}).setdefault("bundles", [])
if "$PKG" not in b: b.append("$PKG")
p.write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
PY

# ── 4. 日常迭代 ────────────────────────────────────────────
cd "$PROJ" && "$NODE" "$PNPM" run build
#   → lib/client.js 改动：浏览器 ~500ms 内自动热替换
#   → lib/index.js 改动：默认需重启 app（或按 §4.2 开 hmr.root）

# ── 5. 卸载 ────────────────────────────────────────────────
cd "$PROFILE" && "$NODE" "$PNPM" remove "$PKG"
#   并手动从 dsh.profile.bundles 里删掉 "$PKG"
```

---

## 8. 风险清单

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| 1 | **CLI 对 desktop profile 不可用** | `dsh plugin --profile desktop add …` 直接被 `rejectElectronProfile` 拒绝 | 用 GUI 插件管理器（或 `plugin_manager` 工具），或手工编辑 `package.json` + `pnpm install` |
| 2 | **`package.json` 的 `config:` 是整体替换** | 覆写某行 config 时漏写默认值 → 静默丢功能 | 覆写时把所有需要字段重写一遍（`billion-context` 的注释即为此教训） |
| 3 | **手工抄进 `node_modules` 会被 prune** | 下次 `pnpm install` / GUI 任意插件操作后目录消失 | 用 `link:`；必须手抄的话同步 `package.json` + `pnpm-lock.yaml` + `dsh.profile.bundles` |
| 4 | **peer 范围不匹配 0.2.0-rc.2 会被门禁拦** | 安装失败：`Plugin … is incompatible with dsh …` | 写 `^0.2.0-rc.2` 或 `>=0.2.0-rc.1 <0.3.0-0`；别用 `^0.2.0`（会把 rc 排除） |
| 5 | **不声明 peer 可能导致双实例** | React hooks 报错 / cordis service 冲突 | 运行时真会 `require()` 的 `@deepseek-ai/*` 全写进 `peerDependencies` |
| 6 | **默认 `hmr.root: []`** | 宿主半改完没反应，误以为代码没生效 | 重启，或按 §4.2 在 profile patch 里指定 `root` |
| 7 | **`ignored` 默认含 `**/node_modules`** | 装在 profile `node_modules` 里的插件（npm 渠道）永远不被源码监听 | 这正是选 `link:` 的另一个理由 |
| 8 | **`awaitWriteFinish` 默认 2s** | 保存后感觉"慢半拍" | 接受，或调 `awaitWriteFinish`（关掉可能丢连击事件） |
| 9 | **bundle 重复挂载** | 两个宿主半 → `duplicate prefix route`，整棵插件树 boot 失败 | 用 `better-sidebar` 那样的 `!!js` 守卫，或确保只有一个渠道 mount；注意守卫只能看到**排在它前面**的行 |
| 10 | **客户端 bundle 里 import 了种子表以外的 `@deepseek-ai/*`** | 运行时报 `client-modules: no registered factory for "<id>"` | 抄 genui 的 purity gate，把这类 import 变成构建期错误；改用 `dsh.client.inject` + cordis service |
| 11 | **`$DSH_HOME/profiles/node_modules` 里有悬空软链** | 兜底物理解析可能失败 | 声明 peer，走 runtime resolution 而不是物理路径 |
| 12 | **升级/替换插件版本仍需重启** | 以为 `dsh-hmr` 能搞定 | 明确：Module replacement 不覆盖"装包"；README Known Limitations 原文即此 |
| 13 | **`dsh.profile.bundles` 顺序有语义** | 后加的优先级更高；聚合包与单体包顺序错会双挂 | 新 bundle 追加末尾（这也是 `dsh plugin add` 的默认行为） |
| 14 | **pnpm 位置容易搞错** | 用系统 pnpm/node 可能因版本差异行为不同 | 一律用 `$DSH_HOME/dsh-runtimes/dsh-primary-runtime/dependencies/` 下的 `node`(v24.21.0) + `pnpm`(11.7.0) |
| 15 | **`dsh.client.platform` 目前只有 `web` 有意义** | 写成别的值不会被拦，但也不会加载 | 固定 `"web"` |

---

## 附：本次调研的关键文件索引

| 内容 | 路径 |
|---|---|
| profile 清单 + bundles | `$HOME/.dsh/profiles/desktop/package.json` |
| profile 合成后的完整配置（52KB） | `$HOME/.dsh/profiles/desktop/cordis.yml` |
| profile 的用户 patch 层 | `$HOME/.dsh/profiles/desktop/cordis.patch.yml` |
| profile pnpm 配置（`nodeLinker: hoisted`、`autoInstallPeers: false`、`allowBuilds`） | `$HOME/.dsh/profiles/desktop/pnpm-workspace.yaml` |
| profile `.npmrc`（`confirmModulesPurge=false`） | `$HOME/.dsh/profiles/desktop/.npmrc` |
| 运行时模块表 | `$HOME/.dsh/profiles/node_modules/@deepseek-ai/dsh-*`（193 项） |
| 可直接抄的构建配置 | `$HOME/.dsh/profiles/desktop/node_modules/@changfenhuang/dsh-genui/tsdown.config.ts` |
| insert + `!!js` 守卫范例 | `$HOME/.dsh/profiles/desktop/node_modules/dsh-better-sidebar/cordis.patch.yml` |
| 最小 insert 范例 | `$HOME/.dsh/profiles/desktop/node_modules/dshmarket/cordis.patch.yml` |
| 客户端 bundle 包装范例 | `…/node_modules/dsh-better-sidebar/lib/client.js`、`…/@michengai/dsh-skills-manager/lib/client.js` |
| 宿主 linked-root 解析 | asar: `/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`（`linkedProfileRoots` / `routeLinked` / `readPeerNames`） |
| 插件安装/版本门禁/bundles 同步 | asar: `/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/types/operations.js` |
| CLI 与 desktop 拒绝 | asar: `/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js` |
| 客户端 bundle 拉取与 graph | asar: `/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js` + `lib/client.js` |
| 客户端热重载（500ms stat-poll） | asar: `/dsh/node_modules/@deepseek-ai/dsh-client-hmr/lib/index.js` |
| 宿主热重载配置与限制 | asar: `/dsh/node_modules/@deepseek-ai/dsh-hmr/README.md` + `lib/index.js` |

> 说明：asar 内文件用 `python3 /tmp/asar.py cat <asar内路径>` 读取，`/tmp/asar.py` 已存在于本机；本文中「asar: …」路径即该工具的入参路径。
