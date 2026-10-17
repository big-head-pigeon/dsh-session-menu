# R2 · DSH 宿主(Host)侧会话生命周期 API 调研

> 目标：为「删除会话 / 标记未读 / 置顶 / 状态点」四类功能，摸清宿主侧可用的官方 API 与真实数据来源。
> 环境：DSH `0.2.0-rc.2`，asar 归档 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`，`DSH_HOME=$HOME/.dsh`，profile=`desktop`。
> 读取 asar 内文件的命令：`python3 /tmp/asar.py cat /dsh/node_modules/@deepseek-ai/<pkg>/lib/index.js`。
> 下文用 `asar:/dsh/...` 表示 asar 内绝对路径（不是磁盘路径）。
> 第一手样例：已安装的第三方插件 `$HOME/.dsh/profiles/desktop/node_modules/@michengai/dsh-archive-manager`（v1.0.18），下文简称 **AM**。
>
> 本文只做调研，未修改任何被测代码。

---

## 0. 结论速查

| 能力 | 宿主是否有官方 API | 关键依据 |
|---|---|---|
| 读取会话列表 | ✅ 有 | `session_list` typert 方法 → `ApiSessionList.list()` |
| 归档 / 取消归档 | ✅ 有 | `ctx.workspaceRegistry.archiveSession()` / `.unarchiveSession()` |
| 置顶 / 取消置顶 | ✅ 有 | `ctx.workspaceRegistry.pinSession()` / `.unpinSession()` / `.pinnedSessionIds` |
| **删除会话** | ❌ **没有** | 三处反证，见 §3.1；AM 自己造了 `deleteSession` |
| 运行中状态 | ✅ 有 | `summary.running` ← `ctx.agents.get(id)?.status === "running"` |
| 等待用户输入 | ✅ 有 | `projections.values.userQuestions.active[]` |
| **本轮报错** | ✅ 有（事件级） | 最后一个 `turn/end` 的 `data.reason.kind === "error"` |
| 子代理/后台任务运行 | ✅ 有 | `subagentCatalog` / `subagentTiming.active` / `workspace/session-activity` |
| 未读 / 已读 | ❌ **没有** | 全链路无该字段；需插件自持久化 |
| 宿主→客户端事件 | ✅ 有 | `api-session/*` 事件族（5 个） |
| 客户端→宿主调用 | ✅ 有 | typert `remote` 服务：`ctx.get("remote.<namespace>")` |

---

## 1. 会话的磁盘存储结构

### 1.1 实测布局（真实实例路径）

```
$HOME/.dsh/
├── sessions/                                              ← 会话日志根（sessionPersistence.root）
│   └── --Users-leon-Z_AI_WorkSpace--/                     ← 编码后的 cwd 分组
│       └── b8c1ec17-3582-4472-9264-1c032b025be6/          ← 一个会话一个目录
│           ├── session.v4.jsonl.zstd     (419423 bytes)   ← 唯一的持久化日志（zstd 压缩）
│           └── session.lock              (0 bytes)        ← flock 写租约
├── storages/
│   ├── workspace.json                                     ← 工作区注册表（含归档集/置顶集）
│   ├── workspace.json.pre-migration
│   ├── workspace.json.pre-purge-20261006-004056           ← AM 清理时留的备份
│   ├── workspace.json.pre-purge-20261013-152807
│   ├── session_projcache/
│   │   └── sessions/session-015db59f-aaca-47cd-8944-81672dd6115f.json  ← 投影缓存（每会话一文件）
│   ├── session_projcache_archive_manager_v2/              ← AM 自己的第二套缓存域
│   │   └── sessions/session_<opaque-base64>.json
│   ├── dsh-session-colorful-unread-pin-jobs/
│   │   └── unread.json                                    ← 第三方插件的未读域
│   ├── mcp_connector.json
│   └── mcp_connector_grants_v1
├── attachments/                                           ← 附件对象存储（v1/objects/）
├── llm-deepseek/  cache/  task-board/  dsh-runtimes/  profiles/
```

### 1.2 路径规则与代码位置

| 项 | 值 | 证据 |
|---|---|---|
| cwd 编码 | `$WORKSPACE` → `--Users-leon-Z_AI_WorkSpace--`（`/` 替换为 `-`，两端补 `--`） | 实测 `sessions/` 目录名 |
| 日志路径 | `locate(meta) → { kind:"jsonl", path, ... }` | `asar:/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js:2416` |
| 压缩后缀 | `.jsonl.zstd`（Zstandard）/ `.jsonl`（明文） | 同上 `:745` |
| 写租约文件 | `const LEASE_FILENAME = "session.lock"`（POSIX `flock(2)` 非阻塞） | 同上 `:616`, `:643` |
| 单会话元信息 | `async stat(id, options)` → `:2536` | |
| 枚举全部会话 | `async list(options)` → `:2569` | |
| 持久化服务 | `class SessionPersistence extends Service`，`super(ctx, "sessionPersistence")`；**抽象基类，只有构造器** | `asar:/dsh/node_modules/@deepseek-ai/dsh-session-persistence/lib/index.js:261`, `:265` |
| 投影缓存域 | domain name = `"session_projcache"` | `asar:/dsh/node_modules/@deepseek-ai/dsh-session-projection-cache/lib/index.js` |
| 工作区域 | domain name = `"workspace"`, version `2` | `asar:/dsh/node_modules/@deepseek-ai/dsh-workspace/lib/index.js:246`；`storages/workspace.json` 内 `"unit":{"name":"workspace","version":2}` |

### 1.3 「一个会话」的全部数据

一个会话的数据分散在 **4 处**，删除时必须全部处理（详见 §3）：

1. **持久化日志**：`<DSH_HOME>/sessions/<enc(cwd)>/<sessionId>/session.v4.jsonl.zstd` + `session.lock`
2. **投影缓存**：`<DSH_HOME>/storages/session_projcache/sessions/<sessionId>.json`
3. **工作区注册表条目**：`storages/workspace.json` 里的 `archivedSessionIds[]` / `pinnedSessionIds[]`（**registry-global，不 per-workspace**）+ 各 workspace 实体的 `sessionIds[]`
4. **各插件自有存储域**：如 `storages/dsh-session-colorful-unread-pin-jobs/unread.json`、AM 的 `storages/session_projcache_archive_manager_v2/`

### 1.4 索引：**没有 sqlite**

- `find $HOME/.dsh -maxdepth 3 -name "*.db" -o -name "*.sqlite*"` → **无结果**。
- 宿主没有 sqlite 索引。列表来源是：
  - `ctx.sessionQuery.listSessions(signal)` — `asar:/dsh/node_modules/@deepseek-ai/dsh-session-query/lib/index.js:95`
  - 其内部是**内存** LRU 冷读缓存（`cacheCapacity` 默认 5，`cache = new Map()`，键为 `persistence.identity` + `revision`），**无落盘索引**：同文件 `:322-339`, `:419-424`
  - 真值来源是扫描 JSONL 存储的 header（`listStoredHeaders()`）
- 所以「删除后索引脏了」这个问题在宿主侧表现为：**投影缓存残留 + AM/workspace 的内存 header 索引残留**，不是 sqlite 行残留。

---

## 2. 归档(archive) / 置顶(pin)

### 2.1 服务与存储域

- 服务名：**`workspaceRegistry`**
  - `super(ctx, 'workspaceRegistry')` — `asar:/dsh/node_modules/@deepseek-ai/dsh-workspace/lib/index.js:113`
  - 类头注释：`Workspace entity registry ('ctx.workspaceRegistry')` — 同文件 `:2`
- 静态注入：`static inject = ['storageDomain', 'sessionPersistence']` — 同文件 `:93-94`
- 落盘：`<DSH_HOME>/storages/workspace.json`（domain `workspace` v2）
- 状态字段（zod schema）— `dsh-workspace/lib/index.js:246`：

```js
pinnedSessionIds: z.array(sessionId).default([]),
// 同层还有 archivedSessionIds: z.array(sessionId).default([])
```

> **重要**：`pinnedSessionIds` 是 **registry-global** 的（注释原文："the registry-global pin set in pin order (most recently pinned first); pinning and archival are mutually exclusive" — `dsh-workspace/lib/index.js:235-236`）。archive 集同样是 registry-global。

### 2.2 公开 API（精确签名）

| 方法 | 行号 | 语义 |
|---|---|---|
| `archiveSession(sessionId, options = {})` | `:525-540` | `options.stopActivity?: boolean` |
| `unarchiveSession(sessionId)` | `:545-560` | 只从归档集移除，不做存在性检查 |
| `get pinnedSessionIds(): string[]` | `:566` | 最近置顶在前 |
| `pinSession(sessionId)` | `:576` | 前插（`pinnedSessionIds: [sessionId, ...state.pinnedSessionIds]` — `:584`） |
| `unpinSession(sessionId)` | `:596` | |
| `async sessionKnown(id): Promise<boolean>` | `:612` | 活会话 → `ctx.sessions.get(id)`；否则查 header 索引 |
| `async stopSessionActivity(sessionId)` | `:619-621` | `await this.ctx.parallel("workspace/session-stop", { sessionId })` |

**互斥规则**（两条，都有专门的错误类型）：

- 归档会**丢掉 pin**：`archivedSessionIds: [..., sessionId], pinnedSessionIds: state.pinnedSessionIds.filter(id => id !== sessionId)` — `:536`
- pin 一个已归档的会话 → 抛错（":321 A pinSession request named a session currently in the archive set; pinning and archival are mutually exclusive."）

### 2.3 `archiveSession` 的活动闸门（重要）

```js
// dsh-workspace/lib/index.js:525-540（节选）
if (options.stopActivity !== true) {
  const activity = await this.ctx.waterfall(
    "workspace/session-activity", { sessionId }, () => Promise.resolve([])
  );
  if (activity.length > 0) throw new WorkspaceActiveSessionError(sessionId, activity);
}
const state = this.requireState();
await this.setState({
  ...state,
  archivedSessionIds: [...state.archivedSessionIds, sessionId],
  pinnedSessionIds: state.pinnedSessionIds.filter((id) => id !== sessionId)
});
if (options.stopActivity === true) await this.stopSessionActivity(sessionId);
```

- 错误类型：`class WorkspaceActiveSessionError extends Error { sessionId; activity; }`，`activity: SessionActivity[]`（`entry.kind`）— `dsh-workspace/lib/index.js:302-317`
- 未知会话错误：`WorkspaceUnknownSessionError` — `:286-301`
- 归档集本身是 `agent/pre-step` 闸门的读取源，所以带 `stopActivity` 归档时，停止动作诱发的唤醒已被拦住（注释 `:511-524`）
- AM 的 UI 正是靠这个拒绝错误做"停止并归档"二次确认（`archives.archiveActive` = "会话仍在运行（{kinds}）"）

### 2.4 archive-manager 怎么读写它们

- **写入走官方**：AM 客户端调用 `ctx.workspaces.archiveSession(sessionId, options)`（宿主侧官方服务），自己不直接写 `workspace.json`。
- **读取走官方快照**：`P.workspaces.list?.getSnapshot?.()?.archivedSessionIds`（`lib/client.js` 的 `archiveSessionsViaOfficial` / `unarchiveSessionsViaOfficial`）。
- **AM 自己的增强**：`host-install.js` 的 `inject = ["workspaceRegistry", "sessionProjectionCache", "typert"]`；它**替换/覆盖**这两个服务实现，从而拿到：
  - `sessionProjectionCache.delete()` / `.whenIdle()` / `.clearTombstone()`（宿主基类**没有**这些，见 §3.1）
  - workspaceRegistry 上的 `deleteSession` 等自定义方法
  - 覆盖后的实例用 `markRemoteMethod(instance, method)` 重新打上 Remote 标记（`lib/workspace.js:349-350`）

> 推断标注：AM 覆盖服务的具体 `ctx.provide(...)` 调用点本轮未逐行复核；但 `host-install.js` 的注入清单、子类专有方法（`delete`/`whenIdle`/`clearTombstone`）以及 `bindArchiveManagerRemote(this.ctx)`（`lib/workspace.js:350`）三者互相印证该覆盖机制存在。

---

## 3. 删除会话

### 3.1 宿主**没有**官方删除 API —— 三处反证

1. **持久化层**：`SessionPersistence` 是抽象基类，只有构造器与 `super(ctx, "sessionPersistence")`（`asar:/dsh/node_modules/@deepseek-ai/dsh-session-persistence/lib/index.js:261`, `:265`）。具体实现 `dsh-session-persistence-jsonl` 暴露的是 `locate`(`:2416`) / `stat`(`:2536`) / `list`(`:2569`)，**无 delete/remove**。
2. **投影缓存层**：`class SessionProjectionCache extends Service`（`asar:/dsh/node_modules/@deepseek-ai/dsh-session-projection-cache/lib/index.js:136`，`super(ctx, "sessionProjectionCache")`）的**完整方法集**是：
   `recordFor, cachedSnapshot, cachedPredecessorTitle, viewRecord, hydratePrepared, write, coldSnapshot, installWritePath, flushSoft, markClean, put, requireTable`
   —— **没有 `delete`**。它是 write-behind 写路径，不是删除路径。
3. **API 控制层**：`dsh-api-session-controller` 的 typert 暴露面共 **21 个方法**，全部列出：
   `fileReferences_list, session_attachment, session_canOpenWorkspacePath, session_cancel, session_control, session_create, session_follow, session_fork, session_initializeDefaultModel, session_list, session_modelCatalog, session_openWorkspacePath, session_page, session_projections, session_prompt, session_rename, session_search, session_selectModel, session_updateQueue, session_workspacePathApplications, skills_list`
   —— **没有 delete / remove / purge**。
   （来源：`asar:/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/typert.host.js` 的生成 schema 分组名）

> 结论：AM 的 `deleteSession` 是**它自己发明**的方法名（`lib/workspace.js:53-67` 的 `ARCHIVE_REMOTE_METHODS` 数组里含 `deleteSession`、`deleteArchivedSessions`），不是宿主 API。我们要实现同样的能力，必须自己写这套删除逻辑。

### 3.2 要安全删除会话，需要注入的服务

```js
static inject = ["sessions", "sessionPersistence", "sessionProjectionCache",
                 "workspaceRegistry", "sessionQuery", "typert", "storageDomain"];
```

| 服务 | 用途 | 关键方法 |
|---|---|---|
| `sessions`（会话运行时） | 结束活会话、flush、从运行时表摘除 | `flush(session)` `:1832`、`liveEntryFor(session)` `:1851`、`detachEntered(entry)` `:1767`、`get(id)`、`enter/announce` `:1734/:1782`（`asar:/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js`） |
| `sessionPersistence` | 定位日志文件 | `locate(meta) → {kind,path}`、`stat(id)`、`list()` |
| `sessionProjectionCache` | 清投影缓存 | 基类**无 delete**；需自建（见 §3.3 第 4 步） |
| `workspaceRegistry` | 清归档集 / 工作区成员 | `unarchiveSession`、`sessionKnown`、内部 `setState` |
| `sessionQuery` | 清内存 header 索引（若自建索引需同步失效） | `listSessions(signal)` |

### 3.3 AM 的真实删除序列（逐步）

`lib/workspace.js:915-961`，`async deleteSessionCore(sessionId, descendantHeaders)` —— 这是**可直接照抄的顺序**：

```js
async deleteSessionCore(sessionId, descendantHeaders) {
  // ① 存在性检查：不存在则只清理归档残留，返回 { deleted: true, skipped: true }
  if (!await this.sessionKnown(sessionId)) {
    await this.cleanupUnknownArchivedSession(sessionId);
    return { deleted: true, skipped: true };
  }

  // ② 处理活会话：flush 落盘 → 从运行时表摘除
  const sessions = this.ctx.get("sessions");
  const live = sessions?.get(sessionId);
  const deletedHeader = this.headers.get(sessionId) ?? live?.header;   // 留作墓碑
  if (live !== void 0) {
    await sessions.flush(live);
    const entry = sessions.liveEntryFor(live);
    sessions.detachEntered(entry);
  } else if (sessions !== void 0) {
    await this.publishColdSessionRemoval(sessionId, sessions);         // 冷会话：伪造一次移除通知
  }

  // ③ 等投影缓存写路径静默，再删除该会话的缓存记录
  const projCache = this.ctx.get("sessionProjectionCache");
  await projCache?.whenIdle?.();
  if (projCache !== void 0) await projCache.delete(sessionId);

  // ④ 递归删除子代理（含仍在运行的）
  await this.deleteDescendants(sessionId, descendantHeaders);

  // ⑤ 清附件/spill 与日志目录
  await this.cleanSpill(sessionId);
  await this.removeTranscriptDirectory(sessionId);   // 删 <sessions>/<enc(cwd)>/<id>/

  // ⑥ 从归档集移除（只影响 archivedSessionIds，不动产工作区记账）
  const state = this.requireState();
  if (state.archivedSessionIds.includes(sessionId)) {
    await this.setState({ ...state,
      archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId) });
  }

  // ⑦ 从工作区成员表移除 + 从内存 header 索引遗忘
  await this.removeFromWorkspaceAccounts(sessionId);
  this.forgetIndexedSession(sessionId);

  // ⑧ 写墓碑（阻止"复活"/id 复用造成脏索引）
  if (deletedHeader !== void 0)
    this.deletedIdentities.set(sessionId, headerIdentity(deletedHeader));

  // ⑨ 广播给所有客户端
  this.publishDeletedSession(sessionId);
  return { deleted: true };
}
```

**关键辅助与配套**：

- `headerIdentity(header)` = `{ createdAt: header.createdAt, cwd: header.cwd ?? null }` — `lib/workspace.js:81-86`。墓碑记的是**身份**而不是 id，因为「session id 命名的是槽位，不是生命周期」。
- `publishDeletedSession(sessionId)` — `lib/workspace.js:962-970`：
  ```js
  try { this.ctx.emit("api-session/removed", sessionId); }
  catch (error) { this.ctx.logger.warn(`archive-manager: session "${sessionId}" deleted but removal notification failed: ${String(error)}`); }
  ```
- `clearTombstone(sessionId)` — `lib/workspace.js:975+`：清 `deletedSessionIds` / `deletedIdentities` / `deletedSessionOrder`。**同 id 的活会话重新出现时会撤掉墓碑**（自定义 id 复用场景）。
- 批量删除在 `deleteSession` 之上再包一层操作链：`deleteSession(sessionId)` = `enqueueOperation(() => deleteSessionCore(...))` → `{ deleted: true }`（`lib/workspace.js:915-921`）。批量返回 `{ requestedSessionIds, deletedSessionIds, skippedSessionIds }`（schema `deletedBatchSchema`，`lib/workspace.js:130+`）。

### 3.4 如何避免留下悬挂索引

| 悬挂点 | 处理 |
|---|---|
| 投影缓存文件残留 | 先 `whenIdle()` 等写路径静默，再 `delete(sessionId)`（顺序不能反，否则写回会重建缓存） |
| 内存 header 索引残留 | `forgetIndexedSession(sessionId)`，并让后续 `indexHeaders()` 不再加回（靠墓碑） |
| id 复用导致旧会话数据被"认领" | 墓碑存 `{createdAt, cwd}` 身份而非裸 id；活会话同 id 再现时 `clearTombstone` |
| 归档集残留 | `archivedSessionIds.filter(...)` 显式移除（宿主 `unarchiveSession` 也可） |
| 工作区成员残留 | `removeFromWorkspaceAccounts(sessionId)` |
| 子代理变成孤儿 | `deleteDescendants(sessionId, ...)` 递归删除（含运行中的） |
| 客户端 UI 不刷新 | `ctx.emit("api-session/removed", sessionId)` |
| 日志目录残留 | `removeTranscriptDirectory(sessionId)` |
| 操作中途被打断 | 整个删除包在 AM 的串行操作链 `enqueueOperation` 里 |

### 3.5 风险清单

1. **无官方 API ⇒ 无版本兼容承诺**。`sessionProjectionCache.delete()` 在宿主基类不存在，是 AM 自己加的；我们若照抄，同样要让自己的实现能承受宿主升级后写入路径变化。**建议：删除能力做成"尽力而为 + 失败可诊断"**（AM 的做法也是返回 `{deleted, skipped, failed}` 三态，而不是全或无）。
2. **`removeTranscriptDirectory` 是物理删除，不可恢复**。AM 在 `workspace.json` 侧留了 `.pre-purge-*` 备份文件，但会话日志本身没有备份。
3. **删除运行中的会话有竞态**。必须先停活动（agent turn / jobs / subagents），否则：
   - agent 会在日志被删后继续 append → 重建文件
   - 写路径可能把投影缓存写回
   宿主侧停止活动的正确入口是 `ctx.parallel("workspace/session-stop", { sessionId })`（`dsh-workspace/lib/index.js:621`），它会触发所有 provider 的停止逻辑。
4. **`sessions.detachEntered(entry)` 会拒绝替换**（注释 `:1769` "enter() rejects replacement while this single-shot detach capability is live"），不要在 detach 期间重入。
5. **冷会话（不在运行时）也要发移除通知**，否则客户端列表不会更新 —— 这是 `publishColdSessionRemoval` 存在的原因（注释：新版不再通过伪造冷会话生命周期触发通知）。

---

## 4. 会话状态信号

### 4.1 权威 DTO：`session_list` 的 item

宿主给客户端的会话摘要**就是这个对象**，由 `ApiSessionList.summaryFor(session)` 生产：

```js
// asar:/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js:1870-1882
summaryFor(session) {
  const projections = this.projectionsFor(session.header, session);
  const metadata = projections?.values.sessionListMetadata;
  return {
    sessionId: session.id,
    updatedAt: updatedAt(session.header, metadata),
    agentAvailable: this.ctx.agents.get(session.id)?.session === session,
    running: this.ctx.agents.get(session.id)?.status === "running",   // ← 运行中判定
    blank: metadata?.blank ?? session.seq === 0,
    ...listFields(session.header),
    ...(projections === void 0 ? {} : { projections })
  };
}
```

冷会话版本 `summarizeCold(header)`（`:1903-1914`）固定 `agentAvailable: false, running: false`。

`listFields(header)`（同文件，`listFields` 函数）：

```js
function listFields(header) {
  return {
    ...(header.parentSession === void 0 ? {} : { parentSessionId: header.parentSession }),
    ...(header.origin === void 0 ? {} : { origin: header.origin }),   // "subagent"
    ...(header.cwd === void 0 ? {} : { cwd: header.cwd })
  };
}
```

`list(signal)`（`:1885-1900`）：`await this.ctx.sessionQuery.listSessions(signal)` → 活会话用 `summaryFor`，冷会话要求 `header.cwd !== undefined` 才纳入 → 最后按 `updatedAt` 降序排序。

**完整字段表**（来自 typert 生成 schema `_deepseek_ai_dsh_api_session_controller_session_list_result$schema`，`asar:/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/typert.host.js`）：

```ts
{
  items: Array<{
    agentAvailable: boolean
    sessionId: string
    updatedAt: number
    running: boolean                      // ★ 运行中
    blank: boolean
    parentSessionId?: string
    origin?: "subagent"
    cwd?: string
    projections?: {
      kind: "cached" | "sequenced"
      asOfSeq: number
      values: {
        inbox?: { "next-turn": JsonValue[]; "next-step": JsonValue[] }   // ★ 排队待发送
        agentPreset?: string | null
        title?: string | null
        todos?: Array<{ content: string; status: "completed"|"pending"|"in_progress" }>
        sessionListMetadata?: { blank: boolean; lastPromptAt: number | null }
        imageLimits?: {...}
        modelSelection?: { lastUsed: {...} | null; next: {...} | null }
        permissions?: { currentValue: string }
        subagentCatalog?: Array<{ id; createdAt } & ({mode:"one-shot"} | {mode:"continuable"} | {mode:"unknown"})>
        subagentTiming?: { settledMs: number; active?: { since: number; through: number }; lastTurnCompleted?: boolean }
        subagent?: { mode: "one-shot"|"continuable"; label?: string; seq: number } | null
        goal?: { goal: { objective; phase: "active"|"paused"|"blocked"|"complete";
                         blockedReason?: { code; message }; maxGoalRounds; id; revision };
                 roundsStarted; createdAt; updatedAt } | null
        userQuestions?: {                                              // ★ 等待用户
          active: Array<{
            callId: string
            questions: Array<{
              id: string; question: string; detail?: string; header?: string
              options?: Array<{ label: string; description?: string }>
              multiSelect?: boolean
              intent?: { kind: "plan-review"; approve: string; callId?: string }   // ★ 计划待审
            }>
            state: "open" | "continued"
          }>
          settled: Array<{ callId: string; answers: Array<{ id; selected: string[]; custom?: string }> }>
        }
        [extraProjectionKey: string]: JsonValue     // 其它 projection 单元自行注册的键
      }
    }
  }>
}
```

> `values` 是一个 **`z.intersection(已知键对象, z.record(string, JsonValue))`** —— 即内核列出的只是已知 projection 单元，插件注册的 projection 单元会以额外键出现在同一 `values` 里。这对「状态点」很有利：**我们可以注册自己的 projection 键**，直接搭宿主的车送到客户端，而不必另开事件通道。

### 4.2 四条状态线的判定

| 状态 | 判定表达式 | 数据来源 |
|---|---|---|
| **运行中** | `summary.running === true` | `ctx.agents.get(id)?.status === "running"`（`dsh-api-session-controller/lib/index.js:1876`） |
| **等待用户输入** | `summary.projections.values.userQuestions.active.length > 0`（元素 `state === "open"`） | 同上 DTO |
| **等待审批 / 计划待审** | `...active[].questions[].intent?.kind === "plan-review"` | 同上 DTO |
| **排队中** | `projections.values.inbox["next-turn"].length + inbox["next-step"].length > 0` | 同上 DTO |
| **子代理运行** | `projections.values.subagentCatalog?.length` 或 `subagentTiming.active !== undefined`；`subagentTiming.lastTurnCompleted` | 同上 DTO |
| **本轮报错** | 最后一个 `turn/end` 事件的 `data.reason.kind === "error"` | 见 §4.3 |
| **已完成** | `data.reason.kind === "completed"` | 见 §4.3 |
| **被用户中止** | `data.reason.kind === "aborted"`（`reason.reason` 是 cancel cause） | 见 §4.3 |
| **被拦截** | `data.reason.kind === "blocked"`（`preStep` 返回 `{kind:"reject"}`） | 见 §4.3 |
| **token 用尽** | `data.reason.kind === "max-tokens"` | 见 §4.3 |

### 4.3 「报错」的权威判定 —— `turn/end` 的 `reason`

这是本次调研**最关键的发现**。会话事件里**没有** `turn/error` 这种事件类型；错误是通过 **`turn/end` 事件的 `data.reason` 载荷**表达的。

**事件类型确实存在**：`turn/end` 与 `turn/start` 都在 host 的已知事件类型表里 ——
`asar:/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js:134`（该数组还含 `step/start`、`step/end`、`tool/call`、`tool/result`、`session/created`、`session/disposed`、`session/title`、`user/message`、`subagent/catalog`、`todo/write`、`workspace/changes` 等）。

**写入点**（唯一的 append 处）—— `asar:/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:1024-1029`：

```js
} finally {
  try {
    this.session.append("turn/end", { turn, reason: turnEnds });
  } catch (error) { this.throwError(error); }
}
```

**`turnEnds` 的全部取值**（同文件）：

| `reason.kind` | 行号 | 触发条件 |
|---|---|---|
| `"blocked"` | `:959` | `turnEnds = { kind: "blocked" }` —— `preStep()` 返回 `decision.kind === "reject"` |
| `"completed"` | `:964` | `turnEnds = { kind: "completed" }` —— 首步无可执行消息 |
| `"max-tokens"` | `:1151` | 与 `:1153/:1155` 的 `"completed"` 并列 |
| `"aborted"` | `:1012-1014` | `turnEnds = { kind: "aborted", reason: cause }` —— `abortedCancelCause(signal)` 有值，即用户/系统取消 |
| **`"error"`** | **`:1018-1023`** | 见下 |

```js
// dsh-agent-loop/lib/index.js:1016-1024
} catch (error) {
  const cause = abortedCancelCause(signal);
  if (cause !== void 0) {
    turnEnds = { kind: "aborted", reason: cause };
    throw error;
  }
  turnEnds = {
    kind: "error",
    error: error instanceof LlmError ? error.failure
                                     : { message: errorChain(error), code: "UNKNOWN" }
  };
  this.throwError(error);
}
```

> **判定「本轮失败」的精确规则**：
> 取该会话事件日志中**最后一个** `turn/end` 事件 `E`：
> - `E.data.reason.kind === "error"` → **失败**，细节在 `E.data.reason.error.message` / `.code`（LLM 错误时是 `LlmError.failure` 结构）
> - `E.data.reason.kind === "aborted"` → 用户主动中止（不要显示成"报错"）
> - `E.data.reason.kind === "blocked"` → 被 gate 拦截
> - `E.data.reason.kind === "completed"` / `"max-tokens"` → 正常结束
>
> 注意 `turn/end` 在**崩溃恢复**路径上也会被合成写入（`openTurnClosers(events, cause)`，`asar:/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js:748-796`，末尾 `reason: { kind: cause.kind }`），所以"最后一个 `turn/end`"在异常关闭后依然可用。

**另一个更轻量的错误信号**（进程级，不需要读日志）：

```js
// asar:/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js:2887-2889
ctx.on("agent/error", ({ agent, error }) => {
  ctx.emit("api-session/error", agent.id, errorChain(error));
});
```

以及会话提升失败时：`this.ctx.emit("api-session/error", sessionId, result.error.message)` —— 同文件 `:2899+`。

### 4.4 宿主 → 客户端事件族 `api-session/*`

**声明与发射点全部在 `asar:/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js`**：

```js
// :2873-2875
ctx.on("session/created", (session) => {
  ctx.emit("api-session/added", this.listState.summaryFor(session));
});
// :2876-2878
ctx.on("session/disposed", (session) => {
  ctx.emit("api-session/removed", session.id);
});
// :2879-2883  agent/created | agent/disposed → 重新发 added（刷新 agentAvailable）
const publishAgentAvailability = ({ agent }) => {
  if (ctx.sessions.get(agent.id) === agent.session)
    ctx.emit("api-session/added", this.listState.summaryFor(agent.session));
};
// :2884-2886  ★ 运行中状态
ctx.on("agent/status", ({ agent, status }) => {
  ctx.emit("api-session/status", agent.id, status === "running");
});
// :2887-2889  ★ 报错状态
ctx.on("agent/error", ({ agent, error }) => {
  ctx.emit("api-session/error", agent.id, errorChain(error));
});
// :2890-2897  ★ 活跃时间戳（仅真实用户消息）
ctx.on("session/event", (session, event) => {
  if (event.type === "request/header") { /* ...model selection 记账... */ }
  if (event.type !== "user/message" || event.data.source.kind !== "user") return;
  ctx.emit("api-session/activity", session.id, event.time);
});
```

| 事件名 | 载荷 | 行号 |
|---|---|---|
| `api-session/added` | `(summary)` — §4.1 的对象 | `:2874`, `:2880` |
| `api-session/removed` | `(sessionId: string)` | `:2877` |
| `api-session/status` | `(sessionId: string, running: boolean)` | `:2885` |
| `api-session/error` | `(sessionId: string, message: string)` | `:2888`, `:2899+` |
| `api-session/activity` | `(sessionId: string, time: number)` | `:2896` |

（`grep -oE "api-session/[a-z-]+"` 于该文件命中：`:2874 api-session/added`、`:2877 api-session/removed`、`:2885 api-session/status`、`:2888 api-session/error`、`:2896 api-session/activity`。）

> **这就是「状态点」的最佳宿主数据源**：`api-session/status`（布尔 running）+ `api-session/error`（字符串错误）+ `session_list` 的 `userQuestions`（等待用户）+ `turn/end.reason`（权威结束态）。

### 4.5 `workspace/session-activity` 瀑布（聚合"还有活在跑"）

宿主用一套**瀑布 + 并行**事件来回答"这个会话还有没有未完成的活"，归档闸门依赖它。

**调用点** — `asar:/dsh/node_modules/@deepseek-ai/dsh-workspace/lib/index.js:519`：

```js
const activity = await this.ctx.waterfall(
  "workspace/session-activity", { sessionId }, () => Promise.resolve([])
);
// 停止：
await this.ctx.parallel("workspace/session-stop", { sessionId });   // :621
```

**返回类型** `SessionActivity[]`，各 provider 返回的 `kind` 与形状（按 listener 顺序前置）：

| provider 包 | 行号 | 返回 |
|---|---|---|
| `@deepseek-ai/dsh-agent` | `lib/index.js:27-33` | `[{ kind: "turn" }, ...rest]`，条件 `lookup(sessionId)?.status === "running"`（注释明确："a turn waiting for an approval or an answer included"） |
| `@deepseek-ai/dsh-jobs` | `lib/index.js:20-27` | `[{ kind: "job", items: jobs.map(j => ({ id: j.id, label: j.label })) }, ...rest]` |
| `@deepseek-ai/dsh-subagent` | `lib/index.js:2244-2250` | `[{ kind: "subagent", items: await Promise.all(running.map(child => describe(ctx, child))) }, ...rest]` |
| `@deepseek-ai/dsh-schedule` | `lib/index.js:2682` | 定时任务 |

`workspace/session-stop` 的三家实现：
- agent：`agent.cancel({ kind: "user" })`（不带 stop 按钮的 `keepInbox`，队列输入会被丢弃并记一次 inbox splice）
- jobs：`registry.kill(job.id, sessionId, "session archived")`
- subagent / schedule：各自停止

> 对我们的关键价值：**「这个会话有没有在跑」不需要自己拼** —— 直接调 `ctx.waterfall("workspace/session-activity", {sessionId}, () => Promise.resolve([]))`，非空即有活动，且 `kind` 告诉你是什么活动（turn / job / subagent / schedule）。AM 的 `status.subagentsRunning`、`archives.archiveActive`（"会话仍在运行（{kinds}）"）就是这么来的。

### 4.6 状态词汇表（AM 客户端词典，可作 UI 语义参照）

来源 `$HOME/.dsh/profiles/desktop/node_modules/@michengai/dsh-archive-manager/lib/client.js`（`zh`/`en`/`ru` 词典对象）：

| key | zh | en |
|---|---|---|
| `status.running` | 进行中 | Running |
| `status.subagentsRunning.one/.other` | {n} 个子代理运行中 | {n} subagent(s) running |
| `status.idle` | 空闲 | Idle |
| `status.waitingApproval` | 等待审批 | Waiting for approval |
| `status.planReview` | 计划待审 | Plan awaiting review |
| `status.waitingAnswer` | 等待回答 | Waiting for answer |
| `status.completed` | 已完成 | Completed |

---

## 5. 未读（标记为未读 / 已读）

### 5.1 宿主**没有**未读/已读概念

全链路核对结果：

- `session_list` 的 item（§4.1 完整字段表）**没有** `unread` / `read` / `seen` / `lastReadAt` 之类字段。
- `dsh-session`、`dsh-session-persistence`、`dsh-session-projection-cache`、`dsh-workspace`、`dsh-api-session-controller` 均无该语义。
- 最接近的宿主字段是 `projections.values.sessionListMetadata.lastPromptAt: number | null`（上次提问时间）与 `item.updatedAt`，**只能近似推算，不能表达"用户已读"**。

> ⇒ 未读状态必须由插件**自己持久化**。

### 5.2 自持久化 API：Storage Domain（`ctx.storageDomain`）

宿主提供的通用 KV/表存储，把数据落到 `<DSH_HOME>/storages/<domain-name>/`。

**API 位置** — `asar:/dsh/node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js`：

| 符号 | 行号 | 说明 |
|---|---|---|
| `function defineDomain(spec)` | `:61` | 校验 `spec.name` 匹配 `UNIT_NAME_RE`、`spec.version` 为非负整数、`compatibleVersions` 各项 < version 等 |
| `async open(spec)` | `:355` | 打开域，返回 facility |
| `backend.kv.open(descriptorOf(spec))` | `:362` | KV 后端 |
| `domainCtx.provide("storageDomain", facility)` | `:450` | 服务注入 |

**宿主的真实用法样例（最标准的骨架）** — `asar:/dsh/node_modules/@deepseek-ai/dsh-session-projection-cache/lib/index.js:139-158`：

```js
var SessionProjectionCache = class extends Service {
  static inject = ["storageDomain", "sessionProjections", "sessions"];
  static Config = Config;
  table;
  dirty = new Map();
  constructor(ctx, config) {
    super(ctx, "sessionProjectionCache");
    this.config = config;
  }
  /** Open the domain and install the write-behind listeners. */
  async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(projectionCacheDomainSpec);
    this.ctx.effect(() => () => domain.close(), "sessionProjectionCache.domainClose");
    this.table = domain.table("sessions");
    this.installWritePath();
  }
  // ...
  async put(id, identity, rows) { /* this.requireTable() ... */ }   // :214
  async flushSoft(session, trigger) { /* ... */ }                   // :196
};
```

要点：
- `static inject = ["storageDomain", ...]`
- 在 `async [Service.init]()` 里 `await this.ctx.storageDomain.open(spec)`
- 用 `this.ctx.effect(() => () => domain.close(), "<label>")` 绑定生命周期
- 拿 `domain.table("sessions")` 当表用（也可 `domain.kv.open(...)`）

### 5.3 未读持久化推荐方案

**方案 A（推荐）—— 独立 storage domain + 自注册 projection 键**：

1. 建自己的域，例如 `defineDomain({ name: "dsh-session-menu-unread", version: 1, ... })` → 落盘 `<DSH_HOME>/storages/dsh-session-menu-unread/…`。这直接复刻 `dsh-session-colorful-unread-pin-jobs` 的做法。
2. **同时**注册一个 projection 单元（`ctx.inject(["sessionProjections"], ...)` → `sessionProjections.register(definition)`，见 `asar:/dsh/node_modules/@deepseek-ai/dsh-session-projection/lib/index.js:52`, `:68`），把未读标记投射到 `session_list` 的 `projections.values.<yourKey>`。这样未读状态**搭宿主的车**直达客户端，无需自建事件通道，且能跨设备/重连自愈。
   - 注意 `register()` 会校验 `stateVersion` 为非负整数、同 key 不同 `stateVersion` 会报错（同文件 `:81`, `:91`）；`onChanged()` 在 `:116`。
3. 读侧：`session_list` 的 `projections.values` 是 `z.intersection(已知键对象, z.record(string, JsonValue))`，自定义键会原样出现在里面（§4.1），客户端可直接读。

**方案 B（最省事）—— 纯自域，不走 projection**：只用 storage domain 存 `{ ids: string[], settings: {...} }`，客户端通过自己的 typert remote 方法拉取。AM 就是这么管"收藏"的（`favoriteSessions` / `setSessionFavorite` remote 方法，`lib/workspace.js:53-67`）。

**实例参考文件** `$HOME/.dsh/storages/dsh-session-colorful-unread-pin-jobs/unread.json`：

```json
{
  "version": 2,
  "updatedAt": 1792079795921,
  "ids": ["session-18d7071c-1f9a-4715-9622-9a144b6f26d4"],
  "settings": { "clearOnSend": false }
}
```

### 5.4 `dsh-session-colorful-unread-pin-jobs` 这个域名是怎么来的

- 它是**第三方插件自取的 domain name**，通过 `defineDomain({ name: "dsh-session-colorful-unread-pin-jobs", ... })` 注册 —— **不是宿主保留前缀**。宿主只做格式校验（`UNIT_NAME_RE`，见 `dsh-storage-domain/lib/index.js:61` 起）。
- 它属于 **cordis Storage Domain** 这一层插件 API（`ctx.storageDomain`），落盘规律就是 `<DSH_HOME>/storages/<domain name>/<你的文件名>.json`。
- 命名含义可从字面推断：`colorful`（会话着色）+ `unread`（未读）+ `pin`（置顶）+ `jobs`（后台任务）—— 即一个把四种能力合并到一个存储域的第三方插件。
- 该插件与本项目功能高度重叠，**建议立项时先找它**（在 `profiles/*/node_modules` 里按上面的域名 grep 即可定位）。
  > 不确定项：本轮在 `$HOME/.dsh/profiles/*/node_modules` 下 `grep -rl "dsh-session-colorful-unread-pin-jobs"` **未命中**任何文件（可能是域名字符串运行时拼接、或插件装在其他位置）。**归属未确认**，只确认了域文件与命名规则。

---

## 6. 宿主插件 ↔ 客户端插件的桥

### 6.1 typert 三件套

| 包 | 职责 |
|---|---|
| `@deepseek-ai/dsh-typert-protocol` | 共享协议：`Remote` 装饰器、wire 描述符、codec、provider 契约 |
| `@deepseek-ai/dsh-typert-registry` | 注册表与查询表；提供 cordis 服务 **`typert`** |
| `@deepseek-ai/dsh-typert-loader` | 加载 generated face 模块（如 `lib/typert.host.js` / `lib/typert.remote-client.js`） |

- 装饰器描述符键：`const REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";` —— `asar:/dsh/node_modules/@deepseek-ai/dsh-typert-protocol/lib/index.js:135`（原型上存放 Remote 方法集）
- 服务获取两种写法（AM 都用了）：
  - `ctx.get("typert")`
  - `ctx.inject(["typert"], (typertCtx) => { typertCtx.typert.register(FACE); })`

