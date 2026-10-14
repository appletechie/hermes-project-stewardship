// GENERATED-STRUCTURE: hand-edited Desktop module. Edit this file, then run
// node hermes_dockyard_plugin/desktop/build.mjs to regenerate plugin.js.
//
// Fleet additions (hermes-fleet only), drawn with upstream's own classes:
//   - approve with owner: fleet governance forbids unassigned Kanban cards, so
//     approving names an owner and dispatches the Implement card to it;
//   - waiting records and the "Needs you" queue;
//   - bind-only onboarding: the fleet binds existing boards, never creates one.
// Each piece renders upstream's behaviour unchanged against a vanilla backend.
import { Fragment, jsx, jsxs, useEffect, useState } from '../runtime/react.js'
import { api, emitToast, useStylesheet } from '../runtime/context.js'
import { Button, OnboardingWizard, StatusTag, formatWhen, useDialogFocusManager } from '../lib/ui.js'
import { SLUG, WAIT_FIELDS, boardsFor, controlCenterView, controlProjects, dispatchMessage, needFor, onboardBody, onboardValid, refreshControlCenter, safeEvidenceUrl, waitBody, waitStatus, waitText, waitTone, waitValid } from './model.js'

const enc = encodeURIComponent
const message = (failure) => String(failure?.message ?? failure)

const read = (path) => (path ? api(path).then((data) => ({ data }), (failure) => ({ error: message(failure) })) : {})

// GET /health answers on every backend and only the hermes-fleet wrapper adds
// `fleet: true`, so a vanilla backend is never asked for a route it lacks. A
// failed /health reads as vanilla: the fleet backend itself refuses what
// upstream's screens would send it (an approval without an owner, upstream's
// onboarding body). Then the fleet route a screen needs (`main`, failing
// closed) and an optional second one (`extra`, whose failure is shown):
// { mode: 'fleet', data, extra, extraError } | { mode: 'vanilla' } | { mode: 'unavailable', error }.
// ponytail: asked per screen mount, never cached, so a switch to another
// connection is seen on the next screen.
export async function fleetRead(main, extra) {
  const health = await api('/health').catch(() => null)
  if (health?.fleet !== true) return { mode: 'vanilla' }
  const [first, second] = await Promise.all([read(main), read(extra)])
  return first.error ? { mode: 'unavailable', error: first.error } : { mode: 'fleet', data: first.data, extra: second.data, extraError: second.error }
}

const CONTROL_CSS = `
.dockyard-root .dy-control { min-width:0; margin:0 0 20px; padding:18px; border:1px solid var(--dy-border); border-radius:14px; background:var(--dy-surface); color:var(--dy-text); overflow-wrap:anywhere; }
.dockyard-root .dy-control h2 { margin:0; font-size:18px; }
.dockyard-root .dy-control h3 { margin:16px 0 8px; font-size:14px; }
.dockyard-root .dy-control p { margin:6px 0; }
.dockyard-root .dy-control-head, .dockyard-root .dy-control-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; min-width:0; }
.dockyard-root .dy-control-head > *, .dockyard-root .dy-control-actions > * { min-width:0; }
.dockyard-root .dy-control-project { border-top:1px solid var(--dy-border); margin-top:14px; padding-top:12px; min-width:0; }
.dockyard-root .dy-control summary { cursor:pointer; overflow-wrap:anywhere; }
.dockyard-root .dy-control-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr)); gap:10px; min-width:0; }
.dockyard-root .dy-control-item { min-width:0; padding:12px; border:1px solid var(--dy-border); border-radius:9px; background:var(--dy-surface-subtle); }
.dockyard-root .dy-control-item .dockyard-status-tag { white-space:normal; }
.dockyard-root .dy-control-item summary { font-weight:600; }
.dockyard-root .dy-control-facts { display:grid; grid-template-columns:minmax(70px,auto) minmax(0,1fr); gap:5px 12px; font-size:12px; margin:10px 0; }
.dockyard-root .dy-control-facts dt { color:var(--dy-text-2); }
.dockyard-root .dy-control-facts dd { margin:0; min-width:0; }
.dockyard-root .dy-control a { color:var(--dy-accent-text); }
.dockyard-root .dy-control ul { margin:8px 0; padding-left:18px; }
.dockyard-root .dy-control-blocker { border-left:3px solid var(--dy-warning); padding-left:9px; font-size:12px; }
.dockyard-root .dy-control-more { margin-top:10px; }
`

const STATE_LABELS = { configured: 'Configured · untested', untested: 'Untested', blocked: 'Blocked', disabled: 'Disabled' }
const stateTone = (state) => state === 'blocked' || state === 'unavailable' ? 'danger' : state === 'stale' || state === 'partial' ? 'warning' : 'neutral'
const when = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'Not recorded'
const readable = (value) => String(value || 'unknown').replaceAll('_', ' ')
const surfaceText = (entries) => entries.map((entry) => `${entry.surface}: ${entry.names.join(', ') || 'None recorded'}`).join('; ') || 'None recorded'
const mcpText = (entry) => {
  const enabled = entry.enabled === true ? 'configured enabled' : entry.enabled === false ? 'disabled' : 'enablement unknown'
  const selection = entry.selection === 'unrestricted' ? 'no include restriction configured'
    : entry.selection === 'include' ? `included tools: ${entry.tools.join(', ') || 'none recorded'}`
      : `selection not recorded${entry.tools.length ? `; listed tools: ${entry.tools.join(', ')}` : ''}`
  return `${entry.name} (${enabled}; ${selection}${entry.excluded_tools.length ? `; excluded tools: ${entry.excluded_tools.join(', ')}` : ''}; effective unverified)`
}
const facts = (entries) => jsx('dl', { className: 'dy-control-facts', children: entries.flatMap(([label, value]) => [
  jsx('dt', { children: label }, `${label}-label`), jsx('dd', { children: value || 'Not recorded' }, label),
]) })

