import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { exec, readTextFile, spaces, panes, focused, theme, settings, nextCommand, run, layout } from "herdr";
import { GitReader, RequestGate, PAGE_SIZE, FILE_LIMIT, clip, label, locate, locationKey } from "./git.js";

const GROUP = { staged: "Staged", unstaged: "Unstaged", untracked: "Untracked", conflict: "Conflict", diff: "Changed" };

export default class GitPanel extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.listGate = new RequestGate(); this.detailGate = new RequestGate(); this.fileGate = new RequestGate();
    this.mode = "history"; this.compareMode = "endpoint"; this.page = 0;
    this.commits = []; this.files = []; this.rows = []; this.more = false;
    this.repo = null; this.selected = null; this.open = null; this.spec = null;
    this.message = ""; this.note = ""; this.error = ""; this.previewNote = ""; this.fileCount = 0;
    this.loading = false; this.detailLoading = false; this.fileLoading = false;
    this.height = 700; this.closed = false;
    this.messageInput = InputState.new({ placeholder: "Message keyword (Enter to apply)" });
    this.pathInput = InputState.new({ placeholder: "Literal repo-relative file/directory (Enter)" });
    this.refA = InputState.new({ placeholder: "ref A", value: "HEAD~1" });
    this.refB = InputState.new({ placeholder: "ref B", value: "HEAD" });
    this.filters = { message: "", path: "" };
    for (const input of [this.messageInput, this.pathInput]) input.on("submit", (_e, cx) => this.applyFilters(cx));
    for (const input of [this.refA, this.refB]) input.on("submit", (_e, cx) => this.compare(cx));
    this.syncProject(cx);
    // No timers or folder watchers: hidden copies perform no periodic Git reads.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (this.closed) return;
        this.command(command, cx);
        cx.notify();
      }
    });
  }

  location() { return locate(spaces(), panes(), focused(), this.lastLocation); }
  key() { return locationKey(this.location()); }
  valid(gate, token) { return !this.closed && gate.accepts(token, this.key()); }
  reader(location, gate, token) { return new GitReader(exec, readTextFile, location, () => this.valid(gate, token)); }

  clearDetail() {
    this.detailGate.invalidate(); this.fileGate.invalidate();
    this.selected = null; this.spec = null; this.files = []; this.fileCount = 0; this.open = null;
    this.rows = []; this.message = ""; this.note = ""; this.previewNote = "";
    this.detailLoading = false; this.fileLoading = false;
  }

  syncProject(cx) {
    const location = this.location(), key = locationKey(location);
    this.lastLocation = location;
    if (key === this.context) return false;
    this.context = key; this.listGate.invalidate(); this.clearDetail();
    this.repo = null; this.commits = []; this.more = false; this.page = 0;
    this.error = ""; this.loading = false; this.filters = { message: "", path: "" };
    // Do not mutate native InputState inside render; reset it in the task.
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      if (this.closed || this.context !== key || this.key() !== key) return;
      this.messageInput.set_value(""); this.pathInput.set_value("");
      this.refA.set_value("HEAD~1"); this.refB.set_value("HEAD");
      this.reload(cx);
      cx.notify();
    });
    return true;
  }

  reload(cx, reuseSnapshot = false) {
    if (this.syncProject(cx)) return;
    const location = this.location();
    const token = this.listGate.begin(this.context);
    this.clearDetail(); this.commits = []; this.more = false; this.error = "";
    if (!location.cwd) { this.loading = false; this.error = "The current project has no folder."; return; }
    this.loading = true;
    const mode = this.mode, page = this.page, filters = { ...this.filters }, repo = reuseSnapshot ? this.repo : null;
    cx.spawn(async (cx) => {
      try {
        const reader = this.reader(location, this.listGate, token);
        const current = repo || await reader.repository();
        reader.location = { ...location, cwd: current.root };
        const result = mode === "history" ? await reader.history(current.head, page, filters.message, filters.path)
          : mode === "worktree" ? await reader.worktree() : null;
        if (!this.valid(this.listGate, token)) return;
        this.repo = current;
        if (mode === "history") { this.commits = result.commits; this.more = result.more; }
        if (mode === "worktree") {
          this.installFiles(result); this.note = "Worktree snapshot; a file can have both staged and unstaged changes.";
        }
      } catch (e) {
        if (this.valid(this.listGate, token)) { this.repo = null; this.error = `Cannot read Git repository: ${clip(String(e), 1600)}`; }
      } finally {
        if (this.valid(this.listGate, token)) { this.loading = false; cx.notify(); }
      }
    });
  }

  switchMode(mode, cx) {
    this.mode = mode; this.page = 0; this.reload(cx); cx.notify();
  }
  applyFilters(cx) {
    this.filters = { message: this.messageInput.value(), path: this.pathInput.value() };
    this.page = 0; this.reload(cx, true); cx.notify();
  }
  paginate(delta, cx) {
    if (this.loading || this.mode !== "history" || (delta < 0 ? this.page === 0 : !this.more)) return;
    this.page += delta; this.reload(cx, true); cx.notify();
  }
  installFiles(files) {
    this.fileCount = files.length; this.files = files.slice(0, FILE_LIMIT);
  }

  select(commit, cx) {
    if (this.syncProject(cx) || this.loading || !this.repo) return;
    this.clearDetail(); this.selected = commit; this.detailLoading = true; this.error = "";
    const token = this.detailGate.begin(this.context);
    const reader = this.reader({ ...this.location(), cwd: this.repo.root }, this.detailGate, token);
    cx.spawn(async (cx) => {
      try {
        const result = await reader.commit(commit.oid);
        if (!this.valid(this.detailGate, token)) return;
        this.spec = result.spec; this.installFiles(result.files); this.message = result.message; this.note = result.note;
        if (this.files.length) this.pick(this.files[0], cx);
      } catch (e) { if (this.valid(this.detailGate, token)) this.error = clip(String(e), 1600); }
      finally { if (this.valid(this.detailGate, token)) { this.detailLoading = false; cx.notify(); } }
    });
    cx.notify();
  }

  compare(cx) {
    if (this.syncProject(cx) || this.loading || !this.repo || this.mode !== "compare") return;
    this.clearDetail(); this.detailLoading = true; this.error = "";
    const token = this.detailGate.begin(this.context), a = this.refA.value(), b = this.refB.value(), mode = this.compareMode;
    const reader = this.reader({ ...this.location(), cwd: this.repo.root }, this.detailGate, token);
    cx.spawn(async (cx) => {
      try {
        const result = await reader.compare(a, b, mode);
        if (!this.valid(this.detailGate, token)) return;
        this.spec = result.spec; this.installFiles(result.files); this.note = result.note;
        if (this.files.length) this.pick(this.files[0], cx);
      } catch (e) { if (this.valid(this.detailGate, token)) this.error = clip(String(e), 1600); }
      finally { if (this.valid(this.detailGate, token)) { this.detailLoading = false; cx.notify(); } }
    });
    cx.notify();
  }

  pick(file, cx) {
    if (this.syncProject(cx) || !this.repo) return;
    const token = this.fileGate.begin(this.context);
    this.open = file; this.rows = []; this.previewNote = ""; this.fileLoading = true;
    const spec = this.spec, reader = this.reader({ ...this.location(), cwd: this.repo.root }, this.fileGate, token);
    cx.spawn(async (cx) => {
      try {
        const result = await reader.file(file, spec);
        if (!this.valid(this.fileGate, token)) return;
        this.rows = result.rows; this.previewNote = result.note;
      } catch (e) { if (this.valid(this.fileGate, token)) this.previewNote = `Preview unavailable (too large, stale, or unreadable): ${clip(String(e), 1500)}`; }
      finally { if (this.valid(this.fileGate, token)) { this.fileLoading = false; cx.notify(); } }
    });
    cx.notify();
  }

  command(command, cx) {
    if (command === "focus") this.handle.focus();
    else if (["history", "worktree", "compare"].includes(command)) this.switchMode(command, cx);
    else if (command === "refresh") { this.page = 0; this.reload(cx); }
    else if (command === "next") this.paginate(1, cx);
    else if (command === "previous") this.paginate(-1, cx);
    else if (command === "select-first") {
      if (this.mode === "history" && this.commits.length) this.select(this.commits[0], cx);
      else if (this.files.length) this.pick(this.files[0], cx);
    } else if (command === "select-file-first" && this.files.length) this.pick(this.files[0], cx);
    else if (["endpoint", "merge-base"].includes(command)) { this.compareMode = command; this.compare(cx); }
    else if (command === "run-compare") this.compare(cx);
  }

  close() { this.closed = true; this.listGate.invalidate(); this.detailGate.invalidate(); this.fileGate.invalidate(); }

  button(id, text, action, active = false, enabled = true) {
    const t = theme();
    return div().id(id).px(9).py(5).rounded(5).flex_none().text_color(enabled ? t.foreground : t.dim)
      .bg(active ? t.selected : t.raised).when(enabled, el => el.cursor_pointer().hover(s => s.bg(t.hover)))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); if (enabled) action(cx); }).child(text);
  }
  input(id, state) {
    const t = theme();
    return div().id(id).h(30).flex_1().min_w(0).px(8).border_1().border_color(t.input).rounded(4)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(state).h_full().text_size(12).text_color(t.foreground));
  }
  scroll(id, height, children) {
    return div().h(height).min_h(0).flex_none().relative()
      .child(v_flex().id(id).absolute().inset_0().overflow_y_scroll().children(children))
      .child(Scrollbar.vertical(id).absolute().inset_0());
  }

  render(cx) {
    this.syncProject(cx);
    const t = theme(), pending = this.loading || this.detailLoading || this.fileLoading;
    const listHeight = Math.max(64, Math.min(140, this.height * 0.18));
    const diffId = `git-diff-${this.fileGate.version}`;
    const empty = this.loading ? "Loading…" : !this.repo ? "Select a Git project, then refresh." : !this.repo.head ? "Empty repository: no commits yet. See Worktree." : "No matching commits.";
    const controls = v_flex().id("git-controls").absolute().inset_0().min_w(0).overflow_y_scroll().gap(5).p(2)
      .child(h_flex().gap(5).items_center().flex_none()
        .child(div().font_semibold().child("Git · Read only"))
        .child(div().flex_1()).child(this.button("git-refresh", pending ? "Refreshing…" : "Refresh", cx => this.command("refresh", cx)))
        .when(layout()?.id === "hcconfig-root", el => el.child(this.button("git-collapse", "Hide", () => run("layout.hide", { id: "hcconfig-git" })))))
      .child(div().flex_none().text_color(t.muted).child(label(this.repo?.root || this.lastLocation?.cwd || "No project folder")))
      .child(div().flex_none().text_color(t.dim).child(`Branch: ${label(this.repo?.branch || "—")}  ${this.lastLocation?.on ? "Machine: " + label(this.lastLocation.on) : "Local"}`))
      .child(h_flex().gap(5).flex_none().children([["history", "History"], ["worktree", "Worktree"], ["compare", "Compare"]].map(([mode, text]) => this.button(`git-${mode}`, text, cx => this.switchMode(mode, cx), this.mode === mode))))
      .when(this.mode === "history", el => el
        .child(h_flex().gap(5).flex_none().child(this.input("git-message-filter", this.messageInput)))
        .child(h_flex().gap(5).flex_none().child(this.input("git-path-filter", this.pathInput)).child(this.button("git-apply", "Apply", cx => this.applyFilters(cx))))
        .child(h_flex().gap(6).flex_none().items_center()
          .child(this.button("git-previous", "Prev", cx => this.paginate(-1, cx), false, !this.loading && this.page > 0))
          .child(div().child(`Page ${this.page + 1} · ${PAGE_SIZE}/page`))
          .child(this.button("git-next", "Next", cx => this.paginate(1, cx), false, !this.loading && this.more)))
        .child(this.scroll(`git-history-list-${this.listGate.version}`, listHeight, this.commits.length ? this.commits.map((commit, index) =>
          v_flex().id(`git-commit-${index}`).flex_none().p(5).gap(2).rounded(4)
            .when(this.selected?.oid === commit.oid, el => el.bg(t.selected)).hover(s => s.bg(t.hover)).cursor_pointer()
            .on_click((_e, cx) => this.select(commit, cx))
            .child(div().child(`${commit.oid.slice(0, 10)}  ${label(commit.subject)}`))
            .child(div().text_color(t.dim).text_size(11).child(`${label(commit.author)} · ${commit.time}`))) : [div().p(5).text_color(t.dim).child(empty)])))
      .when(this.mode === "compare", el => el
        .child(h_flex().gap(5).flex_none().child(this.input("git-ref-a", this.refA)).child(this.input("git-ref-b", this.refB)))
        .child(h_flex().gap(5).flex_none()
          .children(["endpoint", "merge-base"].map(mode => this.button(`git-${mode}`, mode, cx => { this.compareMode = mode; this.compare(cx); cx.notify(); }, mode === this.compareMode)))
          .child(this.button("git-run-compare", "Compare", cx => this.compare(cx), false, !!this.repo && !this.loading)))
        .child(div().text_color(t.dim).flex_none().child("endpoint: A → B; merge-base: common ancestor → B")))
      .when(!!this.error, el => el.child(this.scroll("git-error", 60, [div().text_color(t.ansi1).child(label(this.error))])))
      .when(!!this.message, el => el.child(this.scroll("git-message", 56, [div().text_color(t.muted).child(this.message)])))
      .when(!!this.note, el => el.child(div().flex_none().text_color(t.dim).child(this.note)))
      .child(div().flex_none().font_semibold().child(`Files ${this.fileCount}${this.fileCount > FILE_LIMIT ? ` (truncated to ${FILE_LIMIT})` : ""}${this.detailLoading ? " · Loading…" : ""}`))
      .child(this.scroll(`git-file-list-${this.detailGate.version}`, Math.max(46, Math.min(130, this.height * 0.17)), this.files.length ? this.files.map((file, index) =>
        div().id(`git-file-${index}`).flex_none().px(5).py(4).rounded(4).cursor_pointer()
          .when(this.open === file, el => el.bg(t.selected)).hover(s => s.bg(t.hover)).on_click((_e, cx) => this.pick(file, cx))
          .child(`[${GROUP[file.group]} ${file.status}] ${label(file.path)}`)) : [div().text_color(t.dim).child(this.loading || this.detailLoading ? "Loading…" : this.mode === "history" && !this.selected ? "Select a commit to see its files." : this.mode === "compare" && !this.spec ? "Enter two refs, then compare." : "No changed files.")]))
      .when(!!this.open, el => el.child(div().flex_none().text_color(t.muted).child(`${GROUP[this.open.group]} · ${label(this.open.path)}`)));
    // Bound the controls region so history, details and long paths cannot push
    // the diff outside a narrow/short panel. Both regions scroll independently.
    return v_flex().id("hcconfig-git").size_full().min_h(0).min_w(0).overflow_hidden()
      .bg(t.background).text_color(t.foreground).text_size(12).gap(5).p(6).track_focus(this.handle)
      .on_size_change((size, cx) => { if (this.height !== size.height) { this.height = size.height; cx.notify(); } })
      .child(div().h(Math.max(100, this.height * 0.62)).flex_none().relative().child(controls)
        .child(Scrollbar.vertical("git-controls").absolute().inset_0()))
      .child(div().flex_1().min_h(36).relative().border_1().border_color(t.border)
        .child(div().id(`${diffId}-x`).size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(Math.max(300, ...this.rows.map(row => row.length * 8 + 20))).h_full()
            .child(v_virtual_list(diffId, this.rows.length, 20, i => String(i), range => this.rows.slice(range.start, range.end).map(row =>
              div().h(20).px(6).font_family(settings().font_family || "Consolas").text_size(12)
                .text_color(row.startsWith("+") ? t.ansi2 : row.startsWith("-") ? t.ansi1 : row.startsWith("@@") ? t.accent : t.foreground)
                .child(label(row)))).size_full())))
        .child(Scrollbar.vertical(diffId).viewport_from_layout().absolute().inset_0())
        .when(!this.rows.length, el => el.child(div().absolute().top(5).left(6).text_color(t.dim).child(this.fileLoading ? "Loading diff…" : "Select a file to preview its diff."))))
      .when(!!this.previewNote, el => el.child(div().flex_none().text_color(t.blocked).child(this.previewNote)))
      .child(div().flex_none().text_size(10).text_color(t.dim).child("Read only · No polling · Refresh for filesystem changes"));
  }
}
