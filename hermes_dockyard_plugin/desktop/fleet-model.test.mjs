// Fleet additions (src/fleet/): the backend probe, the Needs-you rows, waits
// and the bind-only onboarding body, as pure functions.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const model = await import('./src/fleet/model.js')

const QUEUE = {
  mode: 'fleet',
  dispatch: { profiles: ['techie'], initiatives: [] },
  queue: {
    today: '2026-10-12',
    waiting: { 'INIT-1': { who: 'Apple', reference: 'case 42', expected_by: '2026-10-20', wait_status: 'active', set_by: 'andrew' } },
    suggested: {},
    errors: [],
    items: [
      { kind: 'approval', ref: 'INIT-9', project_id: 'mv', title: 'Pending' },
      { kind: 'blocked_card', ref: null, project_id: 'mv', card_id: 't_1', card_title: 'Card', title: 'Card', board: 'mv', since: '2026-10-10T08:00:00Z', detail: 'needs login' },
      { kind: 'undispatched', ref: 'INIT-2', project_id: 'mv', title: 'Ship it', since: '2026-10-11T08:00:00Z', detail: 'Implement card unassigned' },
      { kind: 'wait_due', ref: 'INIT-3', project_id: 'other', title: 'Elsewhere', since: '2026-10-01' },
    ],
  },
}

const UPSTREAM = [
  { kind: 'initiative_approval', ref: 'INIT-9', project: 'mv' },
  { kind: 'work_attention', cause: 'blocked_item', ref: 't_1', project: 'mv' },
  { kind: 'work_attention', cause: 'blocked_item', ref: 't_2', project: 'mv' },
]

test('Needs-you rows: approvals stay upstream, the fleet row replaces its card, scope keeps only shown projects', () => {
  const rows = model.withFleetRows(UPSTREAM, QUEUE, ['mv'])
  assert.deepEqual(rows.map((row) => `${row.kind}:${row.ref}`),
    ['initiative_approval:INIT-9', 'work_attention:t_2', 'fleet_blocked_card:card t_1', 'fleet_undispatched:INIT-2'])
  const [, , blocked, undispatched] = rows
  assert.equal(blocked.age_days, 2)
  assert.equal(blocked.deep_link, 's2:work/t_1')
  assert.equal(model.fleetIssueLabels(blocked).open, 'Open work item')
  assert.equal(undispatched.deep_link, 's1:project/mv')
  assert.deepEqual(model.fleetIssueLabels(undispatched), { tag: 'Needs owner', tone: 'notice', impact: 'Implement card unassigned', open: 'Open project' })
  assert.equal(model.withFleetRows(UPSTREAM, { mode: 'vanilla' }, ['mv']), UPSTREAM)
})

test('a selected row is re-read from the latest queue, and an upstream approval maps to its initiative', () => {
  const undispatched = model.withFleetRows([], QUEUE, ['mv'])[1]
  assert.equal(model.needFor(undispatched, QUEUE).kind, 'undispatched')
  const later = { ...QUEUE, queue: { ...QUEUE.queue, items: [] } }
  assert.equal(model.needFor(undispatched, later).kind, 'resolved')
  assert.deepEqual(model.needFor({ kind: 'initiative_approval', ref: 'INIT-9', project: 'mv', title: 'Pending' }, QUEUE),
    { kind: 'approval', ref: 'INIT-9', project_id: 'mv', title: 'Pending' })
  assert.equal(model.needFor({ kind: 'blocked_item', ref: 'W-1' }, QUEUE), null)
  assert.equal(model.needFor(undispatched, { mode: 'vanilla' }), null)
})

test('waits: label, validity and the confirmed-wait body', () => {
  const record = QUEUE.queue.waiting['INIT-1']
  assert.equal(model.waitText(record), 'Apple (case 42) until 2026-10-20')
  assert.equal(model.waitStatus(record), 'Waiting')
  assert.equal(model.waitStatus({ ...record, wait_status: 'overdue' }), 'Wait overdue')
  assert.equal(model.waitTone({ wait_status: 'overdue' }), 'danger')
  assert.equal(model.waitValid({ who: ' ', expected_by: '2026-10-20' }), false)
  assert.equal(model.waitValid({ who: 'Apple', expected_by: '', recheck_after: '' }), false)
  assert.equal(model.waitValid({ who: 'Apple', recheck_after: '2026-10-14' }), true)
  assert.deepEqual(model.waitBody('mv', { who: ' Apple ', reference: '', expected_by: '2026-10-20', evidence: 'ignored' }),
    { state: 'waiting', project_id: 'mv', who: 'Apple', reference: null, expected_by: '2026-10-20', recheck_after: null, note: null })
})

test('dispatch result message', () => {
  assert.equal(model.dispatchMessage('INIT-2', { changed: true, owner: 'techie', task_id: 't_9', status: 'ready' }, true),
    'INIT-2 approved, dispatched to techie · card t_9 ready')
  assert.equal(model.dispatchMessage('INIT-2', { changed: false, owner: 'techie', task_id: 't_9', status: 'in_progress' }, false),
    'INIT-2 already with techie · card t_9 in progress')
})

test('bind-only onboarding: boards on offer, validity and the exact fleet body', () => {
  const boards = [{ slug: 'free' }, { slug: 'mine', project: 'mv' }, { slug: 'theirs', project: 'other' }]
  assert.deepEqual(model.boardsFor(boards, 'mv').map((board) => board.slug), ['free', 'mine'])
  const form = { project_id: 'mv', name: ' ', repo_path: ' /opt/data/repos/mv ', mission: ' Keep it running ', lead_profile: 'techie', board_slug: 'mine', autonomy_level: '3' }
  assert.equal(model.onboardValid(form), true)
  assert.equal(model.onboardValid({ ...form, project_id: 'MV' }), false)
  assert.equal(model.onboardValid({ ...form, repo_path: 'repos/mv' }), false)
  assert.equal(model.onboardValid({ ...form, board_slug: '' }), false)
  assert.deepEqual(model.onboardBody(form), { project_id: 'mv', name: '', repo_path: '/opt/data/repos/mv', mission: 'Keep it running',
    lead_profile: 'techie', board_slug: 'mine', autonomy_level: 3 })
})