function ControlEvidence({ evidence }) {
  if (!evidence.length) return jsx('p', { className: 'dockyard-meta', children: 'Evidence: not recorded' })
  return jsx('ul', { 'aria-label': 'Evidence references', children: evidence.map((item, index) => {
    const href = safeEvidenceUrl(item.reference)
    return jsxs('li', { children: [
      item.kind ? `${readable(item.kind)} · ` : null,
      href ? jsx('a', { href, target: '_blank', rel: 'noopener noreferrer', children: item.reference }) : item.reference,
      jsx('span', { className: 'dockyard-meta', children: ` · ${when(item.observed_at)}` }),
    ] }, index)
  }) })
}

function ControlPrincipal({ item }) {
  const blocker = item.blocker
  return jsxs('article', { className: 'dy-control-item', 'data-control-principal': item.principal_id, children: [
    jsxs('div', { className: 'dy-control-head', children: [
      jsx('strong', { children: item.label }),
      jsx(StatusTag, { tone: stateTone(item.state), label: STATE_LABELS[item.state] }),
    ] }),
    jsx('p', { className: 'dockyard-meta', children: `${item.principal_id} · ${item.role || 'Role not recorded'}` }),
    jsx('p', { className: 'dockyard-meta', children: `Owner: ${blocker.owner || item.coordinator || 'Not recorded'} · Observation ${item.freshness}` }),
    blocker.reason || blocker.next_action || item.state === 'blocked' ? jsxs('div', { className: 'dy-control-blocker', children: [
      jsx('p', { children: blocker.reason || 'Connection blocked; reason not recorded.' }),
      jsx('p', { children: `Next action: ${blocker.next_action || 'Owner to record the next action.'}` }),
    ] }) : null,
    jsxs('details', { children: [
      jsx('summary', { children: 'Scope, capability and evidence' }),
      facts([
        ['Scope', item.projects.join(', ')], ['Product / profile', [item.system, item.profile].filter(Boolean).join(' / ')],
        ['Coordinator', item.coordinator], ['Observed', when(item.observed_at)], ['Expires', when(item.expires_at)], ['Source', item.source],
        ['Configured tools by surface', surfaceText(item.tools.configured_by_surface)], ['Legacy tool configuration', item.tools.configured_legacy.join(', ') || 'None recorded'],
        ['Disabled tools', item.tools.disabled.join(', ') || 'None recorded'], ['Known plugins by surface', surfaceText(item.tools.known_plugins_by_surface)], ['Effective tools', 'Unverified'],
        ['Plugins', item.plugins.join(', ') || 'None recorded'], ['Disabled plugins', item.disabled_plugins.join(', ') || 'None recorded'],
        ['MCP', item.mcp.map(mcpText).join('; ') || 'None recorded'],
        ['Skills', `Local: ${item.skills.local_count ?? 'unknown'} · External: ${item.skills.external_count ?? 'unknown'}`],
        ['Model', [item.model.provider, item.model.default].filter(Boolean).join(' / ')],
        ['Fallback models', item.model.fallback_providers.join(', ') || 'None recorded'], ['Effective model', 'Unverified'],
      ]),
      jsx(ControlEvidence, { evidence: item.evidence }),
    ] }),
  ] })
}

function ControlWork({ item, projectId, onOpen }) {
  return jsxs('article', { className: 'dy-control-item', 'data-control-work': item.work_id, children: [
    jsxs('div', { className: 'dy-control-head', children: [
      jsx('strong', { children: item.title }),
      jsx(StatusTag, { tone: item.needs_dispatch ? 'warning' : 'neutral', label: item.needs_dispatch ? 'Needs owner' : readable(item.status) }),
    ] }),
    jsx('p', { className: 'dockyard-meta', children: `${item.initiative_ref} · Owner: ${item.native.owner || 'Unassigned'}` }),
    jsx('p', { className: 'dockyard-meta', children: item.card_error ? 'Native binding unavailable' : item.native.card_id
      ? `Hermes: ${item.native.card_id} on ${item.native.board || 'unknown board'} · ${readable(item.native.status)}` : 'Native card: not linked' }),
    jsxs('details', { children: [
      jsx('summary', { children: 'Work links and result evidence' }),
      facts([['Work ID', item.work_id], ['Jira', 'Not linked'], ['Paseo', 'Not linked']]),
      jsx(ControlEvidence, { evidence: item.evidence }),
      jsx('p', { className: 'dockyard-meta', children: 'Delivery confirmation stays in the existing human approval controls.' }),
    ] }),
    item.native.card_id ? jsx(Button, { small: true, onClick: () => onOpen?.(`s2:work/${item.native.card_id}`, { projectId }), children: 'Open native work' }) : null,
  ] })
}

