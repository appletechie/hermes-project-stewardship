import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { fixtureBrowser } from './browser-harness.mjs'
import { pickProject } from './test-support/project-scope.mjs'
import { controlFixture } from './test-support/fleet-control-fixture.mjs'

const require = createRequire(new URL('../dashboard/package.json', import.meta.url))
const { buildSync } = require('esbuild')
const webBundle = readFileSync(new URL('../fleet_web/dist/index.js', import.meta.url), 'utf8')
const bootstrap = buildSync({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__HERMES_PLUGIN_SDK__ = {React, authedFetch: (url, options) => fetch(url, options)};
    window.__HERMES_PLUGINS__ = {register: (_name, App) => createRoot(document.getElementById('root')).render(React.createElement(App))};`,
    resolveDir: fileURLToPath(new URL('../dashboard/', import.meta.url)) },
  bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent',
}).outputFiles[0].text

const hostHtml = (web) => `<!doctype html><html style="--background-base:#fff;--midground-base:#171717;--theme-font-sans:system-ui"><head><style>
  body{margin:0;font-family:system-ui}#host{display:flex;width:100%;min-width:0}#sidebar{width:248px;flex:0 0 248px;background:#ddd;min-height:100vh}
  #content{flex:1;min-width:0}#root{width:100%;min-width:0}*{box-sizing:border-box}
  </style></head><body><div id="host"><aside id="sidebar" aria-label="Host sidebar"></aside><main id="content"><div id="root"></div></main></div>
  ${web ? '<script src="/control-bootstrap.js"></script><script src="/control-web.js"></script>' : '<script type="module" src="/bundle.js"></script>'}</body></html>`

test('Desktop and web control center: scope, text, links, failures, controls and responsive host layout', { timeout: 180000 }, async () => {
  await fixtureBrowser(async (page, base) => {
    const errors = []
    const controlRequests = []
    const mutations = []
    let failure = false
    let vanilla = false
    let missingRegistry = false
    let freshNative = false
    let serveFreshCard = false
    let expiryBase = null
    let heldProject = null
    let release
    let held
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.route('**/control-bootstrap.js', (route) => route.fulfill({ contentType: 'text/javascript', body: bootstrap }))
    await page.route('**/control-web.js', (route) => route.fulfill({ contentType: 'text/javascript', body: webBundle }))
    await page.route('**/control-desktop', (route) => route.fulfill({ contentType: 'text/html', body: hostHtml(false) }))
    await page.route('**/control-web', (route) => route.fulfill({ contentType: 'text/html', body: hostHtml(true) }))
    await page.route('**/api/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname.replace(/^\/api(?:\/plugins\/hermes-project-stewardship)?/, '')
      if (request.method() !== 'GET') mutations.push(path)
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (path === '/health') return json({ fleet: !vanilla })
      if (path === '/settings/last-project') return json({ project_id: 'payments-relaunch' })
      if (path === '/settings/appearance') return json({ theme: 'auto', font: 'system' })
      if (path === '/dispatch') return json({ profiles: ['coder'], initiatives: [] })
      if (path === '/needs-you') return json({ items: [], waiting: {}, suggested: {}, errors: [] })
      if (path === '/projects/mobile-client/work-items' && serveFreshCard) return json({ work_items: [
        { ref: 'NEW-CONTROL-ONLY', title: 'New native card', status: 'in_progress', type: 'task', assignee: 'coder' },
      ] })
      if (path === '/control-center') {
        const project = url.searchParams.get('project_id')
        controlRequests.push({ project, method: request.method() })
        if (heldProject === project) await held
        if (failure) return json({ detail: 'Control source unavailable' }, 503)
        const data = controlFixture(project)
        if (freshNative && project === 'mobile-client') data.work[0].native.card_id = 'NEW-CONTROL-ONLY'
        if (expiryBase !== null) {
          data.capabilities.expires_at = new Date(expiryBase + 2000).toISOString()
          data.capabilities.items[0].expires_at = new Date(expiryBase + 1000).toISOString()
        }
        if (missingRegistry) data.capabilities = { state: 'unavailable', reason: 'registry_missing', observed_at: null, expires_at: null, items: [] }
        return json(data)
      }
      if (url.pathname.startsWith('/api/plugins/')) return route.fulfill({ response: await route.fetch({ url: `${base}/api${path}${url.search}` }) })
      return route.continue()
    })
    for (const variant of ['desktop', 'web']) {
      await page.setViewportSize({ width: 1024, height: 1024 })
      await page.goto(`${base}/control-${variant}`)
      const panel = page.locator('[data-fleet-control-center]')
      const project = panel.locator('[data-control-project="payments-relaunch"]')
      await project.waitFor()
      assert.equal(await project.getAttribute('open'), null, 'project details start collapsed even with one selected project')
      assert.match(await project.locator(':scope > summary').innerText(), /4 team entries \(1 blocked, 1 stale\)/)
      const overview = await page.getByRole('heading', { name: 'Command Center', exact: true }).boundingBox()
      const metrics = await page.locator('[data-metric]').first().boundingBox()
      assert.ok(overview && overview.y + overview.height <= 1024, `${variant}: overview header stays above the fold`)
      assert.ok(metrics && metrics.y + metrics.height <= 1024, `${variant}: overview KPIs stay above the fold`)
      if (process.env.FLEET_CONTROL_SCREENSHOTS) {
        mkdirSync(process.env.FLEET_CONTROL_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: `${process.env.FLEET_CONTROL_SCREENSHOTS}/${variant}-initial-collapsed.png`, animations: 'disabled' })
      }
      await project.locator(':scope > summary').click()
      await panel.locator('[data-control-principal="hermes:techie"]').waitFor()
      assert.match(await panel.innerText(), /Hermes Techie/)
      assert.match(await panel.innerText(), /ChatGPT Techie/)
      assert.match(await panel.innerText(), /Grok ProjectsManager/)
      assert.equal(await panel.locator('[data-control-principal="paseo:integration"] strong').innerText(), 'Paseo')
      assert.match(await panel.innerText(), /Next action: Connect the supported project app/)
      assert.match(await panel.innerText(), /Observation stale/)
      assert.doesNotMatch(await panel.innerText(), /OTHER PROJECT SECRET|mobile-client/)
      assert.equal(await panel.locator('img').count(), 0)
      assert.equal(await page.evaluate(() => window.controlInjected), undefined)
      const principal = panel.locator('[data-control-principal="hermes:techie"]')
      await principal.locator('summary').click()
      assert.match(await principal.innerText(), /Effective tools\s+Unverified/)
      assert.match(await principal.innerText(), /Configuration context\s+Main gateway; private operator settings are separate/)
      assert.match(await principal.innerText(), /cli: read_file, terminal/)
      assert.match(await principal.innerText(), /Legacy tool configuration\s+legacy-shell/)
      assert.match(await principal.innerText(), /Disabled tools\s+unsafe_tool/)
      assert.match(await principal.innerText(), /Known plugins by surface\s+cli: memory-plugin/)
      assert.match(await principal.innerText(), /Disabled plugins\s+disabled-plugin/)
      assert.match(await principal.innerText(), /atlassian-rovo \(configured enabled; included tools: getJiraIssue; excluded tools: deleteIssue; effective unverified\)/)
      assert.match(await principal.innerText(), /unrestricted-example \(configured enabled; no include restriction configured; effective unverified\)/)
      assert.match(await principal.innerText(), /Local: 2 · External: 96/)
      const work = panel.locator('[data-control-work]')
      await work.locator('summary').click()
      assert.match(await work.innerText(), /Jira\s+Not linked\s+Paseo\s+Not linked/)
      assert.match(await work.innerText(), /<img src=x onerror=/)
      assert.equal(await work.locator('a').count(), 1)
      assert.equal(await work.locator('a').getAttribute('rel'), 'noopener noreferrer')
      assert.equal(await work.locator('a').getAttribute('href'), 'https://github.com/example/fixture')
      await principal.locator('summary').click()
      await work.locator('summary').click()

      const colours = new Map()
      for (const width of [1024, 1440, 1920]) for (const sidebar of [true, false]) for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 1100 })
        await page.evaluate(({ sidebar, theme, variant }) => {
          document.getElementById('sidebar').style.display = sidebar ? '' : 'none'
          document.documentElement.style.setProperty('--background-base', theme === 'dark' ? '#171717' : '#ffffff')
          document.documentElement.style.setProperty('--midground-base', theme === 'dark' ? '#f5f5f5' : '#171717')
          if (variant === 'desktop') window.__setHostTheme({ renderedMode: theme })
        }, { sidebar, theme, variant })
        await page.locator(`.dockyard-root[data-theme="${theme}"]`).waitFor()
        await page.evaluate(async () => {
          window.scrollTo(0, 0)
          await Promise.all(document.getAnimations().filter((animation) => animation instanceof CSSTransition).map((animation) => animation.finished.catch(() => {})))
        })
        const geometry = await panel.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          const host = document.getElementById('content').getBoundingClientRect()
          const children = [...element.querySelectorAll('article,button,a,summary')].filter((node) => node.getClientRects().length)
          return { left: bounds.left, right: bounds.right, hostLeft: host.left, hostRight: host.right,
            width: element.clientWidth, scrollWidth: element.scrollWidth,
            clipped: children.filter((node) => { const rect = node.getBoundingClientRect(); return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 }).map((node) => node.textContent),
            background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }
        })
        const context = `${variant} ${width} sidebar=${sidebar} ${theme}`
        assert.ok(geometry.left >= geometry.hostLeft && geometry.right <= geometry.hostRight + 1, context)
        assert.ok(geometry.scrollWidth <= geometry.width + 1, context)
        assert.deepEqual(geometry.clipped, [], context)
        colours.set(theme, [geometry.background, geometry.color])
        if (process.env.FLEET_CONTROL_SCREENSHOTS) {
          mkdirSync(process.env.FLEET_CONTROL_SCREENSHOTS, { recursive: true })
          await page.screenshot({ path: `${process.env.FLEET_CONTROL_SCREENSHOTS}/${variant}-${width}-${sidebar ? 'open' : 'closed'}-${theme}.png`, animations: 'disabled' })
        }
      }
      assert.notDeepEqual(colours.get('light'), colours.get('dark'), 'host theme changes panel colours')

      heldProject = 'mobile-client'
      held = new Promise((resolve) => { release = resolve })
      await pickProject(page, 'mobile-client')
      await panel.getByText('Reading project connections…').waitFor()
      assert.equal(await panel.locator('[data-control-project="payments-relaunch"]').count(), 0, 'old project is removed while next read is pending')
      release()
      heldProject = null
      await panel.locator('[data-control-project="mobile-client"] > summary').click()
      await panel.locator('[data-control-project="mobile-client"] [data-control-work]').waitFor()
      assert.equal(await panel.locator('[data-control-project="payments-relaunch"]').count(), 0)

      missingRegistry = true
      await panel.getByRole('button', { name: 'Refresh connections' }).click()
      await panel.locator('[data-control-project="mobile-client"] > summary').getByText(/Team evidence unavailable/).waitFor()
      await panel.locator('[data-control-project="mobile-client"] > summary').click()
      await panel.getByText('Capability evidence is unavailable. Connection readiness is unknown.').waitFor()
      assert.equal(await panel.locator('[data-control-work]').count(), 1, 'native work remains usable without a registry')
      failure = true
      await panel.getByRole('button', { name: 'Refresh connections' }).click()
      await panel.locator('[data-control-project="mobile-client"] > summary').click()
      await panel.getByText('Control center unavailable: 503: Control source unavailable', { exact: true }).waitFor()
      await panel.getByRole('button', { name: 'Project settings' }).click()
      await page.locator('[data-project-view="settings"].active').waitFor()
      failure = missingRegistry = false
      await page.locator('[data-tab="dashboard"]').click()
      await panel.locator('[data-control-project="mobile-client"] > summary').click()
      await panel.locator('[data-control-work]').waitFor()
      await panel.getByRole('button', { name: 'Approvals', exact: true }).click()
      await page.locator('[data-tab="inbox"][aria-selected="true"]').waitFor()
      assert.equal(await page.locator('.dy-sw-trigger').getAttribute('data-scope'), 'mobile-client')

      freshNative = true
      await page.locator('[data-tab="dashboard"]').click()
      await pickProject(page, '*')
      const newlyBound = panel.locator('[data-control-project="mobile-client"]')
      await newlyBound.locator(':scope > summary').click()
      assert.match(await newlyBound.innerText(), /NEW-CONTROL-ONLY/)
      serveFreshCard = true
      await newlyBound.getByRole('button', { name: 'Open native work' }).click()
      await page.locator('[data-work-item-detail="NEW-CONTROL-ONLY"]').waitFor()
      assert.equal(await page.locator('.dy-sw-trigger').getAttribute('data-scope'), 'mobile-client', 'fresh native card carries its own project from All projects')
      assert.equal(await page.locator('[data-project-chooser="Projects"]').count(), 0)
      freshNative = serveFreshCard = false

      vanilla = true
      const before = controlRequests.length
      await page.goto(`${base}/control-${variant}`)
      await page.waitForLoadState('networkidle')
      assert.equal(await page.locator('[data-fleet-control-center]').count(), 0)
      assert.equal(controlRequests.length, before, 'vanilla backend receives no fleet control-center requests')
      vanilla = false
    }
    expiryBase = Date.now() + 10000
    await page.clock.install({ time: new Date(expiryBase - 10000) })
    await page.goto(`${base}/control-web`)
    const expiring = page.locator('[data-control-project="payments-relaunch"]')
    await expiring.locator(':scope > summary').click()
    await page.clock.pauseAt(new Date(expiryBase))
    const requestsBeforeExpiry = controlRequests.length
    assert.match(await expiring.locator('[data-control-principal="hermes:techie"]').innerText(), /Observation current/)
    await page.clock.runFor(1001)
    assert.match(await expiring.locator('[data-control-principal="hermes:techie"]').innerText(), /Observation stale/)
    assert.match(await expiring.locator(':scope > summary').innerText(), /2 stale\).*Registry current/)
    await page.clock.runFor(1001)
    assert.match(await expiring.locator(':scope > summary').innerText(), /4 stale\).*Registry stale/)
    assert.equal(controlRequests.length, requestsBeforeExpiry, 'expiry recomputes locally without polling the server')
    await page.clock.resume()
    assert.ok(controlRequests.length > 0)
    assert.ok(controlRequests.every((request) => request.method === 'GET'))
    assert.deepEqual(mutations.filter((path) => path !== '/settings/last-project' && path !== '/notifications/popups/shown'), [])
    assert.deepEqual(errors, [])
  })
})
