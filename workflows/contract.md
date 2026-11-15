# Team workflow

Five responsibilities are always represented; sessions start on demand. Roles are independent of agent vendor and model. Shared instructions are behavioral contracts, not an OS security boundary.

1. PM captures the request and acceptance criteria. Version Controller checks the initial baseline. Project rules determine branch/worktree/runtime; there is no global automatic checkout or stash.
2. Planner produces the plan. PM reads and records it: `planning -> ready`.
3. Executor implements and validates. PM records its evidence: `ready/changes-requested -> review-pending` and captures a review snapshot.
4. Reviewer runs separately. PM records `passed` only if the snapshot still matches, producing `approved`; `changes-requested` returns to Executor.
5. Gate recomputes the snapshot. Version Controller may deliver only after Gate passes. PM records its final report: `approved -> complete`.

Record files must include: task ID, role, scope, baseline, changed paths, checks actually run and exit results, unverified items, blockers, next owner. Reports are copied into local task storage. Do not rely on chat history shared between different tools.

Snapshot covers HEAD, index/working diffs, status, and untracked file bytes. Dirty submodules cannot be approved by this workflow: review them in their own repository first. Task storage is outside the project; initial dirty state is preserved as evidence, not silently accepted as this task's changes. The final staged review must exclude unrelated pre-existing edits.

The launcher checks stage order, evidence existence, and snapshot consistency. It cannot establish that a report is truthful or prevent arbitrary commands run outside it. Sandboxing/permissions belong to each agent runtime; project instructions and explicit user authorization remain applicable.

Sessions are not automatically recreated after a crash. Read task state and actual Git state before resuming. `hc --keep` restores a shell, not an agent conversation. A failed first-message delivery remains recorded; inspect the terminal before retrying. Parent sessions own their children; no recursive delegation by default.
