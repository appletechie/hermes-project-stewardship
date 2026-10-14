import test from 'node:test'
import assert from 'node:assert/strict'
import { capabilityFreshness, controlCenterView, controlProjects, refreshControlCenter, safeEvidenceUrl } from './src/fleet/model.js'
import { controlFixture } from './test-support/fleet-control-fixture.mjs'

const NOW = Date.parse('2026-10-14T07:00:00Z')
const payload = () => controlFixture('payments-relaunch', NOW)

test('project scope requires an explicit listed project; identities and work anchors remain distinct', () => {
  const projects = [{ id: 'payments-relaunch' }, { id: 'mobile-client' }, { id: '../unsafe' }, { id: 'mobile-client' }]
  assert.deepEqual(controlProjects(projects, '*'), ['payments-relaunch', 'mobile-client'])
  assert.deepEqual(controlProjects(projects, 'mobile-client'), ['mobile-client'])
  assert.deepEqual(controlProjects(projects, null), [])
  const data = payload()
  data.capabilities.items.push({ ...data.capabilities.items[0], principal_id: 'hermes:unscoped', projects: [] })
  data.work.push({ ...data.work[0], work_id: 'initiative:mobile-client:INIT-EXAMPLE-1' })
  const view = controlCenterView(data, 'payments-relaunch', NOW)
  assert.deepEqual(view.capabilities.items.map((item) => item.label), ['Hermes Techie', 'ChatGPT Techie', 'Grok ProjectsManager', 'Paseo'])
  assert.equal(view.work.length, 1)
  assert.equal(view.work[0].work_id, data.work[0].work_id)
  assert.equal(view.needs_you.length, 1)
  assert.doesNotMatch(JSON.stringify(view), /OTHER PROJECT SECRET/)
  assert.deepEqual(view, controlCenterView(data, 'payments-relaunch', NOW))
  assert.equal(controlCenterView(data, 'mobile-client', NOW).mode, 'unavailable')
  assert.equal(controlCenterView({ ...data, schema_version: 2 }, 'payments-relaunch', NOW).mode, 'unavailable')
})

test('capability configuration never becomes tested and observation expiry stays independent', () => {
  const data = payload()
  data.capabilities.items[0].tools.effective = ['pretend_verified_tool']
  data.capabilities.items[0].mcp[1].effective = 'tested'
  const view = controlCenterView(data, 'payments-relaunch', NOW)
  const [hermes, chatgpt, grok] = view.capabilities.items
  assert.equal(hermes.state, 'configured')
  assert.equal(chatgpt.state, 'blocked')
  assert.equal(chatgpt.freshness, 'current')
  assert.equal(grok.state, 'untested')
  assert.equal(grok.freshness, 'stale')
  assert.deepEqual(hermes.tools.configured_by_surface, [{ surface: 'cli', names: ['read_file', 'terminal'] }, { surface: 'photon', names: ['web_search'] }])
  assert.deepEqual(hermes.tools.configured_legacy, ['legacy-shell'])
  assert.deepEqual(hermes.tools.disabled, ['unsafe_tool'])
  assert.deepEqual(hermes.tools.known_plugins_by_surface, [{ surface: 'cli', names: ['memory-plugin'] }])
  assert.equal(hermes.tools.effective, 'unverified')
  assert.deepEqual(hermes.disabled_plugins, ['disabled-plugin'])
  assert.deepEqual(hermes.skills, { local_count: 2, external_count: 96 })
  assert.equal(hermes.mcp[0].name, 'atlassian-rovo')
  assert.equal(hermes.mcp[0].selection, 'include')
  assert.deepEqual(hermes.mcp[0].excluded_tools, ['deleteIssue'])
  assert.equal(hermes.mcp[1].selection, 'unrestricted')
  assert.equal(hermes.mcp[1].effective, 'unverified')
  assert.equal(hermes.model.fallback_providers[0], 'example / fallback-example')
  assert.doesNotMatch(JSON.stringify(view), /pretend_verified_tool/)
  assert.equal(capabilityFreshness({ ...data.capabilities.items[0], observed_at: new Date(NOW + 61000).toISOString() }, data.capabilities, NOW), 'unknown')
  assert.equal(capabilityFreshness({ ...data.capabilities.items[0], observed_at: null }, data.capabilities, NOW), 'unknown')
  assert.equal(capabilityFreshness(data.capabilities.items[0], { ...data.capabilities, state: 'stale' }, NOW), 'stale')
})

test('missing registry, partial native data and null fields do not fabricate work links or a healthy empty source', () => {
  const data = payload()
  data.capabilities = { state: 'unavailable', reason: 'registry_missing', items: data.capabilities.items }
  data.work[0].native = null
  data.work[0].needs_dispatch = true
  data.sources = { dispatch: 'partial' }
  const view = controlCenterView(data, 'payments-relaunch', NOW)
  assert.deepEqual(view.capabilities.items, [])
  assert.equal(view.capabilities.reason, 'registry_missing')
  assert.deepEqual(view.sources, { dispatch: 'partial', needs_you: 'unavailable' })
  assert.deepEqual(view.work[0].native, { board: '', card_id: '', owner: '', status: '' })
  assert.equal(view.work[0].jira, null)
  assert.deepEqual(view.work[0].paseo, [])
  assert.equal(view.work[0].needs_dispatch, true)
  const broken = payload()
  Object.assign(broken.capabilities.items[0], { tools: null, mcp: [null], skills: null, model: null, blocker: null })
  broken.work[0].card_error = 'binding_unavailable'
  assert.equal(controlCenterView(broken, 'payments-relaunch', NOW).work[0].native.card_id, '')
})

test('retained observations expire locally at both the row and registry boundaries', () => {
  const data = payload()
  data.capabilities.items[0].expires_at = new Date(NOW + 1000).toISOString()
  data.capabilities.expires_at = new Date(NOW + 2000).toISOString()
  const initial = controlCenterView(data, 'payments-relaunch', NOW)
  const rowExpired = refreshControlCenter(initial, NOW + 1000)
  assert.equal(rowExpired.capabilities.state, 'current')
  assert.equal(rowExpired.capabilities.items[0].freshness, 'stale')
  assert.equal(rowExpired.capabilities.items[1].freshness, 'current')
  const registryExpired = refreshControlCenter(rowExpired, NOW + 2000)
  assert.equal(registryExpired.capabilities.state, 'stale')
  assert.equal(registryExpired.capabilities.reason, 'registry_expired')
  assert.ok(registryExpired.capabilities.items.every((item) => item.freshness === 'stale'))
  assert.equal(initial.capabilities.state, 'current')
  assert.equal(initial.capabilities.items[0].freshness, 'current')
  assert.equal(controlCenterView(data, 'payments-relaunch', NOW + 2000).capabilities.state, 'stale')
})

test('evidence links require HTTPS, an allowed origin and no embedded credentials', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/private', 'http://github.com/a', '//github.com/a',
    'https://github.com.evil.example/a', 'https://evil.example/a', 'https://user:password@github.com/a', 'https://github.com:9443/a',
    'https://a.b.atlassian.net/a', ' https://github.com/a']) assert.equal(safeEvidenceUrl(url), null, url)
  assert.equal(safeEvidenceUrl('https://github.com/example/fixture'), 'https://github.com/example/fixture')
  assert.equal(safeEvidenceUrl('https://example.atlassian.net/browse/TEST-1'), 'https://example.atlassian.net/browse/TEST-1')
})