function ControlRows({ items, render, noun }) {
  return jsxs(Fragment, { children: [
    jsx('div', { className: 'dy-control-grid', children: items.slice(0, 6).map(render) }),
    items.length > 6 ? jsxs('details', { className: 'dy-control-more', children: [
      jsx('summary', { children: `${items.length - 6} more ${noun}` }),
      jsx('div', { className: 'dy-control-grid', children: items.slice(6).map(render) }),
    ] }) : null,
  ] })
}

export function ControlCenterProject({ view, onOpen, onSettings, onApprovals }) {
  const registry = view.capabilities
  const blocked = registry?.items.filter((item) => item.state === 'blocked').length ?? 0
  const stale = registry?.items.filter((item) => item.freshness === 'stale').length ?? 0
  const teamSummary = registry?.state === 'unavailable' ? 'Team evidence unavailable' : `${registry?.items.length ?? 0} team entries (${blocked} blocked, ${stale} stale)`
  const workSummary = view.sources?.dispatch === 'unavailable' ? 'Native work unavailable' : `${view.work?.length ?? 0} active work`
  return jsxs('details', { className: 'dy-control-project', 'data-control-project': view.project_id, children: [
    jsx('summary', { children: view.mode === 'fleet'
      ? `${view.project_id} · ${teamSummary} · ${workSummary} · Registry ${registry.state} · Native work ${view.sources.dispatch}${view.sources.needs_you !== 'current' ? ` · Needs you ${view.sources.needs_you}` : ''}`
      : `${view.project_id} · Control center unavailable` }),
    jsxs('div', { className: 'dy-control-head', children: [
      jsx('strong', { children: view.project_id }),
      jsxs('div', { className: 'dy-control-actions', children: [
        jsx(Button, { small: true, onClick: () => onOpen?.(`s1:project/${view.project_id}`), children: 'Project overview' }),
        jsx(Button, { small: true, onClick: () => onSettings?.(view.project_id), children: 'Project settings' }),
        jsx(Button, { small: true, onClick: () => onApprovals?.(view.project_id), children: 'Approvals' }),
      ] }),
    ] }),
    view.mode !== 'fleet' ? jsx('p', { className: 'dockyard-inline-error', role: 'status', children: `Control center unavailable: ${view.error}` }) : jsxs(Fragment, { children: [
      jsx('p', { className: 'dockyard-meta', children: `Observed ${when(view.observed_at)} · Native work ${view.sources.dispatch} · Needs you ${view.sources.needs_you}${view.sources.needs_you === 'current' ? ` (${view.needs_you.length})` : ''}` }),
      jsx('h3', { children: 'Team and connections' }),
      jsx('p', { className: 'dockyard-meta', children: `Capability registry ${registry.state}${registry.reason ? ` · ${readable(registry.reason)}` : ''} · Observed ${when(registry.observed_at)}` }),
      registry.items.length ? jsx(ControlRows, { items: registry.items, noun: 'team members', render: (item) => jsx(ControlPrincipal, { item }, item.principal_id) })
        : jsx('p', { role: 'status', children: registry.state === 'unavailable' ? 'Capability evidence is unavailable. Connection readiness is unknown.' : 'No capability observations recorded for this project.' }),
      jsx('h3', { children: 'Active work' }),
      view.sources.dispatch !== 'current' ? jsx('p', { className: 'dockyard-inline-error', role: 'status', children: `Native work source ${view.sources.dispatch}; this list may be incomplete.` }) : null,
      view.work.length ? jsx(ControlRows, { items: view.work, noun: 'work items', render: (item) => jsx(ControlWork, { item, projectId: view.project_id, onOpen }, item.work_id) })
        : jsx('p', { className: 'dockyard-meta', children: view.sources.dispatch === 'current' ? 'No active initiatives reported.' : 'Active work cannot be confirmed.' }),
      view.truncated.length ? jsx('p', { className: 'dockyard-meta', children: `Limited snapshot: ${view.truncated.map(readable).join(', ')}. Open the project for the full view.` }) : null,
    ] }),
  ] })
}