### 6.2 宿主注册骨架（照抄 AM `lib/workspace.js`）

**① 声明 face 描述符** — `:245-251`：

```js
const ARCHIVE_MANAGER_TYPERT = {
  package: "@michengai/dsh-archive-manager",
  face: "host",
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: ARCHIVE_MANAGER_INVOCATIONS
};
```

**② 注册（容忍重复）** — `:252-260` 与 `:262-278`：

```js
function registerHostRemote(ctx) {
  const existing = ctx.get("typert");
  if (existing !== void 0) { existing.register(ARCHIVE_MANAGER_TYPERT); return; }
  ctx.inject(["typert"], (typertCtx) => { typertCtx.typert.register(ARCHIVE_MANAGER_TYPERT); });
}

function bindArchiveManagerRemote(ctx) {
  const typert = ctx.get("typert");
  if (typert === void 0 || typeof typert.register !== "function")
    throw new Error("archive-manager: typert is unavailable");
  try {
    const dispose = typert.register(ARCHIVE_MANAGER_TYPERT);
    return typeof dispose === "function" ? () => { dispose(); } : () => {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("already registered")) throw error;   // 幂等
    return () => {};
  }
}
```

**③ 单个 invocation 描述符** — `:195-205`（`deleteSession` 为例）：

```js
{
  id: "@michengai/dsh-archive-manager#workspaceRegistry/deleteSession",
  service: "workspaceRegistry",        // 宿主 cordis 服务名
  namespace: "workspaceRegistry",      // 客户端 remote.<namespace>
  method: "deleteSession",
  invocation: { kind: "direct" },
  parameters: [{
    name: "sessionId", wire: "sessionId", source: "json",
    codec: strictCodec("@deepseek-ai/dsh-session/types#SessionId", sessionIdSchema)
  }],
  result: strictCodec("@michengai/dsh-archive-manager/types#Deleted", deletedSchema),
  sourceLocation: { file: "@michengai/dsh-archive-manager/lib/workspace.js", line: 1, column: 1 }
}
```

