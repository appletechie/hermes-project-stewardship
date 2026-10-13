// Fleet web bundle: self-contained, registers with the dashboard, talks to
// its own plugin namespace, and matches its sources.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const BUNDLE = readFileSync(`${HERE}dist/index.js`, 'utf8')
const require = createRequire(`${HERE}../dashboard/package.json`)
const { JSDOM } = require('jsdom')
const React = require('react')
const { renderToString } = require('react-dom/server')

test('committed dist/index.js is reproducible from its sources', () => {
  execFileSync(process.execPath, [`${HERE}build.mjs`, '--check'], { stdio: 'pipe' })
})

test('bundle has no module imports left for the browser to resolve', () => {
  assert.doesNotMatch(BUNDLE, /^\s*(import|export)\s/m)
  assert.doesNotMatch(BUNDLE, /\brequire\(/)
  assert.doesNotMatch(BUNDLE, /from\s+["'](react|react\/jsx-runtime|@hermes\/plugin-sdk)["']/)
})

test('registers the tab, calls its own plugin API and surfaces pop-ups', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://127.0.0.1/' })
  const { window } = dom
  const calls = []
  const registered = []
  window.__HERMES_PLUGIN_SDK__ = {
    React,
    authedFetch: async (url, init) => {
      calls.push(JSON.parse(JSON.stringify({ url, method: init.method, headers: init.headers, body: init.body })))
      const body = url.endsWith('/notifications/popups') ? { popups: [{ id: 7, title: 'Gate waiting', body: 'Review it' }], more: 0 } : {}
      return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(body) }
    },
  }
  window.__HERMES_PLUGINS__ = { register: (name, component) => registered.push([name, component]) }
  window.eval(BUNDLE)
  try {
    assert.equal(registered.length, 1)
    assert.equal(registered[0][0], 'hermes-project-stewardship')
    assert.match(renderToString(React.createElement(registered[0][1])), /class="hps-fleet-web"><div class="dockyard-root"/)
    for (let n = 0; n < 40 && calls.length < 2; n++) await new Promise((resolve) => setTimeout(resolve, 100))
    assert.deepEqual(calls[0], { url: '/api/plugins/hermes-project-stewardship/notifications/popups', method: 'GET' })
    assert.deepEqual(calls[1], { url: '/api/plugins/hermes-project-stewardship/notifications/popups/shown', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ids":[7]}' })
    assert.match(window.document.querySelector('.hps-fleet-toast').textContent, /Gate waiting.*Review it/)
  } finally {
    window.clearInterval(window.__dockyardPopupPoller)
    window.close()
  }
})
