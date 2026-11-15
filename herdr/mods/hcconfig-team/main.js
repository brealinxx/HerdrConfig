import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { terminals, spaces, focused, theme, run, exec, props, appHome, writeTextFile, pickFolder } from "herdr";

const ROLES = [
  ["project-manager", "Project Manager"], ["planner", "Planner"],
  ["executor", "Executor"], ["reviewer", "Reviewer"], ["version-controller", "Version Controller"]
];

export default class Team extends View {
  init(_props, cx) {
    this.request = InputState.new({ placeholder: "Describe the task and acceptance criteria" });
    this.config = InputState.new({ placeholder: "Optional team JSON path" });
    this.folder = null; this.busy = false; this.message = "";
  }

  start(cx) {
    const request = this.request.value().trim();
    const cwd = this.folder || focused()?.cwd || spaces().find(s => s.active)?.folder;
    const on = spaces().find(s => s.active)?.machine;
    if (!request || !cwd) { this.message = "Choose a local project and enter a task."; cx.notify(); return; }
    if (on && !this.folder) { this.message = "Remote project: run the launcher on that machine. Select a local folder to start here."; cx.notify(); return; }
    if (!props().launcher) { this.message = "Install the personal layout to configure the launcher path."; cx.notify(); return; }
    this.busy = true; this.message = "Starting PM…"; cx.notify();
    const config = this.config.value().trim();
    cx.spawn(async cx => {
      try {
        const path = `${appHome()}/hcconfig-request-${Date.now()}-${Math.random().toString(16).slice(2)}.md`;
        await writeTextFile(path, request, null);
        const args = ["-NoProfile", "-File", props().launcher, "Start", "-Project", cwd, "-Request", path];
        if (config) args.push("-Config", config);
        const result = await exec("pwsh", args, { timeout: 120000 });
        this.message = result.code === 0 ? "PM started. Task evidence is saved locally." : `Launch needs attention: ${result.stderr || result.stdout}`;
      } catch (error) { this.message = String(error); }
      finally { this.busy = false; cx.notify(); }
    });
  }

  button(id, text, action) {
    return div().id(id).px(8).py(5).rounded(5).bg(theme().raised).hover(s => s.bg(theme().hover)).child(text).on_click((_e, cx) => action(cx));
  }

  render() {
    const t = theme(), space = spaces().find(s => s.active);
    const all = terminals().filter(a => a.state === "live" && a.labels?.["herdrconfig.role"] && a.labels?.["herdr.space"] === space?.id);
    return v_flex().id("hcconfig-team").size_full().min_h(0).overflow_y_scrollbar().p(12).gap(10).bg(t.chrome).text_color(t.foreground).text_size(13)
      .child(div().font_semibold().text_size(16).child("Project team"))
      .child(div().text_color(t.muted).child("PM → Plan → Execute → Review → Deliver"))
      .child(div().flex_none().p(6).rounded(5).border_1().border_color(t.border).bg(t.surface).child(Input.new(this.request).w_full()))
      .child(div().flex_none().p(6).rounded(5).border_1().border_color(t.border).bg(t.surface).child(Input.new(this.config).w_full()))
      .child(div().text_color(t.muted).truncate().child(this.folder || "Use the active local project"))
      .child(h_flex().gap(6)
        .child(this.button("choose-project", "Choose folder", cx => {
          cx.spawn(async cx => { try { const folder = await pickFolder({ prompt: "Choose a Git project" }); if (folder) this.folder = folder; } catch (e) { this.message = String(e); } cx.notify(); });
        }))
        .child(this.button("start-team", this.busy ? "Starting…" : "Start team", cx => { if (!this.busy) this.start(cx); })))
      .child(div().text_color(t.muted).child(this.message))
      .children(ROLES.map(([role, label]) => {
        const members = all.filter(a => a.labels["herdrconfig.role"] === role);
        return v_flex().flex_none().gap(4).p(8).rounded(6).bg(t.surface)
          .child(div().font_semibold().child(label))
          .children(members.length ? members.map(a => this.button(`agent-${a.address}`, `${a.name || a.address} · ${a.status || "unknown"}`, () => run("terminal.peek", { terminal: a.address }))) : [div().text_color(t.dim).child("Starts when assigned")]);
      }))
      .child(div().text_color(t.dim).child("Terminal status is not task approval. Use Gate before delivery."));
  }
}
