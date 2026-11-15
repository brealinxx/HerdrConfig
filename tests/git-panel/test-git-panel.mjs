import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import * as git from "../../herdr/mods/hcconfig-git/git.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(here, "../../herdr/mods/hcconfig-git");

function command(program, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const out = [], err = [];
    child.stdout.on("data", data => out.push(data)); child.stderr.on("data", data => err.push(data));
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }));
  });
}

async function unitTests(test, { repo, readText }) {
  await test("NUL paths, conflict status and explicit truncation", async () => {
    const name = "目录/换\n行\t 文件.txt";
    assert.equal(git.parseNames(`M\0${name}\0`)[0].path, name);
    assert.equal(git.parseStatus(` M ${name}\0`)[0].path, name);
    assert.equal(git.parseStatus(`UU ${name}\0`)[0].group, "conflict");
    assert.equal(git.label(name), "目录/换\\n行\\t 文件.txt");
    assert.throws(() => git.parseNames("M\0cut"), /Incomplete/); assert.throws(() => git.parseHistory("abc\0"));
    assert.ok(git.preview("line\n".repeat(2000)).note.includes("truncated"));
    assert.equal(git.preview("line\n".repeat(2000)).rows.length, 1500);
    assert.ok(git.preview("x".repeat(5000)).rows[0].includes("truncated"));
    const huge = new git.GitReader(async () => ({ code: 0, stdout: "x".repeat(8 * 1024 * 1024), stderr: "" }), readText, { cwd: repo });
    await assert.rejects(() => huge.worktree(), /8 MiB/);
  });
  await test("stale requests, project changes and remote ownership", async () => {
    assert.equal(git.locate([], [], null).cwd, "");
    const gate = new git.RequestGate(), old = gate.begin("A"), fresh = gate.begin("A");
    assert.equal(gate.accepts(old, "A"), false); assert.equal(gate.accepts(fresh, "B"), false);
    gate.invalidate(); assert.equal(gate.accepts(fresh, "A"), false);
    let release, current = true, started = 0;
    const slow = new git.GitReader(async () => { started++; return new Promise(resolve => { release = resolve; }); }, readText, { cwd: repo }, () => current);
    const request = slow.repository(); current = false;
    release({ code: 0, stdout: repo + "\n", stderr: "" });
    await assert.rejects(() => request, /Stale/); assert.equal(started, 1);
    const spaces = [{ id: "s", active: true, folder: "/base", machine: "remote", tabs: [{ id: "tab", active: true }] }];
    const focus = { space: "s", tab: "tab", pane: null, terminal: "other/t2", cwd: "/worktree" };
    const location = git.locate(spaces, [], focus);
    assert.equal(location.cwd, "/worktree"); assert.equal(location.on, "other");
    assert.equal(git.locate(spaces, [], { ...focus, terminal: null, cwd: null }, location).cwd, "/worktree");
    assert.equal(git.locate([{ ...spaces[0], id: "new", folder: "/new" }], [], null, location).cwd, "/new");
  });
}