**④ codec 工厂** — `:47-54`：

```js
function strictCodec(typeSymbol, schema) {
  return { mode: "strict", typeSymbol, create: () => schema, schema };
}
```

**⑤ 把宿主方法标成 Remote** — `:69-78`（手工驱动装饰器初始化器）：

```js
function markRemoteMethod(instance, method) {
  const context = {
    private: false, static: false, name: method,
    addInitializer(fn) { fn.call(instance); }
  };
  Remote(method)(function() {}, {
    ...context, kind: "method",
    access: { has: (value) => method in value, get: (value) => Reflect.get(value, method) },
    metadata: void 0
  });
}
```

调用点 — `:349-350`：

```js
for (const method of ARCHIVE_REMOTE_METHODS) markRemoteMethod(this, method);
registerHostRemote(this.ctx);
```

方法清单 — `:53-67`：
`unarchiveSession, deleteSession, deleteArchivedSessions, archivedSessionMetadata, favoriteSessions, setSessionFavorite, searchArchivedContent, searchSessionContent, previewArchivedSession, sessionDetails, diagnoseSession, repairSession`

（另有 `:1249 markRemoteMethod(raw, method)`，用于第二套实例。）

### 6.3 客户端调用骨架（照抄 AM `lib/client.js`）

**插件注入与挂载**：

