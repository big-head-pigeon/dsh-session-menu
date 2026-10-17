/**
 * Host half: the `sessionMenuStatus` session projection, permanent session deletion (DSH only ships archive,
 * there is no delete API), and the developer application list for "Open with" (terminals / Xcode do not
 * register with Launch Services, so the official list does not carry them).
 */
import { execFile } from "node:child_process";
import { access, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

/** Protocol key of the remote method markers; the `@Remote` decorator also just writes the same descriptor onto the service prototype, so the handwritten equivalent marker needs no decorator syntax. */
const REMOTE_METHODS_KEY = "@deepseek-ai/dsh-typert-protocol/remote-methods";

/** How many sessions one batch delete handles at most: the cap only guards against an accidentally huge list, it does not limit normal use. */
const BATCH_LIMIT = 500;

/** Cache lifetime of the developer application list: installing a new editor should not require an app restart, but the disk should not be probed on every menu open either. */
const APPLICATION_CACHE_MS = 10 * 60 * 1000;

/**
 * The developer application list for "Open with" (defaults); the order is the menu order: editors / IDEs →
 * AI assistants → terminals.
 *
 * The official `workspacePathApplications` does not list terminals, Xcode and the like, which are not
 * registered; this list can be overridden wholesale by `config.applications` (see `cordis.patch.yml`), and
 * falls back to these defaults when the config is unusable.
 */
const DEFAULT_DEVELOPER_APPS = [
  ["editor", ["/Applications/Visual Studio Code.app", "/Applications/Visual Studio Code - Insiders.app"]],
  ["editor", ["/Applications/Cursor.app"]],
  ["editor", ["/Applications/Windsurf.app"]],
  ["editor", ["/Applications/Zed.app"]],
  ["editor", ["/Applications/Xcode.app", "/Applications/Xcode-beta.app"]],
  ["editor", ["/Applications/IntelliJ IDEA.app", "/Applications/IntelliJ IDEA CE.app"]],
  ["editor", ["/Applications/WebStorm.app"]],
  ["editor", ["/Applications/PyCharm.app", "/Applications/PyCharm CE.app"]],
  ["editor", ["/Applications/GoLand.app"]],
  ["editor", ["/Applications/CLion.app"]],
  ["editor", ["/Applications/Android Studio.app"]],
  ["editor", ["/Applications/Sublime Text.app"]],
  ["editor", ["/Applications/Nova.app"]],
  ["editor", ["/Applications/TextMate.app"]],
  ["editor", ["/Applications/BBEdit.app"]],
  /*
   * Claude and ChatGPT both declare `public.folder`, but they are not on the system list path (their names do
   * not match the client-side filter regex), so they are probed explicitly here to place them between the
   * IDEs and the terminals.
   */
  ["ai", ["/Applications/Claude.app"]],
  ["ai", ["/Applications/ChatGPT.app"]],
  ["terminal", ["/System/Applications/Utilities/Terminal.app"]],
  ["terminal", ["/Applications/iTerm.app", "/Applications/iTerm2.app"]],
  ["terminal", ["/Applications/Warp.app"]],
  ["terminal", ["/Applications/Ghostty.app"]],
  ["terminal", ["/Applications/kitty.app"]],
  ["terminal", ["/Applications/Alacritty.app"]],
  ["terminal", ["/Applications/WezTerm.app"]],
  ["terminal", ["/Applications/Hyper.app"]],
  ["terminal", ["/Applications/Tabby.app"]]
];

/**
 * Normalize the application list from plugin config into `[kind, paths[]]`: the config comes from the cordis
 * patch layer and is untrusted input, so entries with the wrong shape are dropped; when the whole thing is
 * unusable it returns undefined so the caller falls back to the default list (better a default than an
 * entirely empty "Open with" because of one misspelled field).
 *
 * @param value - the value of `config.applications`.
 * @returns the normalized list, or undefined.
 */
function normalizeApplications(value) {
  if (!Array.isArray(value)) return void 0;
  const normalized = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const kind = typeof entry.kind === "string" && entry.kind !== "" ? entry.kind : "editor";
    const candidates = Array.isArray(entry.paths) ? entry.paths : [];
    const paths = candidates.filter((path) => typeof path === "string" && path.trim() !== "");
    if (paths.length === 0) continue;
    normalized.push([kind, paths]);
  }
  return normalized.length === 0 ? void 0 : normalized;
}

