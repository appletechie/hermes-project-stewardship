export function controlFixture(project = 'payments-relaunch', now = Date.now()) {
  const observed_at = new Date(now - 60000).toISOString()
  const expires_at = new Date(now + 3600000).toISOString()
  const principal = (principal_id, display_name, extra = {}) => ({
    principal_id, display_name, system: principal_id.split(':')[0], profile: null,
    projects: [project], coordinator: 'hermes:orchestrator', role: 'Scoped contributor', state: 'configured',
    observed_at, expires_at, freshness: 'current', source: 'profile_config',
    scope: 'display_only', context: 'main',
    tools: { configured_by_surface: { cli: ['read_file', 'terminal'], photon: ['web_search'] },
      configured_legacy: ['legacy-shell'], disabled: ['unsafe_tool'], known_plugins_by_surface: { cli: ['memory-plugin'] }, effective: 'unverified' },
    plugins: ['project-stewardship'], disabled_plugins: ['disabled-plugin'],
    mcp: [{ name: 'atlassian-rovo', enabled: true, selection: 'include', tools: ['getJiraIssue'], excluded_tools: ['deleteIssue'], effective: 'unverified' },
      { name: 'unrestricted-example', enabled: true, selection: 'unrestricted', tools: [], excluded_tools: [], effective: 'unverified' }],
    skills: { local_count: 2, external_count: 96 },
    model: { provider: 'openai-codex', default: 'model-example', fallback_providers: [{ provider: 'example', model: 'fallback-example' }], effective: 'unverified' },
    blocker: null, evidence: [], ...extra,
  })
  return {
    schema_version: 1, project_id: project, observed_at,
    capabilities: { state: 'current', reason: null, observed_at, expires_at, items: [
      principal('hermes:techie', 'Techie'),
      principal('chatgpt-dot:techie', 'Techie', { state: 'blocked', source: 'integration_audit',
        blocker: { owner: 'Andrew', reason: 'Native read has not succeeded', next_action: 'Connect the supported project app and record a read receipt.' } }),
      principal('grokbot:projectsmanager', 'ProjectsManager', { state: 'untested', expires_at: new Date(now - 1000).toISOString(), freshness: 'stale' }),
      principal('paseo:integration', 'Paseo', { state: 'untested' }),
      principal('hermes:other', 'OTHER PROJECT SECRET', { projects: ['other-project'] }),
    ] },
    work: [{ work_id: `initiative:${project}:INIT-EXAMPLE-1`, initiative_ref: 'INIT-EXAMPLE-1',
      title: '<img src=x onerror=window.controlInjected=true> ' + 'x'.repeat(150), status: 'executing', needs_dispatch: false,
      native: { board: project, card_id: 'HDY-12', owner: 'coder', status: 'in_progress' }, card_error: null,
      jira: null, paseo: [], evidence: [
        { kind: 'result', reference: 'https://github.com/example/fixture', observed_at },
        { kind: 'result', reference: 'javascript:window.controlInjected=true', observed_at },
      ] }],
    needs_you: [{ project_id: project, kind: 'blocked_card', title: 'Needs a person' }, { project_id: 'other-project', kind: 'blocked_card', title: 'OTHER PROJECT SECRET' }],
    sources: { dispatch: 'current', needs_you: 'current' }, truncated: { capabilities: false, work: false, needs_you: false },
  }
}