```js
// 客户端插件导出
export const inject = ["slots", "sessions", "workspaces", "locale", "remote", "typert"];
export async function apply(ctx) {
  const remote = ctx.get("remote");
  const dispose = remote !== undefined ? await remote.$mount(ARCHIVE_MANAGER_REMOTE) : () => {};
  return async () => { await dispose(); };
}
```

> `ARCHIVE_MANAGER_REMOTE` 是**客户端侧**对同一 face 的声明对象（AM 在 `r.__test` 里导出为 `ARCHIVE_MANAGER_REMOTE: k`），`remote.$mount(...)` 把它挂到远端注册表。

**惯用调用包装**（AM 的 `registryCall`，可直接照抄）：

```js
const registryCall = async (method, ...args) => {
  const reg = ctx.get("remote.workspaceRegistry");
  if (!reg || typeof reg[method] !== "function")
    throw new Error(ctx.locale.bind(NS)("service.unavailable"));
  const res = await reg[method](...args);
  if (!res.ok) throw new Error(res.error.message);
  return res.value;
};
const sessionDetails = (id) => registryCall("sessionDetails", id);
const deleteSession  = (id) => registryCall("deleteSession",  id);
```

**直接调用形态**：

```js
const reg = ctx.get("remote.workspaceRegistry");
const res = await reg.deleteSession(sessionId);
if (!res.ok) throw new Error(res.error.message);
```