/** Ask the system for display names and icons of applications in one batch (32×32 PNG data URL); only the system knows the localized names, so an unreadable result returns an empty table and the client falls back to its own glyphs. */
const DESCRIBE_SCRIPT = `ObjC.import('AppKit');
function run(argv) {
  var workspace = $.NSWorkspace.sharedWorkspace;
  var manager = $.NSFileManager.defaultManager;
  var out = [];
  for (var i = 0; i < argv.length; i++) {
    var path = argv[i];
    var name = ObjC.unwrap(manager.displayNameAtPath(path));
    var image = null;
    try {
      var icon = workspace.iconForFile(path);
      var thumbnail = $.NSImage.alloc.initWithSize($.NSMakeSize(32, 32));
      thumbnail.lockFocus;
      icon.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, 32, 32), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1);
      thumbnail.unlockFocus;
      var bitmap = $.NSBitmapImageRep.imageRepWithData(thumbnail.TIFFRepresentation);
      var png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
      image = png.isNil() ? null : 'data:image/png;base64,' + ObjC.unwrap(png.base64EncodedStringWithOptions(0));
    } catch (error) {
      image = null;
    }
    out.push({ path: path, name: name, icon: image });
  }
  return JSON.stringify(out);
}`;

/**
 * Whether the path exists.
 * @param path - absolute path.
 * @returns whether it exists.
 */
async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Probe which developer applications are installed on this machine (both `/Applications` and `~/Applications`).
 * @param applications - the `[kind, paths[]]` list; the order is the menu order.
 * @returns `[{ id, name, kind }]`, where `id` is the absolute .app path.
 */
async function probeDeveloperApps(applications) {
  const home = join(homedir(), "Applications");
  const found = [];
  for (const [kind, candidates] of applications) {
    for (const candidate of candidates) {
      const located = (await pathExists(candidate)) ? candidate : join(home, basename(candidate));
      if (await pathExists(located)) {
        found.push({ id: located, name: basename(located, ".app"), kind });
        break;
      }
    }
  }
  return found;
}

/**
 * Ask for display names and icons in a single osascript batch.
 * @param paths - array of .app paths.
 * @returns `[{ path, name, icon }]`; an empty array on failure.
 */
function describeApplications(paths) {
  return new Promise((done) => {
    if (paths.length === 0) return done([]);
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", DESCRIBE_SCRIPT, ...paths],
      { timeout: 8000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) return done([]);
        try {
          const parsed = JSON.parse(String(stdout).trim());
          if (!Array.isArray(parsed)) return done([]);
          return done(parsed.filter((entry) => typeof entry?.path === "string"));
        } catch (_error) {
          return done([]);
        }
      }
    );
  });
}

/**
 * Open a directory with the given application: `open -a`, without validating the Launch Services registry.
 * @param application - .app path or application name.
 * @param target - an already verified absolute path.
 * @returns an empty string on success, otherwise the error text shown to the client.
 */
function openWithApplication(application, target) {
  return new Promise((done) => {
    execFile("/usr/bin/open", ["-a", application, target], { timeout: 8000 }, (error, _stdout, stderr) => {
      if (error === null) return done("");
      const message = String(stderr ?? "").trim() || String(error?.message ?? error);
      return done(message);
    });
  });
}

/** The projection state for "this turn had no error". */
function idleStatus() {
  return { phase: "idle", message: "" };
}

/** Projection state schema: session-projection only uses `parse()` to validate cached and wire values, so no schema library is needed. */
const statusSchema = {
  parse(value) {
    if (value === null || typeof value !== "object") return idleStatus();
    return {
      phase: typeof value.phase === "string" && value.phase !== "" ? value.phase : "idle",
      message: typeof value.message === "string" ? value.message : ""
    };
  }
};

/**
 * Session menu status projection: `turn/start` resets it, `turn/end` records the outcome; the red dot lights
 * up only for `phase === "error"`, while `blocked` / `max-tokens` / `aborted` / `interrupted` / `forked` are
 * not errors (see DESIGN.md §4.4).
 */