async function controllerTests({ repo, empty, readExec, readText }) {
  let liveFolder = repo, held = null;
  const backgroundErrors = [];
  const exec = async (...args) => {
    if (held && held.match(args)) { const hold = held; held = null; await new Promise(resolve => { hold.release = resolve; }); }
    return readExec(...args);
  };
  const space = () => [{ id: "s", active: true, folder: liveFolder, machine: null, tabs: [{ id: "tab", active: true }] }];
  const focus = () => ({ space: "s", tab: "tab", pane: "p", terminal: "t1", cwd: liveFolder });
  const inputs = { new: ({ value = "" } = {}) => ({ value: () => value, set_value: v => { value = v; }, on: () => {}, focus: () => {} }) };
  const element = () => new Proxy({}, { get: (_target, name) => (...args) => {
    if (name === "when" && args[0]) args[1](element());
    return element();
  } });
  const source = (await fs.readFile(path.join(modPath, "main.js"), "utf8")).replace(/^import .*;\r?\n/gm, "").replace("export default class GitPanel", "return class GitPanel");
  const values = { View: class {}, div: element, v_flex: element, h_flex: element, InputState: inputs,
    Input: { new: element }, Scrollbar: { vertical: element },
    v_virtual_list: (_id, count, _height, _key, render) => { render({ start: 0, end: count }); return element(); },
    exec, readTextFile: readText, spaces: space, panes: () => [], focused: focus,
    theme: () => ({}), settings: () => ({}), nextCommand: () => new Promise(() => {}), ...git };
  const Panel = new Function(...Object.keys(values), source)(...Object.values(values));
  const cx = { focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {}, sleep: () => Promise.resolve(),
    spawn: callback => { const task = callback(cx); Promise.resolve(task).catch(e => backgroundErrors.push(e)); return task; } };
  const panel = new Panel(); panel.init({}, cx);
  const wait = async condition => {
    for (let n = 0; n < 500; n++) {
      if (backgroundErrors.length) throw backgroundErrors[0];
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Controller test timed out");
  };
  const idle = () => !panel.loading && !panel.detailLoading && !panel.fileLoading;
  await wait(() => panel.repo && idle()); panel.render(cx); assert.equal(panel.commits.length, 30);
  panel.command("next", cx); await wait(idle); assert.equal(panel.page, 1); panel.render(cx);
  panel.command("previous", cx); await wait(idle); assert.equal(panel.page, 0);
  panel.command("select-first", cx); await wait(idle); assert.ok(panel.selected); panel.render(cx);
  panel.command("worktree", cx); await wait(idle); assert.ok(panel.files.length); panel.render(cx);
  panel.command("select-first", cx); await wait(idle); assert.ok(panel.rows.length); panel.render(cx);
  panel.command("compare", cx); await wait(idle); panel.refA.set_value("HEAD~1"); panel.refB.set_value("HEAD");
  panel.command("run-compare", cx); await wait(idle); assert.ok(panel.spec); panel.render(cx);
  const hold = { match: args => args[1].includes("rev-parse") };
  held = hold; panel.command("refresh", cx); await wait(() => !!hold.release);
  liveFolder = empty; panel.render(cx); await wait(() => panel.repo?.head === null && idle());
  hold.release(); await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(path.resolve(panel.repo.root), path.resolve(empty)); assert.equal(panel.repo.head, null);
  assert.deepEqual(panel.files, []); assert.equal(panel.error, ""); panel.render(cx);
  panel.close(); assert.equal(panel.closed, true); assert.deepEqual(backgroundErrors, []);
}

export async function runTests() {
  const fixture = await fs.mkdtemp(path.join(here, ".fixture-"));
  const repo = path.join(fixture, "中文 repo"), empty = path.join(fixture, "empty"), linked = path.join(fixture, "linked worktree");
  const results = [], calls = [];
  const test = async (name, body) => { await body(); results.push(name); };
  const prepare = async (cwd, args) => {
    const r = await command("git", ["-c", "core.hooksPath=" + path.join(fixture, "no-hooks"), "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", ...args], cwd);
    assert.equal(r.code, 0, `${args.join(" ")}: ${r.stderr}`); return r.stdout.trim();
  };
  const readExec = async (program, args, options) => {
    assert.equal(program, "git"); assert.ok(Array.isArray(args));
    assert.ok(args.includes("--no-optional-locks")); assert.ok(args.includes("--literal-pathspecs"));
    const verb = args.find(a => ["rev-parse", "symbolic-ref", "log", "show", "status", "diff", "diff-tree", "merge-base"].includes(a));
    assert.ok(verb, `Unexpected Git command: ${args}`);
    if (["log", "show", "diff", "diff-tree"].includes(verb)) {
      assert.ok(args.includes("--no-ext-diff")); assert.ok(args.includes("--no-textconv"));
    }
    calls.push({ args: [...args], ...options });
    return command(program, args, options.cwd);
  };
  const readText = async file => {
    try { const data = await fs.readFile(file); return data.length > 1024 * 1024 ? null : data.toString("utf8"); }
    catch { return null; }
  };
  const readerAt = cwd => new git.GitReader(readExec, readText, { cwd, on: null });
  try {
    await fs.mkdir(repo); await fs.mkdir(empty); await fs.mkdir(path.join(fixture, "no-hooks"));
    for (const cwd of [repo, empty]) {
      await prepare(cwd, ["init", "--initial-branch=main", "--template=" + path.join(fixture, "no-hooks")]);
      for (const [key, value] of [["user.name", "Git 面板测试"], ["user.email", "git-panel@example.invalid"], ["core.autocrlf", "false"], ["diff.external", "false"], ["diff.unsafe.command", "false"], ["diff.unsafe.textconv", "false"]]) await prepare(cwd, ["config", key, value]);
    }
    const reader = readerAt(repo);
    await test("empty and non-repository", async () => {
      const data = await reader.repository(); assert.equal(data.head, null); assert.equal(data.branch, "main");
      assert.deepEqual(await reader.history(null, 0, "", ""), { commits: [], more: false });
      assert.deepEqual(await reader.worktree(), []); await assert.rejects(() => readerAt(path.join(fixture, "missing")).repository());
    });
    const unusual = "中文 空格 [x].txt";
    await fs.writeFile(path.join(repo, unusual), "root content\n");
    await fs.writeFile(path.join(repo, "-leading.txt"), "leading\n");
    await fs.writeFile(path.join(repo, "binary.dat"), Buffer.from([0, 255, 42]));
    await fs.writeFile(path.join(repo, ".gitattributes"), "*.txt diff=unsafe\n");
    await prepare(repo, ["add", "--all"]);
    await test("unborn branch staged diff", async () => {
      const file = (await reader.worktree()).find(f => f.path === unusual);
      assert.equal(file.group, "staged"); assert.ok((await reader.file(file)).rows.includes("+root content"));
    });
    // All synthetic commits are confined to this test-owned disposable repository.
    await prepare(repo, ["commit", "-m", "根提交 literal [keyword]", "-m", "完整提交说明\n第二行"]);
    const root = await prepare(repo, ["rev-parse", "HEAD"]);
    await test("root commit, Unicode paths, literal filters, disabled external drivers", async () => {
      const detail = await reader.commit(root); assert.equal(detail.spec.base, null);
      assert.ok(detail.message.includes("完整提交说明")); assert.ok(detail.note.includes("Root commit"));
      assert.ok(detail.files.some(f => f.path === unusual));
      assert.ok((await reader.file(detail.files.find(f => f.path === unusual), detail.spec)).rows.includes("+root content"));
      assert.ok((await reader.file(detail.files.find(f => f.path === "binary.dat"), detail.spec)).rows.some(line => /Binary files/.test(line)));
      assert.equal((await reader.history(root, 0, "[keyword]", unusual)).commits.length, 1);
      assert.equal((await reader.history(root, 0, ".*", "")).commits.length, 0);
      assert.equal((await reader.history(root, 0, "", "*.txt")).commits.length, 0);
      assert.equal((await reader.history(root, 0, "", "-leading.txt")).commits.length, 1);
    });
    await prepare(repo, ["checkout", "-b", "side"]);
    await fs.writeFile(path.join(repo, "side.txt"), "side\n"); await prepare(repo, ["add", "--all"]); await prepare(repo, ["commit", "-m", "side"]);
    await prepare(repo, ["checkout", "main"]);
    await fs.writeFile(path.join(repo, "main.txt"), "main\n"); await prepare(repo, ["add", "--all"]); await prepare(repo, ["commit", "-m", "main"]);
    await test("endpoint, merge-base, invalid refs and unrelated histories", async () => {
      const endpoints = await reader.compare("main", "side", "endpoint");
      assert.deepEqual(endpoints.files.map(f => f.path), ["main.txt", "side.txt"]);
      const mergeBase = await reader.compare("main", "side", "merge-base");
      assert.equal(mergeBase.spec.base, root); assert.deepEqual(mergeBase.files.map(f => f.path), ["side.txt"]);
      for (const ref of ["missing-ref", "--help", "HEAD;echo injected", "HEAD\nmain", ""]) await assert.rejects(() => reader.compare(ref, "HEAD", "endpoint"));
      const tree = await prepare(repo, ["rev-parse", "HEAD^{tree}"]);
      const orphan = await prepare(repo, ["commit-tree", tree, "-m", "isolated fixture root"]);
      await assert.rejects(() => reader.compare(root, orphan, "merge-base"), /no common ancestor/);
    });
    await prepare(repo, ["merge", "--no-ff", "side", "-m", "merge side"]);
    const merge = await prepare(repo, ["rev-parse", "HEAD"]);
    await test("merge first-parent files and patch", async () => {
      const detail = await reader.commit(merge); assert.ok(detail.note.includes("first-parent"));
      assert.deepEqual(detail.files.map(f => f.path), ["side.txt"]);
      assert.ok((await reader.file(detail.files[0], detail.spec)).rows.includes("+side"));
    });
    for (let i = 0; i < 32; i++) await prepare(repo, ["commit", "--allow-empty", "-m", `page ${i}`]);
    const head = await prepare(repo, ["rev-parse", "HEAD"]);
    await test("30-item pagination and pinned HEAD snapshot", async () => {
      const a = await reader.history(head, 0, "", ""), b = await reader.history(head, 1, "", "");
      assert.equal(a.commits.length, 30); assert.equal(a.more, true); assert.equal(b.more, false);
      assert.equal(new Set([...a.commits, ...b.commits].map(c => c.oid)).size, 36);
      assert.ok(a.commits[0].author.includes("测试")); assert.match(a.commits[0].time, /^\d{4}-\d\d-\d\dT/);
      assert.equal((await reader.history(root, 0, "", "")).commits.length, 1);
    });
    await fs.writeFile(path.join(repo, unusual), "root content\nstaged addition\n"); await prepare(repo, ["add", "--", unusual]);
    await fs.appendFile(path.join(repo, unusual), "unstaged addition\n");
    await fs.rename(path.join(repo, "-leading.txt"), path.join(repo, "renamed name.txt"));
    await prepare(repo, ["add", "--", "-leading.txt", "renamed name.txt"]);
    await fs.writeFile(path.join(repo, "未跟踪 file.txt"), "fresh text\n");
    await fs.writeFile(path.join(repo, "fresh binary.dat"), Buffer.from([0, 1, 2]));
    await test("staged/unstaged/untracked, deletion, rename as D+A, binary", async () => {
      const files = await reader.worktree();
      assert.deepEqual(files.filter(f => f.path === unusual).map(f => f.group), ["staged", "unstaged"]);
      const staged = await reader.file(files.find(f => f.path === unusual && f.group === "staged"));
      const unstaged = await reader.file(files.find(f => f.path === unusual && f.group === "unstaged"));
      assert.ok(staged.rows.includes("+staged addition")); assert.ok(!staged.rows.includes("+unstaged addition"));
      assert.ok(unstaged.rows.includes("+unstaged addition"));
      assert.ok(files.some(f => f.path === "-leading.txt" && f.status === "D"));
      assert.ok(files.some(f => f.path === "renamed name.txt" && f.status === "A"));
      assert.ok((await reader.file(files.find(f => f.path === "未跟踪 file.txt"))).rows.includes("+fresh text"));
      assert.ok((await reader.file(files.find(f => f.path === "fresh binary.dat"))).rows[0].includes("binary"));
    });
    await prepare(repo, ["worktree", "add", "--detach", linked, head]);
    await test("linked worktree root and detached HEAD", async () => {
      const data = await readerAt(linked).repository();
      assert.equal(path.resolve(data.root), path.resolve(linked)); assert.match(data.branch, /^detached /); assert.equal(data.head, head);
    });
    await unitTests(test, { repo, readText });
    await test("View controller with simulated native host", async () => { await controllerTests({ repo, empty, readExec, readText }); });
    await test("queries preserve index and worktree bytes and index mtime", async () => {
      const index = path.join(repo, ".git/index"), file = path.join(repo, unusual);
      const before = [await fs.readFile(index), await fs.readFile(file), (await fs.stat(index)).mtimeMs];
      await reader.repository(); await reader.worktree(); await reader.history(head, 0, "", "");
      await reader.commit(root); await reader.compare(root, head, "endpoint");
      for (const f of await reader.worktree()) await reader.file(f);
      assert.deepEqual(await fs.readFile(index), before[0]); assert.deepEqual(await fs.readFile(file), before[1]); assert.equal((await fs.stat(index)).mtimeMs, before[2]);
    });
    return { passed: results.length, tests: results, readOnlyGitCalls: calls.length, fixtureRemoved: true };
  } finally {
    const resolved = path.resolve(fixture);
    assert.equal(path.dirname(resolved), path.resolve(here)); assert.ok(path.basename(resolved).startsWith(".fixture-"));
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

if (typeof process !== "undefined" && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runTests(), null, 2));
}