export function FleetControlCenter({ projects, selectedProject, refreshedAt, onOpen, onSettings, onApprovals }) {
  useStylesheet('dy-control-stylesheet', 'dyControlStylesheet', CONTROL_CSS)
  const scope = controlProjects(projects, selectedProject).join(',')
  const [state, setState] = useState({ mode: 'loading', scope: '' })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let current = true
    setState({ mode: 'loading', scope })
    if (!scope) return () => { current = false }
    fleetRead().then(async (result) => {
      if (!current) return
      if (result.mode !== 'fleet') { setState({ ...result, scope }); return }
      const views = await Promise.all(scope.split(',').map(async (projectId) => {
        const response = await read(`/control-center?project_id=${enc(projectId)}`)
        return response.error ? { mode: 'unavailable', project_id: projectId, error: response.error } : controlCenterView(response.data, projectId)
      }))
      if (current) setState({ mode: 'fleet', scope, views })
    })
    return () => { current = false }
  }, [scope, refreshedAt, revision])
  useEffect(() => {
    const now = Date.now()
    const expiries = (state.views ?? []).filter((view) => view.mode === 'fleet').flatMap((view) => [
      view.capabilities.expires_at, ...view.capabilities.items.map((item) => item.expires_at),
    ]).map(Date.parse).filter((expires) => Number.isFinite(expires) && expires > now)
    if (!expiries.length) return undefined
    const timer = window.setTimeout(() => setState((current) => current.mode === 'fleet'
      ? { ...current, views: current.views.map((view) => refreshControlCenter(view)) } : current), Math.min(Math.min(...expiries) - now + 1, 2147483647))
    return () => window.clearTimeout(timer)
  }, [state.views])
  if (!scope || state.mode === 'vanilla') return null
  const loading = state.scope !== scope || state.mode === 'loading'
  return jsxs('section', { className: 'dy-control', 'data-fleet-control-center': true, 'aria-label': 'Project control center', 'aria-busy': loading, children: [
    jsxs('div', { className: 'dy-control-head', children: [
      jsx('h2', { children: 'Connected team and work' }),
      jsx(Button, { small: true, disabled: loading, action: 'refresh-control-center', onClick: () => setRevision((value) => value + 1), children: 'Refresh connections' }),
    ] }),
    jsx('p', { className: 'dockyard-meta', children: 'Project owners, connection evidence and active work. Configured capabilities still require a successful test.' }),
    loading ? jsx('p', { role: 'status', children: 'Reading project connections…' }) : state.views?.map((view) => jsx(ControlCenterProject, { view, onOpen, onSettings, onApprovals }, view.project_id)),
  ] })
}