const sessionMenuStatusProjection = {
  key: "sessionMenuStatus",
  stateVersion: 1,
  stateSchema: statusSchema,
  init: () => idleStatus(),
  apply(state, event) {
    if (event === null || typeof event !== "object") return state;
    if (event.type === "turn/start") return idleStatus();
    if (event.type !== "turn/end") return state;
    const reason = event.data?.reason;
    if (reason === null || typeof reason !== "object") return state;
    return {
      phase: typeof reason.kind === "string" && reason.kind !== "" ? reason.kind : "aborted",
      message: typeof reason.error?.message === "string" ? reason.error.message : ""
    };
  },
  wire: { viewSchema: statusSchema, view: (state) => state }
};

/**
 * Mark a prototype method as remote (equivalent to `@Remote("deleteSession")`, but without decorator syntax).
 * @param prototype - the service prototype.
 * @param method - the name of the method to expose.
 */
function markRemoteMethod(prototype, method) {
  const current = prototype[REMOTE_METHODS_KEY];
  const methods = current !== null && typeof current === "object" && Array.isArray(current.methods) ? current.methods : [];
  Object.defineProperty(prototype, REMOTE_METHODS_KEY, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([
        ...methods.filter((entry) => entry?.method !== method),
        Object.freeze({ method, invocation: Object.freeze({ kind: "direct" }) })
      ])
    })
  });
}

/**
 * Host service for permanent session deletion; the service key is also the wire namespace (client side
 * `ctx.remote.sessionMenu.*`).
 *
 * **Every failure carries a translatable `code`** (`session-id-required` / `session-ids-required` /
 * `batch-failed` / `path-unverified` / `application-required` / `open-failed`); the English sentence in
 * `error` is only a fallback, and a successful return value has no `code`.
 */
class SessionMenuService extends TypertRemoteService {
  /** Declare only the services that are actually used; cordis waits for them when they are missing. */
  static inject = ["sessions", "sessionPersistence", "sessionQuery", "workspaceRegistry", "sessionProjections"];

  constructor(ctx, config) {
    super(ctx, "sessionMenu");
    /** The application list used by "Open with" (`[kind, paths[]]`); falls back to the built-in defaults when the config omits it or is malformed. */
    this.developerApps = normalizeApplications(config?.applications) ?? DEFAULT_DEVELOPER_APPS;
  }

  /**
   * The platform the host runs on (remote entry): the client uses it to decide what "Reveal in Finder" is
   * called — the open action runs on the **host** machine, which may differ from the browser machine when the
   * Web UI is accessed remotely, so the host platform is what counts.
   *
   * @returns `process.platform`: `darwin` / `win32` / `linux` / …
   */
  hostPlatform() {
    return process.platform;
  }

  /**
   * Permanently delete one session (remote entry); this **also deletes its subagent sessions** (recursively):
   * sub-sessions sit next to their parent on disk, so deleting the parent directory does not touch them, and the
   * orphans left behind would surface as top-level rows on the client.
   *
   * @param sessionId - session id.
   * @returns `{ ok, removed, error }`; on failure there is an extra translatable `code` (see the class comment);
   *          `removed=false` means the session did not exist in the first place (idempotent).
   */
  async deleteSession(sessionId) {
    const id = typeof sessionId === "string" ? sessionId.trim() : "";
    if (id === "") return { ok: false, removed: false, code: "session-id-required", error: "session id is required" };
    const outcome = await this.removeSession(id);
    if (!outcome.ok || !outcome.removed) return outcome;
    const children = (await this.collectSubtree(id)).slice(1);
    if (children.length === 0) return outcome;
    const batch = await this.deleteSessions(children);
    /* The parent session is already gone, so the main goal is met; when a few child sessions survive, only the count is recorded and `ok` stays unchanged. */
    return batch.failed === 0 ? outcome : { ...outcome, failed: batch.failed };
  }

