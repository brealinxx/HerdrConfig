// No host calls at module scope. The injected host also permits real-Git tests.
export const PAGE_SIZE = 30;
export const FILE_LIMIT = 1000;
const READ = ["--no-pager", "--no-optional-locks", "--literal-pathspecs",
  "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false",
  "-c", "core.quotePath=false", "-c", "log.showSignature=false", "-c", "color.ui=false"];
const DIFF = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--no-relative", "--submodule=short"];

export function clip(text, limit) {
  return text.length > limit ? text.slice(0, limit) + " … [truncated]" : text;
}

// Escape display controls only; never change the path passed to Git.
export function label(text) {
  return String(text).replace(/[\x00-\x1f\x7f]/g, c => c === "\n" ? "\\n" : c === "\t" ? "\\t" : c === "\r" ? "\\r" : "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0"));
}

function fields(text) {
  if (!text) return [];
  if (!text.endsWith("\0")) throw new Error("Incomplete Git output (host limit: 8 MiB). Narrow the query.");
  return text.slice(0, -1).split("\0");
}

export function parseHistory(text) {
  const parts = fields(text), result = [];
  if (parts.length % 4) throw new Error("Incomplete history records.");
  for (let i = 0; i < parts.length; i += 4) {
    if (!/^[0-9a-f]{40,64}$/.test(parts[i])) throw new Error("Invalid commit record.");
    result.push({ oid: parts[i], author: clip(parts[i + 1], 200), time: parts[i + 2], subject: clip(parts[i + 3], 500) });
  }
  return result;
}

export function parseNames(text) {
  const parts = fields(text), result = [];
  if (parts.length % 2) throw new Error("Incomplete changed-file list.");
  for (let i = 0; i < parts.length; i += 2) {
    if (!/^[ACDMTUXB]$/.test(parts[i]) || !parts[i + 1]) throw new Error("Invalid file status.");
    result.push({ status: parts[i], path: parts[i + 1], group: "diff" });
  }
  return result;
}

export function parseStatus(text) {
  const result = [];
  for (const entry of fields(text)) {
    if (entry.length < 4 || entry[2] !== " ") throw new Error("Incomplete worktree status.");
    const xy = entry.slice(0, 2), path = entry.slice(3);
    if (xy === "??") result.push({ group: "untracked", status: "?", path });
    else if (xy.includes("U") || xy === "AA" || xy === "DD") result.push({ group: "conflict", status: xy, path });
    else {
      if (xy[0] !== " ") result.push({ group: "staged", status: xy[0], path });
      if (xy[1] !== " ") result.push({ group: "unstaged", status: xy[1], path });
    }
  }
  return result;
}

export function preview(text) {
  const charLimit = 200000, lineLimit = 1500, columnLimit = 2000;
  let limited = text.length > charLimit;
  let rows = text.slice(0, charLimit).replace(/\n$/, "").split("\n");
  limited = limited || rows.length > lineLimit;
  rows = rows.slice(0, lineLimit).map(row => {
    if (row.length > columnLimit) limited = true;
    return clip(row.replace(/\r$/, ""), columnLimit).replace(/\t/g, "    ");
  });
  return { rows, note: limited ? "Preview truncated: 200,000 characters / 1,500 lines / 2,000 characters per line." : "" };
}

export class RequestGate {
  constructor() { this.version = 0; }
  invalidate() { this.version++; }
  begin(key) { return { key, version: ++this.version }; }
  accepts(token, key) { return token.key === key && token.version === this.version; }
}

export function locate(spaces, panes, focus, previous) {
  const space = spaces.find(s => s.id === focus?.space) || spaces.find(s => s.active);
  const tab = focus && space && focus.space === space.id ? focus.tab : space?.tabs?.find(t => t.active)?.id;
  const same = !!previous && !!space && previous.space === space.id && previous.tab === tab;
  const pane = panes.find(p => p.pane === focus?.pane && p.terminal);
  const remembered = same ? panes.find(p => p.terminal === previous.terminal && p.tab === tab) : null;
  const fallback = panes.find(p => p.tab === tab && p.terminal && p.cwd);
  const terminal = focus?.terminal || pane?.terminal || remembered?.terminal || (same ? previous.terminal : null) || fallback?.terminal;
  const cwd = (focus?.terminal ? focus.cwd : null) || pane?.cwd || remembered?.cwd || (same ? previous.cwd : null) || fallback?.cwd || space?.folder || "";
  const on = terminal ? (terminal.includes("/") ? terminal.split("/")[0] : null) : space?.machine ?? null;
  return { space: space?.id ?? null, tab: tab ?? null, terminal: terminal ?? null, cwd, on };
}

export function locationKey(location) {
  return JSON.stringify([location.space, location.tab, location.cwd, location.on]);
}