function useEscape(busy, onCancel) {
  useEffect(() => {
    const close = (event) => { if (event.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [busy, onCancel])
}

function Modal({ marker, label, busy, onCancel, children }) {
  useDialogFocusManager(`[${marker}]`)
  useEscape(busy, onCancel)
  return jsx('section', {
    className: 'dockyard-modal-layer',
    [marker]: true,
    onClick: (event) => { if (event.target === event.currentTarget && !busy) onCancel() },
    children: jsxs('div', { className: 'dockyard-modal', role: 'dialog', 'aria-modal': true, 'aria-label': label, children }),
  })
}

// Approval names the Implement card's owner (upstream's approve `assignee`,
// checked before approving); dispatch then adds the context comment and moves
// the card to ready. Without approval it assigns an owner to approved work.
export function OwnerDialog({ initiative, profiles = [], entry = {}, approve = false, busy = false, onCancel, onConfirm }) {
  const [owner, setOwner] = useState(entry.owner || entry.owner_hint || '')
  const action = approve ? 'Approve and dispatch' : 'Dispatch'
  return jsxs(Modal, { marker: 'data-fleet-owner-dialog', label: `${action} ${initiative.ref}`, busy, onCancel, children: [
    jsx('h2', { children: `${approve ? 'Approve' : 'Assign an owner to'} ${initiative.ref}` }),
    jsx('p', { children: `${initiative.title ? `${initiative.title}. ` : ''}${approve
      ? `Approval checks the owner against the dispatcher's profiles first, binds it to ${initiative.project_id || 'its project'}'s own board with its Implement card assigned to the owner, then moves that card to ready with a context comment, so the dispatcher starts it.`
      : `Binds it, if needed, to ${initiative.project_id || 'its project'}'s own board, then assigns its Implement card to the owner with a context comment and moves it to ready, so the dispatcher starts it.`} Validate and Outcome-check cards stay unassigned.` }),
    profiles.length ? null : jsx('p', { className: 'dockyard-inline-error', role: 'alert', children: "No profile can be dispatched: the root config's kanban.dispatch_profiles names none that exist." }),
    entry.owner_named && !entry.owner_hint ? jsx('p', { className: 'dockyard-meta', children: `The proposal names ${entry.owner_named}, which the root dispatcher does not run. Choose an owner.` }) : null,
    jsxs('div', { className: 'dockyard-work-editor', children: [
      jsx('label', { htmlFor: 'dockyard-fleet-owner', children: 'Owner' }),
      jsxs('select', { id: 'dockyard-fleet-owner', 'data-field': 'fleet-owner', value: owner, disabled: busy, onChange: (event) => setOwner(event.target.value), children: [
        jsx('option', { value: '', children: 'Choose a profile' }),
        ...[...new Set(profiles)].map((name) => jsx('option', { value: name, children: name }, name)),
      ] }),
    ] }),
    jsxs('div', { className: 'dockyard-modal-actions', children: [
      jsx(Button, { disabled: busy, onClick: onCancel, children: 'Cancel' }),
      jsx(Button, { action: approve ? 'fleet-approve-dispatch' : 'fleet-dispatch', variant: 'primary', disabled: busy || !owner, onClick: () => onConfirm(owner), children: busy ? 'Dispatching...' : action }),
    ] }),
  ] })
}

// After an approval landed: never throws. A failed dispatch leaves the
// initiative approved and listed as needing an owner, and says so.
export async function dispatchOwner({ ref, projectId, owner, approved = false }) {
  try {
    const result = await api(`/initiatives/${enc(ref)}/dispatch`, { method: 'POST', body: { owner, project_id: projectId || null }, quiet: true })
    emitToast('success', dispatchMessage(ref, result, approved))
    return result
  } catch (failure) {
    emitToast('danger', `${approved ? `Approved ${ref}, but dispatching` : `${ref}: dispatching`} it to ${owner} failed: ${message(failure)}. It still needs an owner (Dashboard, Needs you now).`)
    return null
  }
}

function WaitDialog({ initiative, record, busy, onCancel, onSave }) {
  const [form, setForm] = useState(() => Object.fromEntries(WAIT_FIELDS.map((key) => [key, record?.[key] ?? ''])))
  const field = (key, label, extra = {}) => [
    jsx('label', { htmlFor: `dockyard-fleet-wait-${key}`, children: label }, `${key}-label`),
    jsx(extra.rows ? 'textarea' : 'input', { id: `dockyard-fleet-wait-${key}`, 'data-field': `wait-${key}`, value: form[key], disabled: busy,
      onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })), ...extra }, key),
  ]
  return jsxs(Modal, { marker: 'data-fleet-wait-dialog', label: `Waiting on · ${initiative.ref}`, busy, onCancel, children: [
    jsx('h2', { children: `Waiting on · ${initiative.ref}` }),
    jsx('p', { children: 'While the wait is current its lead does not re-propose or re-diagnose it; nothing is hidden from health, alarms, Needs you or the digest. Recheck at most 14 days out.' }),
    jsxs('div', { className: 'dockyard-work-editor', children: [
      ...field('who', 'Waiting on', { placeholder: 'External party, or the owner' }),
      ...field('reference', 'Reference', { placeholder: 'Case, ticket or submission id, or URL' }),
      ...field('expected_by', 'Expected by', { type: 'date' }),
      ...field('recheck_after', 'Recheck after', { type: 'date' }),
      ...field('note', 'Note', { rows: 3 }),
    ] }),
    jsxs('div', { className: 'dockyard-modal-actions', children: [
      jsx(Button, { disabled: busy, onClick: onCancel, children: 'Cancel' }),
      jsx(Button, { action: 'fleet-save-wait', variant: 'primary', disabled: busy || !waitValid(form), onClick: () => onSave(form), children: busy ? 'Saving...' : 'Save wait' }),
    ] }),
  ] })
}

function ClearDialog({ initiative, suggested, busy, onCancel, onConfirm }) {
  return jsxs(Modal, { marker: 'data-fleet-clear-wait', label: `Clear the wait on ${initiative.ref}`, busy, onCancel, children: [
    jsx('h2', { children: suggested ? `Dismiss the suggested wait on ${initiative.ref}?` : `Clear the wait on ${initiative.ref}?` }),
    jsx('p', { children: suggested ? 'The suggestion is discarded.' : 'Its lead proposes and investigates it again from the next cycle.' }),
    jsxs('div', { className: 'dockyard-modal-actions', children: [
      jsx(Button, { disabled: busy, onClick: onCancel, children: 'Cancel' }),
      jsx(Button, { action: 'fleet-clear-wait', variant: 'danger', disabled: busy, onClick: onConfirm, children: busy ? 'Clearing...' : suggested ? 'Dismiss' : 'Clear' }),
    ] }),
  ] })
}

// What an initiative waits on, and the actions on it. Only waits confirmed
// here (as the dashboard user) take effect; a lead's record is a suggestion.
export function FleetWait({ initiative, waiting, suggested, prefill, onChanged }) {
  const [editing, setEditing] = useState(null)
  const [clearing, setClearing] = useState(false)
  const [busy, setBusy] = useState(false)
  const post = async (body, done) => {
    setBusy(true)
    try {
      await api(`/initiatives/${enc(initiative.ref)}/waiting`, { method: 'POST', body, quiet: true })
      emitToast('success', done)
      setEditing(null)
      setClearing(false)
      onChanged?.()
    } catch (failure) {
      emitToast('danger', `The wait on ${initiative.ref} was not saved. ${message(failure)}`)
    }
    setBusy(false)
  }
  const save = (record) => post(waitBody(initiative.project_id, record), `${initiative.ref} waiting on ${String(record.who).trim()}`)
  const clear = () => post({ state: 'cleared', project_id: initiative.project_id, reason: suggested && !waiting ? 'suggestion dismissed in Dockyard' : 'cleared in Dockyard' },
    `${suggested && !waiting ? 'Suggested wait dismissed on' : 'Wait cleared on'} ${initiative.ref}`)
  const actions = waiting
    ? [jsx(Button, { small: true, action: 'fleet-update-wait', disabled: busy, onClick: () => setEditing(waiting), children: 'Update wait' }, 'u'),
      jsx(Button, { small: true, variant: 'quiet', action: 'fleet-open-clear-wait', disabled: busy, onClick: () => setClearing(true), children: 'Clear wait' }, 'x')]
    : suggested
      ? [jsx(Button, { small: true, variant: 'primary', action: 'fleet-confirm-wait', disabled: busy, onClick: () => save(suggested), children: 'Confirm wait' }, 'y'),
        jsx(Button, { small: true, action: 'fleet-edit-wait', disabled: busy, onClick: () => setEditing(suggested), children: 'Edit' }, 'e'),
        jsx(Button, { small: true, variant: 'quiet', action: 'fleet-open-clear-wait', disabled: busy, onClick: () => setClearing(true), children: 'Dismiss' }, 'n')]
      : [jsx(Button, { small: true, action: 'fleet-set-wait', disabled: busy, onClick: () => setEditing(prefill ?? {}), children: 'Set waiting' }, 'w')]
  return jsxs('div', { className: 'dockyard-fleet-wait', 'data-fleet-wait': initiative.ref, children: [
    waiting ? jsx(StatusTag, { tone: waitTone(waiting), label: waitStatus(waiting) }) : null,
    waiting ? jsx('p', { children: `On ${waitText(waiting)}, recheck after ${waiting.recheck_after}.` }) : null,
    waiting ? jsx('p', { className: 'dockyard-meta', children: `${waiting.note ? `${waiting.note} · ` : ''}set by ${waiting.set_by} ${formatWhen(waiting.set_at)}` }) : null,
    !waiting && suggested ? jsx(StatusTag, { tone: 'warning', label: 'Wait suggested' }) : null,
    !waiting && suggested ? jsx('p', { children: `${suggested.set_by} suggests waiting on ${waitText(suggested)}.` }) : null,
    !waiting && suggested?.evidence ? jsx('p', { className: 'dockyard-meta', children: `Evidence: ${suggested.evidence}` }) : null,
    !waiting && !suggested && prefill?.who ? jsx('p', { className: 'dockyard-meta', children: `Suggested from the card: waiting on ${waitText(prefill)}` }) : null,
    !waiting && !suggested && !prefill?.who ? jsx('p', { className: 'dockyard-meta', children: 'Not waiting on anyone outside the fleet.' }) : null,
    jsx('div', { className: 'dockyard-form-actions', children: actions }),
    editing ? jsx(WaitDialog, { initiative, record: editing, busy, onCancel: () => setEditing(null), onSave: save }) : null,
    clearing ? jsx(ClearDialog, { initiative, suggested: Boolean(suggested && !waiting), busy, onCancel: () => setClearing(false), onConfirm: clear }) : null,
  ] })
}

// ApprovalDetail's fleet state: the owner candidates and this initiative's
// owner hint (GET /dispatch) and its waiting records.
export function useFleetDecision(ref) {
  const [state, setState] = useState({ mode: 'loading' })
  const [version, setVersion] = useState(0)
  const [ownerOpen, setOwnerOpen] = useState(false)
  useEffect(() => {
    let current = true
    setState({ mode: 'loading' })
    setOwnerOpen(false)
    fleetRead('/dispatch', '/waiting').then((result) => {
      if (!current) return
      if (result.mode !== 'fleet') { setState(result); return }
      setState({
        mode: 'fleet',
        profiles: result.data?.profiles ?? [],
        entry: (result.data?.initiatives ?? []).find((row) => row.ref === ref) ?? {},
        waiting: result.extra?.waiting?.[ref] ?? null,
        suggested: result.extra?.suggested?.[ref] ?? null,
        waitError: result.extraError ?? null,
      })
    })
    return () => { current = false }
  }, [ref, version])
  // Until the backend is known, and when a fleet backend cannot list owners,
  // Approve stays shut: approving without an owner would leave its card unassigned.
  return { ...state, ownerOpen, setOwnerOpen, blocked: state.mode === 'loading' || state.mode === 'unavailable', reload: () => setVersion((value) => value + 1) }
}

export function FleetApproval({ item, decision, fleet, busy, onApprove }) {
  if (fleet.mode === 'unavailable') {
    return jsx('p', { className: 'dockyard-inline-error', role: 'alert', 'data-fleet-owner-error': true,
      children: `Owner list unavailable: ${fleet.error}. This fleet names an owner on approval; refresh before approving.` })
  }
  if (fleet.mode !== 'fleet') return null
  const initiative = { ref: item.ref, title: decision?.title ?? item.title, project_id: decision?.project_id ?? item.project }
  return jsxs(Fragment, { children: [
    jsxs('section', { className: 'dockyard-inbox-section', 'data-fleet-waiting-section': true, children: [
      jsx('h3', { children: 'Waiting on' }),
      fleet.waitError ? jsx('p', { className: 'dockyard-inline-error', role: 'alert', children: `Waiting records unavailable: ${fleet.waitError}` }) : null,
      jsx(FleetWait, { initiative, waiting: fleet.waiting, suggested: fleet.suggested, onChanged: fleet.reload }),
    ] }),
    fleet.ownerOpen ? jsx(OwnerDialog, { initiative, profiles: fleet.profiles, entry: fleet.entry, approve: true, busy,
      onCancel: () => fleet.setOwnerOpen(false), onConfirm: async (owner) => { await onApprove(owner); fleet.setOwnerOpen(false) } }) : null,
  ] })
}

// The Dashboard's fleet state: owner candidates (GET /dispatch) and the
// Needs-you queue, reloaded with every Dashboard load.
export function useFleetNeeds(view) {
  const [state, setState] = useState({ mode: 'loading' })
  useEffect(() => {
    let current = true
    fleetRead('/dispatch', '/needs-you').then((result) => {
      if (!current) return
      setState(result.mode !== 'fleet' ? result : {
        mode: 'fleet',
        dispatch: result.data ?? {},
        queue: result.extra ?? { items: [], waiting: {}, suggested: {}, errors: [] },
        errors: result.extraError ? [result.extraError] : result.extra?.errors ?? [],
      })
    })
    return () => { current = false }
  }, [view])
  return state
}

export function FleetNeedsErrors({ fleet }) {
  const errors = fleet?.mode === 'fleet' ? fleet.errors : fleet?.mode === 'unavailable' ? [fleet.error] : []
  if (!errors.length) return null
  return jsx('div', { 'data-fleet-needs-errors': true, children: errors.map((error, index) =>
    jsx('p', { className: 'dockyard-inline-error dockyard-command-empty', role: 'alert', children: `Needs you: ${error}` }, index)) })
}

// The fleet half of the Dashboard's detail panel for the selected row.
export function FleetNeedPanel({ item, fleet, onChanged }) {
  const [owning, setOwning] = useState(false)
  const [busy, setBusy] = useState(false)
  const need = needFor(item, fleet)
  if (!need) return null
  if (need.kind === 'resolved') return jsx('p', { className: 'dockyard-meta', 'data-fleet-need': 'resolved', children: 'No longer in the Needs-you queue.' })
  const initiative = { ref: need.ref, title: need.title, project_id: need.project_id }
  const facts = [
    need.card_id ? `card ${need.card_id} on ${need.board}${need.card_title && need.card_title !== need.title ? ` · ${need.card_title}` : ''}` : null,
    need.kind === 'blocked_card' ? `${need.assignee ? `assigned to ${need.assignee}` : 'unassigned'}${need.block_kind ? ` · ${String(need.block_kind).replaceAll('_', ' ')}` : ''}` : null,
    need.task_id && !need.card_id ? `Implement card ${need.task_id}` : null,
  ].filter(Boolean).join(' · ')
  const dispatch = async (owner) => {
    setBusy(true)
    const result = await dispatchOwner({ ref: need.ref, projectId: need.project_id, owner })
    setBusy(false)
    if (result) { setOwning(false); onChanged?.() }
  }
  return jsxs('div', { className: 'dockyard-fleet-need', 'data-fleet-need': need.kind, style: { minWidth: 0, overflowWrap: 'anywhere' }, children: [
    facts ? jsx('p', { className: 'dockyard-meta', children: facts }) : null,
    need.kind !== 'approval' && need.detail ? jsx('p', { children: need.detail }) : null,
    need.steps ? jsx('h4', { children: need.kind === 'wait_suggested' ? 'Evidence' : 'Next action' }) : null,
    need.steps && need.steps_from ? jsx('p', { className: 'dockyard-meta', children: `From ${need.steps_from}` }) : null,
    need.steps ? jsx('p', { style: { whiteSpace: 'pre-wrap' }, children: need.steps }) : null,
    need.kind === 'blocked_card' && !need.steps ? jsx('p', { children: `Next action not recorded. Ask ${need.assignee || 'the project lead'} to record what will unblock this card.` }) : null,
    need.kind === 'undispatched' ? jsx(Button, { variant: 'primary', action: 'fleet-open-dispatch', onClick: () => setOwning(true), children: 'Dispatch' }) : null,
    need.ref ? jsx('h4', { children: 'Waiting on' }) : null,
    need.ref ? jsx(FleetWait, { initiative, waiting: fleet.queue.waiting?.[need.ref] ?? null, suggested: fleet.queue.suggested?.[need.ref] ?? null,
      prefill: need.suggestion, onChanged }, need.ref) : null,
    owning ? jsx(OwnerDialog, { initiative, profiles: fleet.dispatch.profiles ?? [], busy, onCancel: () => setOwning(false), onConfirm: dispatch,
      entry: (fleet.dispatch.initiatives ?? []).find((row) => row.ref === need.ref) ?? {} }) : null,
  ] })
}

const BLANK = Object.freeze({ project_id: '', name: '', repo_path: '', mission: '', lead_profile: '', board_slug: '', autonomy_level: '2' })

// The fleet binds a native Hermes project to an existing Kanban board in the
// Hermes root and never creates one: "New project" lands here too, and says so.
function BindOnlyWizard({ intent, options, error: loadError, onRetry, onClose, onComplete }) {
  useDialogFocusManager('[data-onboarding-wizard]')
  const [form, setForm] = useState(BLANK)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  useEscape(submitting, onClose)
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const boards = boardsFor(options?.boards, form.project_id)
  const submit = async () => {
    setSubmitting(true)
    setError(null)
    const body = onboardBody(form)
    try {
      const result = await api('/onboard', { method: 'POST', body, suppressErrorToast: true })
      onComplete({ ...result, project_id: result?.project_id ?? body.project_id })
    } catch (failure) {
      setError(message(failure))
      setSubmitting(false)
    }
  }
  const input = (key, label, props = {}) => [
    jsx('label', { htmlFor: `dockyard-fleet-onboard-${key}`, children: label }, `${key}-label`),
    jsx(props.rows ? 'textarea' : 'input', { id: `dockyard-fleet-onboard-${key}`, 'data-field': key.replaceAll('_', '-'), value: form[key], autoComplete: 'off', disabled: submitting, onChange: set(key), ...props }, key),
  ]
  const select = (key, label, choices, placeholder) => [
    jsx('label', { htmlFor: `dockyard-fleet-onboard-${key}`, children: label }, `${key}-label`),
    jsxs('select', { id: `dockyard-fleet-onboard-${key}`, 'data-field': key.replaceAll('_', '-'), value: form[key], disabled: submitting, onChange: set(key), children: [
      placeholder ? jsx('option', { value: '', children: placeholder }) : null,
      ...choices.map(([value, text]) => jsx('option', { value, children: text }, value)),
    ] }, key),
  ]
  return jsx('div', { className: 'dockyard-modal-backdrop', children:
    jsxs('section', { className: 'dockyard-onboarding', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'dockyard-onboarding-title',
      'data-onboarding-wizard': true, 'data-onboarding-intent': intent === 'existing' ? 'existing' : 'new', 'data-fleet-onboarding': 'bind-only', children: [
        jsxs('header', { className: 'dockyard-onboarding-head', children: [
          jsxs('div', { children: [
            jsx('span', { className: 'dockyard-card-label', children: intent === 'existing' ? 'EXISTING PROJECT' : 'NEW PROJECT' }),
            jsx('h2', { id: 'dockyard-onboarding-title', children: 'Bring a project into Project Stewardship' }),
            jsx('p', { children: 'Bind-only: enables stewardship and binds a native Hermes project to an existing Kanban board in the Hermes root.' }),
          ] }),
          jsx('button', { type: 'button', className: 'dockyard-modal-close', 'aria-label': 'Close onboarding', disabled: submitting, onClick: onClose, children: '×' }),
        ] }),
        jsx('div', { className: 'dockyard-wizard-body', children: jsxs('div', { className: 'dockyard-wizard-step active', 'data-wizard-step': 'bind', children: [
          intent === 'existing' ? null : jsx('p', { className: 'dockyard-review-note', 'data-fleet-new-project-guard': true,
            children: 'This fleet never creates Kanban boards, so a new project is bound like an existing one. Create its board in the Hermes root first (hermes kanban boards create <slug>), then choose it below.' }),
          loadError ? jsxs('div', { children: [
            jsx('p', { className: 'dockyard-inline-error', role: 'alert', 'data-discovery-failed': true, children: `Boards and profiles unavailable: ${loadError}. Onboarding stays closed until the host answers.` }),
            jsx(Button, { action: 'refresh-onboarding-discovery', small: true, onClick: onRetry, children: 'Retry' }),
          ] }) : null,
          ...input('project_id', 'Project ID', { placeholder: 'payments-relaunch' }),
          jsx('small', { children: form.project_id && !SLUG.test(form.project_id) ? "Must be lowercase letters, digits, '-' or '_'." : 'Lowercase letters, digits, hyphens and underscores.' }),
          ...input('name', 'Display name (optional)'),
          ...input('repo_path', 'Repository path', { placeholder: '/opt/data/.../repos/<repo>' }),
          jsx('small', { children: 'An existing git checkout inside the Hermes root.' }),
          ...input('mission', 'Mission', { rows: 4, placeholder: 'Reduce payment failures without weakening release gates.' }),
          ...select('lead_profile', 'Lead profile', (options?.profiles ?? []).map((name) => [name, name]), 'Select a lead profile'),
          ...select('board_slug', 'Existing board', boards.map((board) => [board.slug, `${board.slug}${board.name && board.name !== board.slug ? ` · ${board.name}` : ''}${board.project ? ' (bound)' : ''}`]),
            boards.length ? 'Choose a board' : 'No unbound boards'),
          ...select('autonomy_level', 'Autonomy level', ['0', '1', '2', '3'].map((level) => [level, level])),
        ] }) }),
        error ? jsx('p', { className: 'dockyard-inline-error', role: 'alert', children: error }) : null,
        jsxs('footer', { className: 'dockyard-wizard-actions', children: [
          jsx(Button, { action: 'cancel-onboarding', disabled: submitting, onClick: onClose, children: 'Cancel' }),
          jsx(Button, { action: 'submit-onboarding', variant: 'primary', disabled: submitting || !options || !onboardValid(form), onClick: submit,
            children: submitting ? 'Onboarding…' : 'Bind and onboard' }),
        ] }),
      ] }),
  })
}

// Upstream's wizard against a vanilla backend; on the fleet, the bind-only
// form with GET /onboard/options, closed (never upstream's board-creating
// form) when the options cannot be read.
export function FleetOnboarding(props) {
  const [state, setState] = useState({ mode: 'loading' })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let current = true
    fleetRead('/onboard/options').then((result) => { if (current) setState(result) })
    return () => { current = false }
  }, [version])
  if (state.mode === 'loading') return null
  if (state.mode === 'vanilla') return jsx(OnboardingWizard, props)
  return jsx(BindOnlyWizard, { ...props, options: state.data ?? null, error: state.mode === 'unavailable' ? state.error : null, onRetry: () => setVersion((value) => value + 1) })
}

// The fleet hands the project lead its memory each cycle (its steward_status
// tool), not through upstream's pre_llm_call hook, which it keeps off.
export function FleetMemoryNote() {
  const [fleet, setFleet] = useState(false)
  useEffect(() => {
    let current = true
    fleetRead().then((result) => { if (current) setFleet(result.mode === 'fleet') })
    return () => { current = false }
  }, [])
  return fleet ? jsx('p', { className: 'dockyard-meta', 'data-fleet-memory-note': true, children: 'Shared with the project lead each cycle.' }) : null
}