  /**
   * Collect a session together with all of its subagent sessions (recursive, breadth first).
   *
   * The disk layout is `<root>/<project directory>/<session id>`, and a child session is a **sibling directory**
   * of its parent (the header points back via `parentSession`), so `rm -rf` on the parent directory never
   * touches them.
   *
   * @param id - root session id.
   * @returns the id list, whose first entry is always the input itself.
   */
  async collectSubtree(id) {
    const ids = [id];
    try {
      const records = await this.ctx.sessionQuery.listSessions();
      const childrenOf = new Map();
      for (const record of records ?? []) {
        const header = record?.header;
        if (typeof header?.id !== "string" || typeof header.parentSession !== "string") continue;
        const list = childrenOf.get(header.parentSession);
        if (list === void 0) childrenOf.set(header.parentSession, [header.id]);
        else list.push(header.id);
      }
      /* Expand and read at the same time, which handles multi-level delegation naturally (`delegationDepth` can be greater than 1). */
      for (let index = 0; index < ids.length; index += 1) {
        for (const child of childrenOf.get(ids[index]) ?? []) {
          if (!ids.includes(child)) ids.push(child);
        }
      }
    } catch (_error) {
      /* When the corpus cannot be read, delete only this session; better than deleting nothing at all. */
    }
    return ids;
  }