export class GitReader {
  constructor(exec, readText, location, stillCurrent = () => true) {
    this.exec = exec; this.readText = readText; this.location = location; this.stillCurrent = stillCurrent;
  }
  async git(args, allowed = [0]) {
    if (!this.stillCurrent()) throw new Error("Stale request.");
    const r = await this.exec("git", [...READ, ...args], { cwd: this.location.cwd, on: this.location.on, timeout: 20000 });
    if (!this.stillCurrent()) throw new Error("Stale request.");
    // exec has an 8 MiB combined output ceiling. Fail closed near that boundary,
    // even when a clipped -z output happens to end on a complete record.
    let bytes = 0;
    for (const c of r.stdout + r.stderr) {
      const n = c.codePointAt(0); bytes += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4;
    }
    if (bytes >= 8 * 1024 * 1024 - 4096) throw new Error("Git output reached the host 8 MiB limit. Incomplete results withheld; narrow the query.");
    if (!allowed.includes(r.code)) throw new Error(clip(r.stderr || r.stdout || `Git exit code ${r.code}`, 1500));
    return r;
  }
  async repository() {
    const top = await this.git(["rev-parse", "--show-toplevel"]);
    // Strip only Git's terminating newline. A root may itself contain whitespace.
    const root = top.stdout.replace(/\r?\n$/, "");
    this.location = { ...this.location, cwd: root };
    const branch = await this.git(["symbolic-ref", "--quiet", "--short", "HEAD"], [0, 1]);
    const head = await this.git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], [0, 1]);
    return { root, branch: branch.code === 0 ? branch.stdout.replace(/\r?\n$/, "") : `detached ${head.stdout.trim().slice(0, 12)}`, head: head.code === 0 ? head.stdout.trim() : null };
  }
  async history(head, page, message, path) {
    if (!head) return { commits: [], more: false };
    const args = ["log", ...DIFF, "--encoding=UTF-8", "--format=%H%x00%an%x00%aI%x00%s", "-z",
      `--max-count=${PAGE_SIZE + 1}`, `--skip=${page * PAGE_SIZE}`];
    if (message) args.push("--fixed-strings", "--regexp-ignore-case", `--grep=${message}`);
    args.push(head, "--");
    if (path) args.push(path);
    const all = parseHistory((await this.git(args)).stdout);
    return { commits: all.slice(0, PAGE_SIZE), more: all.length > PAGE_SIZE };
  }
  async worktree() {
    return parseStatus((await this.git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--ignore-submodules=none"])).stdout);
  }
  async commit(oid) {
    const r = await this.git(["show", ...DIFF, "--no-patch", "--encoding=UTF-8", "--format=%P%x00%B", oid, "--"]);
    const separator = r.stdout.indexOf("\0");
    if (separator < 0) throw new Error("Incomplete commit details.");
    const parents = r.stdout.slice(0, separator).trim().split(" ").filter(Boolean);
    const base = parents[0] || null;
    const spec = { kind: "commit", base, tip: oid };
    return { spec, files: await this.names(spec), message: clip(r.stdout.slice(separator + 1), 12000),
      note: parents.length > 1 ? "Merge commit: first-parent diff only." : base ? "Changes against the parent commit." : "Root commit: changes against the empty tree." };
  }
  async resolve(ref) {
    if (!ref.trim() || ref.length > 1024 || /[\0\r\n]/.test(ref)) throw new Error("Enter a valid ref (up to 1,024 characters).");
    const r = await this.git(["rev-parse", "--verify", "--end-of-options", `${ref.trim()}^{commit}`]);
    const oid = r.stdout.trim();
    if (!/^[0-9a-f]{40,64}$/.test(oid)) throw new Error("Ref did not resolve to a single commit.");
    return oid;
  }
  async compare(a, b, mode) {
    let base = await this.resolve(a);
    const tip = await this.resolve(b);
    if (mode === "merge-base") {
      const r = await this.git(["merge-base", "--all", base, tip], [0, 1]);
      const bases = r.stdout.trim().split(/\r?\n/).filter(Boolean);
      if (!bases.length) throw new Error("The refs have no common ancestor.");
      if (bases.length !== 1) throw new Error("Multiple merge bases found. Use endpoint with an explicit ancestor.");
      base = bases[0];
    }
    const spec = { kind: "compare", base, tip };
    return { spec, files: await this.names(spec), note: `${mode}: ${base.slice(0, 12)} → ${tip.slice(0, 12)}` };
  }
  diffArgs(spec, patch) {
    const args = spec.base ? ["diff", ...DIFF, spec.base, spec.tip] : ["diff-tree", ...DIFF, "--root", "--no-commit-id", "-r", spec.tip];
    args.push(...(patch ? ["-p", "--unified=3", "--src-prefix=a/", "--dst-prefix=b/"] : ["--name-status", "-z"]));
    return args;
  }
  async names(spec) { return parseNames((await this.git([...this.diffArgs(spec, false), "--"])).stdout); }
  async file(file, spec) {
    if (file.group === "untracked") {
      if (!this.stillCurrent()) throw new Error("Stale request.");
      const text = await this.readText(`${this.location.cwd}/${file.path}`, { on: this.location.on });
      if (!this.stillCurrent()) throw new Error("Stale request.");
      if (text === null || text.includes("\0")) return preview("Untracked file: binary, over the 1 MiB host text limit, deleted, or unreadable.");
      const result = preview(text);
      result.rows = result.rows.map(line => "+" + line);
      result.note = "Current untracked contents (not an index snapshot). " + result.note;
      return result;
    }
    const args = file.group === "diff" ? this.diffArgs(spec, true) : ["diff", ...DIFF, "--unified=3", "--src-prefix=a/", "--dst-prefix=b/", ...(file.group === "staged" ? ["--cached"] : [])];
    const result = preview((await this.git([...args, "--", file.path])).stdout || "No text diff (the file may have changed; refresh).");
    if (file.group === "conflict") result.note = "Unmerged conflict: Git combined diff; no resolve actions. " + result.note;
    return result;
  }
}
