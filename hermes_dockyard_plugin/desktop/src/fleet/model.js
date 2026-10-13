// GENERATED-STRUCTURE: hand-edited Desktop module. Edit this file, then run
// node hermes_dockyard_plugin/desktop/build.mjs to regenerate plugin.js.
//
// Fleet additions (hermes-fleet only), pure helpers with no imports so node
// tests load them directly. The hermes-fleet backend wraps this plugin's API
// and adds fleet-only routes: GET /dispatch, /needs-you, /waiting,
// /onboard/options, POST /initiatives/{ref}/dispatch and /waiting, and a
// bind-only POST /onboard, and marks its GET /health with `fleet: true`: the
// only probe, so a vanilla backend is never asked for a route it lacks.

// projects_db.normalize_slug and the fleet onboarding guard accept exactly this.
export const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/

// What a failed GET /health means: 'vanilla' when the route is not there
// (404, or the plugin is off for this profile), else 'unavailable': a backend
// that could not answer, where callers fail closed.
export function probeMode(error) {
  const raw = String(error?.cause?.message ?? error?.message ?? error ?? '')
  return error?.pluginOff || /^404\b/.test(raw) ? 'vanilla' : 'unavailable'
}

export function waitText(record) {
  return `${record?.who || 'someone'}${record?.reference ? ` (${record.reference})` : ''}${record?.expected_by ? ` until ${record.expected_by}` : ''}`
}

export const waitStatus = (record) => ({ overdue: 'Wait overdue', recheck: 'Recheck due' }[record?.wait_status] ?? 'Waiting')

export const waitTone = (record) => (record?.wait_status === 'overdue' ? 'danger' : record?.wait_status === 'recheck' ? 'warning' : 'info')

export const WAIT_FIELDS = Object.freeze(['who', 'reference', 'expected_by', 'recheck_after', 'note'])

export const waitValid = (form) => Boolean(String(form?.who ?? '').trim() && (form?.expected_by || form?.recheck_after))

// The POST /initiatives/{ref}/waiting body: a confirmed wait, as the dashboard user.
export function waitBody(projectId, record) {
  const body = { state: 'waiting', project_id: projectId }
  for (const key of WAIT_FIELDS) body[key] = String(record?.[key] ?? '').trim() || null
  return body
}

export function dispatchMessage(ref, result, approved) {
  return `${ref}${approved ? ' approved,' : ''} ${result?.changed ? 'dispatched to' : 'already with'} ${result?.owner} · card ${result?.task_id} ${String(result?.status ?? '').replaceAll('_', ' ')}`
}

// Whole days from a queue timestamp (ISO text or epoch seconds) to the queue's today.
export function ageDays(since, today) {
  const start = typeof since === 'number' ? since * 1000 : Date.parse(String(since ?? '').slice(0, 10))
  const end = Date.parse(String(today ?? '').slice(0, 10))
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined
  return Math.max(0, Math.floor((end - start) / 86400000))
}

const NEEDS = Object.freeze({
  blocked_card: { tag: 'Blocked card', tone: 'blocker', impact: 'Waiting on a person' },
  wait_due: { tag: 'Wait due', tone: 'blocker', impact: 'Wait is due again' },
  wait_suggested: { tag: 'Confirm wait?', tone: 'notice', impact: 'Wait suggested' },
  undispatched: { tag: 'Needs owner', tone: 'notice', impact: null },
  source_unavailable: { tag: 'Source broken', tone: 'blocker', impact: 'Objective cannot be read' },
})

// The Dashboard's "Needs you now" rows: upstream's, plus the fleet queue's in
// the shape of upstream's attention items, for the projects the Dashboard
// shows (its scope). Approvals already arrive from upstream; an upstream
// blocked-work row gives way to the fleet's row for the same card, which adds
// the block reason, its steps and the wait.
export function withFleetRows(rows, fleet, projectIds) {
  if (fleet?.mode !== 'fleet') return rows
  const keep = new Set(projectIds)
  const needs = (fleet.queue?.items ?? []).filter((need) => NEEDS[need.kind] && keep.has(need.project_id))
  const cards = new Set(needs.filter((need) => need.kind === 'blocked_card').map((need) => need.card_id))
  return [...rows.filter((row) => !(row.cause === 'blocked_item' && cards.has(row.ref))), ...needs.map((need) => ({
      kind: `fleet_${need.kind}`,
      cause: `fleet_${need.kind}`,
      fleet: need,
      title: need.title || need.card_title || need.ref || 'Needs you',
      ref: need.ref || (need.card_id ? `card ${need.card_id}` : null),
      detail: need.detail || '',
      project: need.project_id,
      age_days: ageDays(need.since, fleet.queue.today),
      deep_link: need.card_id ? `s2:work/${need.card_id}` : `s1:project/${need.project_id}`,
    }))]
}

export function fleetIssueLabels(item) {
  const need = item?.fleet ?? {}
  const known = NEEDS[need.kind] ?? { tag: 'Needs you', tone: 'notice', impact: null }
  return { tag: known.tag, tone: known.tone, impact: known.impact ?? need.detail ?? 'Needs attention', open: need.card_id ? 'Open work item' : 'Open project' }
}

// The need a Dashboard row stands for, read from the latest queue (a selected
// row outlives a reload): a fleet row's own ({ kind: 'resolved' } once it left
// the queue), or, for an upstream approval row, the approval itself.
export function needFor(item, fleet) {
  if (fleet?.mode !== 'fleet' || !item) return null
  const old = item.fleet
  if (old) {
    return (fleet.queue?.items ?? []).find((need) => need.kind === old.kind && need.ref === old.ref && need.card_id === old.card_id
      && need.project_id === old.project_id && need.title === old.title) ?? { ...old, kind: 'resolved' }
  }
  if (item.kind !== 'initiative_approval' || !item.ref) return null
  return { kind: 'approval', ref: item.ref, project_id: item.project, title: item.title }
}

// Boards the bind-only form offers: unbound ones, and the one already bound
// to the project being onboarded.
export const boardsFor = (boards, projectId) => (boards ?? []).filter((board) => !board.project || board.project === projectId)

export function onboardValid(form) {
  return SLUG.test(form.project_id) && String(form.repo_path).trim().startsWith('/') && Boolean(String(form.mission).trim())
    && Boolean(form.lead_profile) && Boolean(form.board_slug)
}

// The fleet's FleetOnboardBody (extra fields are refused).
export function onboardBody(form) {
  return {
    project_id: form.project_id,
    name: String(form.name ?? '').trim(),
    repo_path: String(form.repo_path).trim(),
    mission: String(form.mission).trim(),
    lead_profile: form.lead_profile,
    board_slug: form.board_slug,
    autonomy_level: Number(form.autonomy_level),
  }
}