> **返回值是 Result 信封**：`{ ok: true, value }` 或 `{ ok: false, error: { message } }`。**必须检查 `res.ok`**，否则拿到的是信封而不是数据。

### 6.4 命名空间从哪来

- 客户端句柄 = `remote.<invocation.namespace>`。AM 里 `namespace` 与 `service` 都填宿主服务名（`"workspaceRegistry"`）。
- **不是包名**：包名只出现在 `invocation.id` 前缀里（`@michengai/dsh-archive-manager#workspaceRegistry/deleteSession`）。
- ⇒ 一个客户端可以调用任何已注册宿主服务的 method，只要 namespace/service 对得上。

### 6.5 鉴权 / 权限

- **未发现针对 typert host remote 方法的权限门**。没有 `authorization` 服务、没有 grant、没有 capability 检查参与 `typert.register` 或 `remote.$mount` 路径。
- `dsh-api-session-controller` 里 `authorization` 一词只出现在**附件访问**语境：
  - `:908` `@param request - Session and attachment identities used for authorization.`
  - `:917` `throw new RemoteError("gateway/internal", \`attachment authorization unavailable for session "${request.sessionId}": ...\`)`
  与插件调用权限无关。
- 全机唯一的 grants 存储域是 `storages/mcp_connector_grants_v1`，那是 **MCP 工具治理**用的，与 typert remote 无关。
- ⇒ **任何已安装的宿主/客户端插件都能自由注册与调用 remote 方法**。安全边界 = "用户安装了这个插件"本身。