  /**
   * Permanently delete sessions in bulk (used by "Delete all archived sessions"); the same flow runs serially for
   * each one — detaching runtimes and deleting directories concurrently could collide with a flush of the same
   * session, and being slow does not matter. A single failure only counts towards `failed` and does not affect
   * the other sessions.
   *
   * @param sessionIds - array of session ids.
   * @returns `{ ok, deleted, failed, error }`; on failure there is an extra translatable `code`; a truthy `ok`
   *          means everything succeeded.
   */
  async deleteSessions(sessionIds) {
    if (!Array.isArray(sessionIds)) return { ok: false, deleted: 0, failed: 0, code: "session-ids-required", error: "session ids are required" };
    const ids = sessionIds
      .filter((value) => typeof value === "string" && value.trim() !== "")
      .map((value) => value.trim())
      .slice(0, BATCH_LIMIT);
    let deleted = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const outcome = await this.removeSession(id);
        /* `removed=false` means this id was already gone (idempotent) and should not count towards "deleted". */
        if (!outcome.ok) failed += 1;
        else if (outcome.removed) deleted += 1;
      } catch (_error) {
        failed += 1;
      }
    }
    if (failed > 0) return { ok: false, deleted, failed, code: "batch-failed", error: `${failed} session(s) could not be deleted` };
    return { ok: true, deleted, failed, error: "" };
  }

  /**
   * The developer application list for "Open with" (remote entry), complementary to the official
   * `workspacePathApplications`: the official one gives the applications registered as "can open a folder",
   * while this one gives common targets such as IDEs / terminals, which are usually not registered.
   *
   * @returns `[{ id, name, kind, icon }]`; `id` is the absolute .app path and `icon` may be an empty string.
   */
  async workspaceApplications() {
    const cached = this.applicationCache;
    if (cached !== void 0 && Date.now() - cached.at < APPLICATION_CACHE_MS) return await cached.pending;
    const pending = this.describeDeveloperApps();
    this.applicationCache = { at: Date.now(), pending };
    /* A failed probe (osascript blocked, say) should not be cached as an empty table for ten minutes. */
    pending.catch(() => {
      if (this.applicationCache?.pending === pending) this.applicationCache = void 0;
    });
    return await pending;
  }

  /**
   * Probe the developer applications on this machine and fill in display names and icons.
   * @returns `[{ id, name, kind, icon }]`.
   */
  async describeDeveloperApps() {
    const found = await probeDeveloperApps(this.developerApps);
    if (found.length === 0) return [];
    const described = await describeApplications(found.map((entry) => entry.id));
    const known = new Map(described.map((entry) => [entry.path, entry]));
    return found.map((entry) => ({
      id: entry.id,
      name: known.get(entry.id)?.name || basename(entry.id, ".app"),
      kind: entry.kind,
      icon: known.get(entry.id)?.icon ?? ""
    }));
  }

  /**
   * Open a directory with the given application (remote entry): the official `openWorkspacePath` validates
   * registration through Launch Services first, which turns away terminals and Xcode, whereas this goes straight
   * to `open -a` without checking the registry.
   *
   * @param path - the working directory of the session.
   * @param application - absolute .app path or application name.
   * @returns `{ ok, opened, error }`; on failure there is an extra translatable `code` (`open-failed` wraps the
   *          raw macOS text).
   */
  async openWorkspaceWith(path, application) {
    const target = await this.verifyWorkspacePath(path);
    if (target === void 0) return { ok: false, opened: false, code: "path-unverified", error: "path has no verified host path" };
    const app = typeof application === "string" ? application.trim() : "";
    if (app === "") return { ok: false, opened: false, code: "application-required", error: "application is required" };
    const failure = await openWithApplication(app, target);
    return failure === "" ? { ok: true, opened: true, error: "" } : { ok: false, opened: false, code: "open-failed", error: failure };
  }

  /**
   * The same path validation as the official one: it must map to a host path, and the round trip must be stable.
   * @param path - the path sent by the client.
   * @returns the normalized absolute path, or undefined.
   */
  async verifyWorkspacePath(path) {
    if (typeof path !== "string" || path.trim() === "") return void 0;
    const target = resolve(path.trim());
    const fs = this.ctx.get?.("fs");
    try {
      if (fs === void 0) {
        /* Without an fs service this degrades to "exists and is a directory"; the two are equivalent in the local desktop case. */
        const info = await stat(target);
        return info.isDirectory() ? target : void 0;
      }
      const mapped = fs.processPathFromHostPath(target);
      if (mapped === void 0) return void 0;
      const back = await fs.resolve(mapped);
      return fs.processPath(back) === target ? target : void 0;
    } catch (_error) {
      return void 0;
    }
  }

  /**
   * The full flow for deleting one session: stop activity → detach the runtime → delete the on-disk log → clear
   * the workspace ledger → notify the client.
   *
   * The runtime is detached before the files are deleted, so no flush can write the directory back during the
   * deletion.
   *
   * @param id - session id.
   * @returns `{ ok, removed, error }`; on failure it carries a translatable `code` (`path-unverified` /
   *          `remove-failed`); `removed=false` means the session did not exist in the first place (idempotent).
   */
  async removeSession(id) {
    const live = this.ctx.sessions.get(id);
    const header = live?.header ?? (await this.coldHeader(id));
    if (header === void 0) {
      await this.forget(id);
      return { ok: true, removed: false, error: "" };
    }

    await this.stopActivity(id, live);
    this.detachLive(live);
    const removed = await this.removeTranscript(header);
    if (!removed.ok) {
      /* Report the failure honestly when it cannot be deleted: neither the ledger nor the runtime is touched, so the user can retry. */
      return { ok: false, removed: false, code: removed.code, error: removed.error };
    }
    await this.forget(id);
    try {
      this.ctx.emit("api-session/removed", id);
    } catch (_error) {
      /* A failed notification does not change the delete result: the client stops seeing the session at the next list refresh at the latest. */
    }
    return { ok: true, removed: true, error: "" };
  }

  /**
   * Read the header of a non-live session.
   * @param id - session id.
   * @returns the header, or undefined.
   */
  async coldHeader(id) {
    try {
      const records = await this.ctx.sessionQuery.listSessions();
      for (const record of records ?? []) {
        if (record?.header?.id === id) return record.header;
      }
    } catch (_error) {
      /* Unreadable means it does not exist */
    }
    return void 0;
  }

  /**
   * Stop a running turn before deleting: detaching a session mid-turn would leave a half-written log.
   * @param id - session id.
   * @param live - the live session (skipped when absent).
   */
  async stopActivity(id, live) {
    if (live === void 0) return;
    const running = this.ctx.get("agents")?.get(id)?.status === "running";
    if (!running) return;
    try {
      /* cancel may return a promise; neither failure mode (throwing synchronously / rejecting) should bubble up as an unhandled rejection. */
      void Promise.resolve(this.ctx.sessionController?.cancel({ sessionId: id })).catch(() => {});
    } catch (_error) {
      /* Continue even when the cancel request fails: the next step, detaching the runtime, also prevents further writes. */
    }
    for (let tick = 0; tick < 30; tick += 1) {
      if (this.ctx.get("agents")?.get(id)?.status !== "running") return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Detach the session from the runtime: the `session/disposed` emitted by `detachEntered` is turned into
   * `api-session/removed` by api-session-controller, and the client row disappears right away.
   * @param live - the live session.
   */
  detachLive(live) {
    if (live === void 0) return;
    try {
      const entry = this.ctx.sessions.liveEntryFor(live);
      this.ctx.sessions.detachEntered(entry);
    } catch (error) {
      this.ctx.logger?.warn?.(`dsh-session-menu: detach failed for "${live.header.id}": ${String(error)}`);
    }
  }

  /**
   * Delete the session log directory: prefer the persistence service's `locate()`, otherwise scan one level under
   * `<root>/<project directory>/<session id>`.
   *
   * @param header - the session header.
   */
  async removeTranscript(header) {
    let directory = this.transcriptDirectory(header);
    if (directory === void 0) directory = await this.scanTranscriptDirectory(header);
    /* The directory name must match the session id verbatim before anything may be deleted — this is the only guard against deleting the wrong directory. */
    if (directory === void 0 || basename(directory) !== header.id) {
      return { ok: false, code: "path-unverified", error: `no verified directory for session "${header.id}"` };
    }
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      return { ok: false, code: "remove-failed", error: String(error) };
    }
    /*
     * Re-check after deleting: the jsonl write handle is only closed at agent teardown, and its next append / flush
     * runs `mkdir -p` and recreates the directory — so re-check a few times and report an honest failure when it is
     * still there, rather than reporting a fake "permanently deleted".
     */
    for (let tick = 0; tick < 3; tick += 1) {
      if (!(await pathExists(directory))) return { ok: true, directory };
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return { ok: false, code: "remove-failed", error: `directory "${directory}" came back after removal` };
  }

  /**
   * Compute the session directory through the persistence service's locator.
   * @param header - the session header.
   * @returns the directory path, or undefined.
   */
  transcriptDirectory(header) {
    const persistence = this.ctx.sessionPersistence;
    if (persistence === void 0 || typeof persistence.locate !== "function") return void 0;
    try {
      const located = persistence.locate({ id: header.id, cwd: header.cwd });
      if (typeof located?.path === "string" && located.path !== "") return dirname(located.path);
    } catch (_error) {
      /* Fall back to the scan */
    }
    return void 0;
  }

  /**
   * Fallback locator: scan one level of project directories under the persistence root.
   * @param header - the session header.
   * @returns the directory path, or undefined.
   */
  async scanTranscriptDirectory(header) {
    const root = this.ctx.sessionPersistence?.root;
    if (typeof root !== "string" || root === "") return void 0;
    try {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (basename(entry.name) !== entry.name) continue;
        const candidate = join(root, entry.name, header.id);
        const found = await stat(candidate).catch(() => void 0);
        if (found?.isDirectory() === true) return candidate;
      }
    } catch (_error) {
      /* Give up when the scan fails and let the caller deal with it */
    }
    return void 0;
  }

  /**
   * Clear leftovers from the workspace ledger (archived set / pinned set). Both calls are no-ops for an id that is
   * not in the set.
   * @param id - session id.
   */
  async forget(id) {
    for (const method of ["unarchiveSession", "unpinSession"]) {
      try {
        await this.ctx.workspaceRegistry?.[method]?.(id);
      } catch (_error) {
        /* A failed ledger cleanup does not affect the already deleted log; skip it */
      }
    }
  }
}

markRemoteMethod(SessionMenuService.prototype, "hostPlatform");
markRemoteMethod(SessionMenuService.prototype, "deleteSession");
markRemoteMethod(SessionMenuService.prototype, "deleteSessions");
markRemoteMethod(SessionMenuService.prototype, "workspaceApplications");
markRemoteMethod(SessionMenuService.prototype, "openWorkspaceWith");

/** The host services this plugin needs. */
export const inject = ["sessionProjections"];

/**
 * Register the plugin: session status projection + delete session service.
 * @param ctx - host plugin context.
 * @param config - plugin config; currently only `applications` (the "Open with" application list) is recognized.
 */
export function apply(ctx, config) {
  ctx.sessionProjections.register(sessionMenuStatusProjection);
  ctx.plugin(SessionMenuService, config ?? {});
}
