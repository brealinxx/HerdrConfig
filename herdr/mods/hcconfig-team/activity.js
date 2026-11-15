export const ROLE_NAMES = {
  "project-manager": "PM", planner: "Planner", executor: "Executor",
  reviewer: "Reviewer", "version-controller": "Version control"
};
const RANK = { blocked: 0, error: 0, working: 1, done: 2, idle: 3, unknown: 4 };

// Roles come only from explicit labels, never from task text or a parent role.
export function activityBySpace(spaceList, terminalList, agentList) {
  const terminals = new Map(terminalList.map(t => [t.address, t]));
  const agents = new Map(agentList.map(a => [a.address, a]));
  function owner(terminal, seen = new Set()) {
    if (!terminal || seen.has(terminal.address)) return null;
    seen.add(terminal.address);
    const agent = agents.get(terminal.address);
    if (agent && spaceList.some(s => s.id === agent.space)) return { space: agent.space, tab: agent.tab };
    const machine = terminal.address.includes("/") ? terminal.address.split("/")[0] : null;
    const qualify = id => !id || !machine || id.startsWith(`${machine}/`) ? id : `${machine}/${id}`;
    const space = qualify(terminal.labels?.["herdr.space"]);
    if (spaceList.some(s => s.id === space)) return { space, tab: qualify(terminal.labels?.["herdr.tab"]) };
    return owner(terminals.get(terminal.parent), seen);
  }
  const groups = spaceList.map(space => ({ space, active: [], idle: [] }));
  for (const terminal of terminalList) {
    if (terminal.state !== "live") continue;
    const agent = agents.get(terminal.address);
    const role = ROLE_NAMES[terminal.labels?.["herdrconfig.role"]];
    if (!role && !agent && !terminal.program?.agent) continue;
    const location = owner(terminal);
    const group = groups.find(g => g.space.id === location?.space);
    if (!group) continue;
    const status = agent?.status || terminal.status || "unknown";
    const member = { address: terminal.address, ...location, status,
      label: role || agent?.program?.name || terminal.program?.name || "Agent",
      name: terminal.name || agent?.title || terminal.address };
    (status === "idle" ? group.idle : group.active).push(member);
  }
  for (const group of groups) {
    group.active.sort((a,b) => (RANK[a.status] ?? 4) - (RANK[b.status] ?? 4) || a.address.localeCompare(b.address));
    group.idle.sort((a,b) => a.address.localeCompare(b.address));
  }
  return groups;
}

export function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children || []) { const found = findNode(child, id); if (found) return found; }
  return null;
}