> 标注：以上为「在 asar 内检索未命中」的结论（no gate found），不等于宿主绝对无校验；但至少不存在需要插件显式申请/授权才能暴露 remote 方法的机制。

### 6.6 宿主 → 客户端的事件通道

- 宿主侧发射：`ctx.emit("<event>", ...)`（AM：`this.ctx.emit("api-session/removed", sessionId)`，`lib/workspace.js:965`）
- 宿主侧订阅：`ctx.on("<event>", handler)`，例如 `ctx.on("session/event", (session, event) => {...})`（`dsh-api-session-controller/lib/index.js:2890`）、`ctx.on("agent/status", ({agent, status}) => {...})`（`:2884`）
- `api-session/*` 五个事件的**唯一声明/发射处**是 `asar:/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js`（`added :2874`、`removed :2877`、`status :2885`、`error :2888`、`activity :2896`）—— 它们是**客户端可见**的推送通道，正是状态点需要的。
- 客户端侧还可订阅 slot 变化：`ctx.on("slots/changed", (name) => {...})`（AM `lib/client.js`）

### 6.7 备选桥：webServer 路由

AM 同时用了一条普通 HTTP 路由做插件自更新：

- 客户端：`pk({ endpoint: "/api/michengai/dsh-archive-manager/update", packageName: "@michengai/dsh-archive-manager", titleRowSelector: ".dsham_settingsTitleRow", linksSelector: ".dsham_settingsLinks", zhName: "归档会话", enName: "Archived sessions", ... })`
- 宿主：`lib/plugin-updater.js` 注册 `GET /api/michengai/dsh-archive-manager/update`
- 宿主插件因此注入 `webServer`

