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

const text = (value) => typeof value === 'string' ? value : ''
const list = (value) => Array.isArray(value) ? value : []
const strings = (value) => list(value).filter((item) => typeof item === 'string')
const surfaces = (value) => Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {})
  .slice(0, 32).map(([surface, values]) => ({ surface, names: strings(values) }))
const sourceState = (value) => ['current', 'partial', 'unavailable'].includes(value) ? value : 'unavailable'

export function controlProjects(projects, selectedProject) {
  return [...new Set(list(projects).map((project) => project.id).filter((id) => typeof id === 'string' && SLUG.test(id)
    && (selectedProject === '*' || id === selectedProject)))]
}

export function capabilityLabel(item) {
  const names = { 'hermes:techie': 'Hermes Techie', 'chatgpt-dot:techie': 'ChatGPT Techie', 'grokbot:projectsmanager': 'Grok ProjectsManager', 'paseo:integration': 'Paseo' }
  if (Object.hasOwn(names, item.principal_id)) return names[item.principal_id]
  const name = text(item.display_name) || text(item.profile) || text(item.principal_id)
  return item.principal_id?.startsWith('paseo:') ? `Paseo · ${name}` : name
}

export function capabilityFreshness(item, registry, now = Date.now()) {
  const observed = Date.parse(item.observed_at)
  const expires = Date.parse(item.expires_at)
  if (registry.state === 'unavailable' || !Number.isFinite(observed) || !Number.isFinite(expires) || observed > now + 60000 || expires < observed) return 'unknown'
  return registry.state === 'stale' || item.freshness === 'stale' || expires <= now || Date.parse(registry.expires_at) <= now ? 'stale' : 'current'
}

export function safeEvidenceUrl(value) {
  if (typeof value !== 'string' || value !== value.trim()) return null
  try {
    const url = new URL(value)
    const allowed = ['github.com', 'gitlab.com', 'bitbucket.org', 'chatgpt.com', 'grok.com'].includes(url.hostname)
      || /^[a-z0-9-]+\.atlassian\.net$/.test(url.hostname)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowed ? url.href : null
  } catch { return null }
}

const evidenceFor = (value) => list(value).filter((item) => item && typeof item === 'object').slice(0, 20).map((item) => ({
  kind: text(item.kind), reference: text(item.reference), observed_at: text(item.observed_at),
})).filter((item) => item.reference)

export function controlCenterView(payload, projectId, now = Date.now()) {
  if (typeof projectId !== 'string' || !SLUG.test(projectId) || payload?.schema_version !== 1 || payload?.project_id !== projectId) {
    return { mode: 'unavailable', project_id: projectId, error: 'Control-center response does not match this project or supported schema.' }
  }
  const registry = payload.capabilities ?? {}
  const state = ['current', 'stale', 'unavailable'].includes(registry.state) ? registry.state : 'unavailable'
  const capabilities = state === 'unavailable' ? [] : list(registry.items)
    .filter((item) => item && typeof item.principal_id === 'string' && strings(item.projects).includes(projectId)).slice(0, 256)
    .map((item) => ({
      principal_id: item.principal_id, label: capabilityLabel(item), system: text(item.system), profile: text(item.profile),
      role: text(item.role), coordinator: text(item.coordinator), projects: strings(item.projects),
      context: text(item.context), scope: 'display_only',
      state: ['configured', 'untested', 'blocked', 'disabled'].includes(item.state) ? item.state : 'untested',
      freshness: capabilityFreshness(item, { ...registry, state }, now),
      observed_at: text(item.observed_at), expires_at: text(item.expires_at), source: text(item.source),
      tools: { configured_by_surface: surfaces(item.tools?.configured_by_surface), configured_legacy: strings(item.tools?.configured_legacy),
        disabled: strings(item.tools?.disabled), known_plugins_by_surface: surfaces(item.tools?.known_plugins_by_surface), effective: 'unverified' },
      plugins: strings(item.plugins), disabled_plugins: strings(item.disabled_plugins),
      mcp: list(item.mcp).filter((entry) => entry && typeof entry.name === 'string').map((entry) => ({ name: entry.name, enabled: entry.enabled,
        tools: strings(entry.tools), excluded_tools: strings(entry.excluded_tools),
        selection: ['include', 'unrestricted'].includes(entry.selection) ? entry.selection : null, effective: 'unverified' })),
      skills: { local_count: Number.isInteger(item.skills?.local_count) ? item.skills.local_count : null,
        external_count: Number.isInteger(item.skills?.external_count) ? item.skills.external_count : null },
      model: { provider: text(item.model?.provider), default: text(item.model?.default),
        fallback_providers: list(item.model?.fallback_providers).filter(Boolean).map((entry) => [text(entry.provider), text(entry.model)].filter(Boolean).join(' / ')).filter(Boolean) },
      blocker: { owner: text(item.blocker?.owner), reason: text(item.blocker?.reason), next_action: text(item.blocker?.next_action) },
      evidence: evidenceFor(item.evidence),
    }))
  const work = list(payload.work).filter((item) => item && typeof item.initiative_ref === 'string'
    && item.work_id === `initiative:${projectId}:${item.initiative_ref}`
    && (!item.project_id || item.project_id === projectId)).slice(0, 500).map((item) => ({
      work_id: item.work_id, initiative_ref: item.initiative_ref, title: text(item.title) || item.initiative_ref,
      status: text(item.status), needs_dispatch: item.needs_dispatch === true,
      native: { board: text(item.native?.board), card_id: item.card_error ? '' : text(item.native?.card_id), owner: text(item.native?.owner), status: text(item.native?.status) },
      card_error: item.card_error === 'binding_unavailable', evidence: evidenceFor(item.evidence),
      jira: null, paseo: [],
    }))
  return refreshControlCenter({
    mode: 'fleet', project_id: projectId, observed_at: text(payload.observed_at),
    capabilities: { state, reason: text(registry.reason), observed_at: text(registry.observed_at), expires_at: text(registry.expires_at), items: capabilities },
    work, needs_you: list(payload.needs_you).filter((item) => item?.project_id === projectId).slice(0, 500),
    sources: { dispatch: sourceState(payload.sources?.dispatch), needs_you: sourceState(payload.sources?.needs_you) },
    truncated: ['capabilities', 'work', 'needs_you'].filter((key) => payload.truncated?.[key] === true),
  }, now)
}

export function refreshControlCenter(view, now = Date.now()) {
  if (view.mode !== 'fleet') return view
  const registry = view.capabilities
  const expired = registry.state === 'current' && Date.parse(registry.expires_at) <= now
  const capabilities = expired ? { ...registry, state: 'stale', reason: 'registry_expired' } : registry
  return { ...view, capabilities: { ...capabilities, items: capabilities.items.map((item) => ({
    ...item, freshness: capabilityFreshness(item, capabilities, now),
  })) } }
}
