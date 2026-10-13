// Fleet web build entry: runs the Desktop plugin (desktop/src, unchanged) as
// a Hermes web dashboard tab. It gives the plugin the context Hermes Desktop
// gives it (rest, os, registerMany), renders the captured /dockyard route in
// the dashboard's plugin registry, and makes the default theme (Match Hermes)
// follow the dashboard's theme.
import plugin from '../../desktop/src/index.js'
import React from './react.js'

const NAME = 'hermes-project-stewardship'
const API_PREFIX = `/api/plugins/${NAME}`
const sdk = window.__HERMES_PLUGIN_SDK__ // present: ./react.js refuses to load without it

// Desktop's plugin REST door: paths stay inside the plugin's own namespace.
function restUrl(path) {
  const suffix = String(path).startsWith('/') ? String(path) : `/${path}`
  if (suffix.split(/[?#]/, 1)[0].split('/').includes('..')) throw new Error(`rest: illegal path traversal in "${path}"`)
  return `${API_PREFIX}${suffix}`
}

function detailOf(text) {
  try {
    const detail = JSON.parse(text)?.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail === 'object') return detail.message ?? detail.detail ?? JSON.stringify(detail)
  } catch {
    // not JSON: the raw text is the detail
  }
  return text
}

// Errors read "<status>: <detail>" as Desktop's do, so runtime/context.js
// recognises "404: Plugin not found", unlinked projects and the rest.
async function rest(path, init = {}) {
  const method = init.method || 'GET'
  const hasBody = init.body !== undefined && method !== 'GET'
  const response = await sdk.authedFetch(restUrl(path), {
    method,
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${response.status}: ${detailOf(text) || response.statusText}`)
  return text ? JSON.parse(text) : null
}

// Match Hermes on the web: the dashboard theme's two colours (background and
// midground, the text and primary colour) drive the neutral, text and action
// tokens, mixed the way the dashboard mixes its own cards and borders. Status
// colours stay the app's contrast-checked light/dark ones. The other themes
// and the font picker are an explicit choice and stay as designed. The tab's
// wrapper takes the content column's width and never its content's, so
// nothing in the app can widen the dashboard page. Also drops
// the Desktop window's full-viewport minimum height inside the scrolling tab,
// and gives headings back the bold weight the dashboard's CSS reset
// (Tailwind preflight) takes away and the app's own rules assume.
const mix = (pct) => `color-mix(in srgb, var(--midground-base) ${pct}%, var(--background-base))`
const HOST_CSS = `
.hps-fleet-web { width: 100%; max-width: 100%; min-width: 0; contain: inline-size; overflow-x: clip; }
.hps-fleet-web .dockyard-root { min-height: 100%; }
.hps-fleet-web :where(h1, h2, h3, h4, h5, h6) { font-weight: bold; }
.hps-fleet-web .dockyard-root:not([data-dy-font]) { font-family: var(--theme-font-sans); }
.hps-fleet-web .dockyard-root[data-dy-theme="auto"][data-theme] {
  --dy-bg: var(--background-base);
  --dy-surface: ${mix(4)};
  --dy-surface-subtle: ${mix(7)};
  --dy-surface-strong: ${mix(11)};
  --dy-text: var(--midground-base);
  --dy-text-2: ${mix(80)};
  --dy-text-3: ${mix(68)};
  --dy-border: ${mix(16)};
  --dy-control-border: ${mix(42)};
  --dy-action: var(--midground-base);
  --dy-action-hover: ${mix(86)};
  --dy-on-action: var(--background-base);
  --dy-accent-text: var(--midground-base);
  --dy-accent-soft: ${mix(12)};
  --dy-accent-border: ${mix(36)};
  --dy-neutral: ${mix(80)};
  --dy-neutral-bg: ${mix(10)};
  --dy-focus: var(--midground-base);
  --dy-disabled-text: ${mix(68)};
  --dy-disabled-bg: ${mix(11)};
  color: var(--dy-text);
  background: var(--dy-bg);
}
`

// The app reads light or dark from <html data-hermes-mode> (Hermes Desktop
// sets it). The dashboard has no such flag, so it follows the luminance of the
// theme's background, re-read whenever the dashboard rewrites its theme
// variables on <html>.
function isDarkColour(rgb) {
  const [r, g, b] = (String(rgb).match(/[\d.]+/g) ?? []).map(Number)
  if (![r, g, b].every(Number.isFinite)) return true
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
}

function followDashboardMode() {
  const html = document.documentElement
  const probe = document.createElement('span')
  probe.hidden = true
  probe.style.color = 'var(--background-base, #041c1c)'
  document.body.appendChild(probe)
  const read = () => {
    const mode = isDarkColour(getComputedStyle(probe).color) ? 'dark' : 'light'
    if (html.dataset.hermesMode !== mode) html.dataset.hermesMode = mode
  }
  read()
  new MutationObserver(read).observe(html, { attributes: true, attributeFilter: ['style', 'class'] })
}

function register() {
  const registry = window.__HERMES_PLUGINS__
  if (typeof registry?.register !== 'function') {
    console.error(`[${NAME}] Hermes plugin SDK not present`)
    return
  }
  const style = document.createElement('style')
  style.dataset.hpsFleetWeb = 'true'
  style.textContent = HOST_CSS
  document.head.appendChild(style)
  followDashboardMode()

  let page = null
  plugin.register({
    rest,
    os: { writeClipboard: (text) => navigator.clipboard.writeText(String(text)).then(() => true, () => false) },
    registerMany(items) {
      page = items.find((item) => item.area === 'routes') ?? page
    },
  })
  const ProjectStewardshipTab = () => React.createElement('div', { className: 'hps-fleet-web' }, page ? page.render() : null)
  registry.register(NAME, ProjectStewardshipTab)
}

register()