> 仅作参考：状态点/未读这类高频交互**应走 typert remote + `api-session/*` 事件**，不要用 HTTP 轮询。

---

## 7. 可直接照抄的骨架汇总

### 7.1 宿主插件入口

```js
// host-install.js
export const inject = ["workspaceRegistry", "sessionProjectionCache", "typert",
                       "sessions", "sessionPersistence", "storageDomain", "sessionProjections"];
```

### 7.2 判定"会话在跑什么"

```js
const activity = await ctx.waterfall(
  "workspace/session-activity", { sessionId }, () => Promise.resolve([])
);
// activity: SessionActivity[] —— [{kind:"turn"}, {kind:"job",items:[{id,label}]},
//                                 {kind:"subagent",items:[...]}, ...schedule]
const isBusy = activity.length > 0;
```

### 7.3 判定"本轮报错"

```js
// 方案 A：读事件日志（权威，含细节）
function lastTurnOutcome(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "turn/end") continue;
    const r = e.data?.reason;
    // r.kind: "completed" | "blocked" | "aborted" | "error" | "max-tokens"
    return { kind: r?.kind, message: r?.error?.message, code: r?.error?.code };
  }
  return null;
}
const failed = lastTurnOutcome(events)?.kind === "error";

// 方案 B：订阅进程级错误事件（轻量，但无细节）
ctx.on("agent/error", ({ agent, error }) => {
  // 对应客户端可见的 ctx.emit("api-session/error", agent.id, errorChain(error))
});
```

