import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { terminals, agents, spaces, focused, theme, run, exec, props, appHome, writeTextFile, pickFolder, layout, shared, setShared, nextCommand } from "herdr";
import { activityBySpace, findNode } from "./activity.js";

export default class Team extends View {
  init(_props, cx) {
    this.request = InputState.new({ placeholder: "Task and acceptance criteria" });
    this.config = InputState.new({ placeholder: "Optional team JSON path" });
    this.folder = null; this.busy = false; this.message = ""; this.closed = false;
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (this.closed) return;
        this.command(command); cx.notify();
      }
    });
  }
  close() { this.closed = true; }
  activity() { return activityBySpace(spaces(), terminals(), agents()); }
  command(command) {
    if (command === "toggle-git") run("layout.toggle", { id: "hcconfig-git" });
    if (command === "toggle-launcher") setShared("hcconfig.launcher.open", !shared("hcconfig.launcher.open"));
    if (command === "open-first-active") {
      const member = this.activity().flatMap(g => g.active)[0];
      if (member) this.openAgent(member.address);
    }
  }
  openAgent(address) {
    const member = this.activity().flatMap(g => [...g.active, ...g.idle]).find(a => a.address === address);
    if (!member) return;
    run("space.select", { id: member.space });
    if (member.tab) run("tab.select", { id: member.tab });
    run("terminal.peek", { terminal: member.address });
  }
  start(cx) {
    const request = this.request.value().trim();
    const cwd = this.folder || focused()?.cwd || spaces().find(s => s.active)?.folder;
    const on = spaces().find(s => s.active)?.machine;
    if (!request || !cwd) { this.message = "Choose a local project and enter a task."; cx.notify(); return; }
    if (on && !this.folder) { this.message = "Remote project: run the launcher on that machine. Select a local folder to start here."; cx.notify(); return; }
    const launcher = props().launcher;
    if (!launcher) { this.message = "Install the personal layout to configure the launcher path."; cx.notify(); return; }
    this.busy = true; this.message = "Starting PM…"; cx.notify();
    const config = this.config.value().trim();
    cx.spawn(async cx => {
      try {
        const path = `${appHome()}/hcconfig-request-${Date.now()}-${Math.random().toString(16).slice(2)}.md`;
        await writeTextFile(path, request, null);
        const args = ["-NoProfile", "-File", launcher, "Start", "-Project", cwd, "-Request", path];
        if (config) args.push("-Config", config);
        const result = await exec("pwsh", args, { timeout: 120000 });
        this.message = result.code === 0 ? "PM started. Select its session above." : `Launch needs attention: ${result.stderr || result.stdout}`;
      } catch (error) { this.message = String(error); }
      finally { this.busy = false; cx.notify(); }
    });
  }
  button(id, text, action, selected = false) {
    const t = theme();
    return div().id(id).px(8).py(5).rounded(5).flex_none().cursor_pointer()
      .bg(selected ? t.selected : t.raised).hover(s => s.bg(t.hover)).child(text)
      .on_mouse_down("left", (_e,cx) => cx.stop_propagation())
      .on_click((_e,cx) => { cx.stop_propagation(); action(cx); });
  }
  indicator(status) {
    const t = theme();
    const color = status === "working" ? t.working : status === "blocked" || status === "error" ? t.blocked : status === "done" ? t.done : t.dim;
    return div().size(6).flex_none().rounded_full().bg(color)
      .when(status === "working", el => el.loop("opacity", { from: 0.25, to: 1, period: 1100 }));
  }
  memberRow(member, space) {
    const t = theme();
    const status = { working: "Working", blocked: "Needs you", error: "Error", done: "Done", idle: "Idle", unknown: "Starting / unknown" }[member.status] || member.status;
    return h_flex().id(`member-${member.address}`).flex_none().min_w(0).items_center().gap(7).ml(12).px(8).py(6).rounded(5)
      .cursor_pointer().hover(s => s.bg(t.hover)).tooltip(`${space.name} · ${member.label} · ${member.name} · ${status}`)
      .on_click((_e,cx) => { cx.stop_propagation(); this.openAgent(member.address); })
      .child(this.indicator(member.status))
      .child(div().min_w(0).flex_1().truncate().child(member.label))
      .child(div().flex_none().text_size(11).text_color(t.muted).child(status));
  }
  render() {
    const t = theme(), groups = this.activity();
    const git = findNode(layout(), "hcconfig-git");
    const launcherOpen = !!shared("hcconfig.launcher.open");
    const activeCount = groups.reduce((n,g) => n + g.active.length, 0);
    return v_flex().id("hcconfig-team").size_full().min_h(0).min_w(0).bg(t.chrome).text_color(t.foreground).text_size(13)
      .child(h_flex().flex_none().items_center().gap(5).p(10)
        .child(div().font_semibold().flex_1().child("Workspace"))
        .child(this.button("toggle-git", git?.hidden ? "Show Git" : "Hide Git", () => this.command("toggle-git"), !git?.hidden)))
      .child(h_flex().flex_none().items_center().px(12).py(5).gap(6)
        .child(div().flex_1().text_color(t.muted).child(`Spaces · ${activeCount} active`))
        .child(this.button("new-space", "+", () => run("space.new"))))
      .child(v_flex().id("hcconfig-spaces-list").flex_1().min_h(60).overflow_y_scrollbar().px(6).gap(3)
        .children(groups.map(group => {
          const space = group.space, idleOpen = !!shared(`hcconfig.idle.${space.id}`);
          const attention = group.active.find(a => a.status === "blocked" || a.status === "error");
          const working = group.active.some(a => a.status === "working");
          return v_flex().flex_none().gap(1)
            .child(h_flex().id(`space-${space.id}`).items_center().gap(7).px(8).py(8).min_w(0).rounded(5).cursor_pointer()
              .bg(space.active ? t.selected : t.chrome).hover(s => s.bg(t.hover)).tooltip(space.folder || space.name)
              .on_click(() => run("space.select", { id: space.id }))
              .child(this.indicator(attention ? "blocked" : working ? "working" : "idle"))
              .child(div().min_w(0).flex_1().truncate().font_semibold().child(space.name))
              .when(!!space.machine, el => el.child(div().text_size(10).text_color(t.dim).child(space.machine)))
              .when(group.active.length > 0, el => el.child(div().text_color(t.muted).child(String(group.active.length)))))
            .children(group.active.map(member => this.memberRow(member, space)))
            .when(group.idle.length > 0, el => el.child(v_flex().flex_none()
              .child(div().id(`idle-${space.id}`).ml(20).px(6).py(5).text_size(11).text_color(t.muted).cursor_pointer()
                .hover(s => s.text_color(t.foreground)).child(`${idleOpen ? "▾" : "▸"} Idle sessions (${group.idle.length})`)
                .on_click(() => setShared(`hcconfig.idle.${space.id}`, !shared(`hcconfig.idle.${space.id}`))))
              .when(idleOpen, node => node.children(group.idle.map(member => this.memberRow(member, space))))));
        })))
      .child(v_flex().flex_none().h(launcherOpen ? 272 : this.message ? 88 : 52).max_h(340).overflow_y_scrollbar().p(10).gap(8).border_t(1).border_color(t.border)
        .child(this.button("toggle-launcher", `${launcherOpen ? "▾" : "+"} New task`, () => this.command("toggle-launcher")))
        .when(launcherOpen, el => el
          .child(div().p(6).rounded(5).border_1().border_color(t.border).bg(t.surface).child(Input.new(this.request).w_full()))
          .child(div().p(6).rounded(5).border_1().border_color(t.border).bg(t.surface).child(Input.new(this.config).w_full()))
          .child(div().text_size(11).text_color(t.muted).truncate().child(this.folder || "Use the active local project"))
          .child(h_flex().gap(6)
            .child(this.button("choose-project", "Folder…", cx => {
              cx.spawn(async cx => { try { const folder = await pickFolder({ prompt: "Choose a Git project" }); if (folder) this.folder = folder; } catch(e) { this.message = String(e); } cx.notify(); });
            }))
            .child(this.button("start-team", this.busy ? "Starting…" : "Start team", cx => { if (!this.busy) this.start(cx); }))))
        .when(!!this.message, el => el.child(div().text_size(11).text_color(t.muted).child(this.message))));
  }
}