### 7.4 归档 / 置顶

```js
// 归档（带停止活动）
await ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: true });
// 归档（检测到活动就拒绝 → 交给 UI 二次确认）
try {
  await ctx.workspaceRegistry.archiveSession(sessionId);
} catch (e) {
  if (e instanceof WorkspaceActiveSessionError) {
    // e.activity: SessionActivity[]，e.activity.map(x => x.kind)
  }
}
await ctx.workspaceRegistry.unarchiveSession(sessionId);

// 置顶
await ctx.workspaceRegistry.pinSession(sessionId);     // 已归档会抛错
await ctx.workspaceRegistry.unpinSession(sessionId);
const pinned = ctx.workspaceRegistry.pinnedSessionIds; // 最近置顶在前
```

### 7.5 自持久化（未读）

```js
import { defineDomain } from "@deepseek-ai/dsh-storage-domain";

class UnreadStore extends Service {
  static inject = ["storageDomain"];
  table;
  constructor(ctx) { super(ctx, "sessionMenuUnread"); }
  async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(UNREAD_DOMAIN_SPEC);
    this.ctx.effect(() => () => domain.close(), "sessionMenuUnread.domainClose");
    this.table = domain.table("sessions");   // 落盘 <DSH_HOME>/storages/<domain>/…
  }
}
```

### 7.6 typert 注册 + 客户端调用

见 §6.2 / §6.3（face 描述符 → `ctx.typert.register(FACE)` → `markRemoteMethod` → 客户端 `ctx.get("remote").$mount(...)` → `ctx.get("remote.<namespace>").<method>(...)` 并检查 `res.ok`）。

---

## 8. 坑与不确定项

### 已确认的坑

1. **删除没有官方 API**，`sessionProjectionCache.delete()` 在宿主基类**不存在**（基类方法是 write-behind 写路径）。必须自建，且要处理"删完又被写回"。
2. **写路径 vs 删除的顺序**：必须 `await projCache.whenIdle()` **之后**才 `delete()`，否则 write-behind 会把缓存重建。
3. **`turn/end` 而不是 `turn/error`**：错误判定藏在 `data.reason.kind === "error"`，没有独立错误事件类型。且 `aborted`（用户主动停）**不应**显示为报错。
4. **投影缓存键是"槽位"不是"生命周期"**：注释原文 "A session id names a slot, not a lifecycle"。所以墓碑要比对 `{createdAt, cwd}` 身份，id 复用时要 `clearTombstone`。
5. **pin 与 archive 互斥**，且都会互相清除 —— UI 上置顶/归档不应同时点亮；归档**静默丢掉 pin**（`:536`）。
6. **`pinnedSessionIds` / `archivedSessionIds` 是 registry-global**，不是 per-workspace。若要做"按工作区置顶"，宿主没有现成位置，得自建存储域。
7. **没有 sqlite**，别去找 `.db`；"索引"= 投影缓存 JSON + 内存 header 缓存。
8. **remote 调用返回 Result 信封** `{ok, value|error}`，不检查 `res.ok` 会拿到错的东西。
9. **客户端句柄的 namespace 是 `invocation.namespace`**（AM 用宿主服务名），不是包名。
10. **归档已归档的会话会静默返回**（`if (archivedSessionIds.includes(id)) return;`），取消归档未归档的同样静默 —— 不要依赖异常做状态判断。
11. **`sessions.detachEntered(entry)` 期间 `enter()` 会拒绝替换**（单次 detach 能力存活期内），删除活会话时注意不要重入。
12. **冷会话必须单独发移除通知**（`publishColdSessionRemoval`），否则客户端列表不刷新。

### 不确定 / 本轮未验证

- **`dsh-session-colorful-unread-pin-jobs` 的归属插件未定位**（在 `profiles/*/node_modules` grep 该字符串无命中）。域文件与命名规则已确认，属主未确认。**建议立项后先找到它，避免重复造轮子或与之冲突**（尤其是它可能已经在管 unread + pin + jobs）。
- AM 覆盖 `workspaceRegistry` / `sessionProjectionCache` 服务的**具体 `ctx.provide(...)` 调用点**未逐行复核（机制由 `host-install.js` 注入清单 + 子类专有方法 + `bindArchiveManagerRemote(this.ctx)` 三方印证）。
- AM 客户端侧 `ARCHIVE_MANAGER_REMOTE`（客户端 face 声明对象）的**完整字面量**未提取（`lib/client.js` 是 1MB 压缩产物，仅确认了引用点 `remote.$mount(k)` 与 `r.__test.ARCHIVE_MANAGER_REMOTE` 导出）。
- `api-session/*` 事件在**客户端**侧的订阅写法未从 AM 代码中直接取到样例（AM 有自己的客户端 store，未走这条通道）。需要时可在 `dsh-api-session-controller/lib/client.js`（144KB）里查客户端订阅实现。
- typert 的 **codec / schema 是否强制**未验证：AM 全部用 `mode: "strict"`；宽松模式（`schemas: []`、`model: {services:[],events:[],objects:[]}` 能为空数组）说明存在非严格路径，但为稳妥建议一律 strict。

### 对下一步的建议

1. **状态点**：宿主数据源已完全够用 —— `api-session/status`（布尔）+ `api-session/error`（字符串）+ `session_list.projections.values.userQuestions`（等待用户/计划待审）+ `turn/end.data.reason`（结束态）+ `workspace/session-activity`（在跑什么）。优先订阅 `api-session/*`，不要轮询。
2. **未读**：宿主没有 ⇒ 自建 storage domain；**强烈建议同时注册一个 session projection 键**，让未读标记随 `session_list` 一起送达客户端（省掉一套事件同步）。
3. **置顶**：官方 `pinSession` 已有，先用官方；只有"按工作区置顶"才需要自建存储。
4. **删除**：这是唯一的硬骨头。照抄 §3.3 的九步序列 + §3.4 的悬挂点表格，并在动刀前先 `ctx.parallel("workspace/session-stop", {sessionId})` 停止活动。
