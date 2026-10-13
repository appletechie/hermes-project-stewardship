// Fleet web build: the `@hermes/plugin-sdk` host surface desktop/src uses
// (navigate, newChat, notify), mapped onto the Hermes web dashboard.
// profileRoutes/activeConnectionId are Desktop connection concepts with no
// dashboard equivalent; project/chat.js falls back to the profile name.
import { useEffect, useState } from './react.js'

export function useTheme() {
  const read = () => document.documentElement.dataset.hermesMode
  const [renderedMode, setRenderedMode] = useState(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setRenderedMode(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-hermes-mode'] })
    setRenderedMode(read())
    return () => observer.disconnect()
  }, [])
  return { renderedMode }
}

const BASE_PATH = (() => {
  const raw = (typeof window === 'undefined' ? '' : window.__HERMES_BASE_PATH__) || ''
  if (!raw) return ''
  return (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/+$/, '')
})()

// The dashboard's BrowserRouter follows popstate, so a pushState plus a
// popstate event moves the SPA without a reload. `idx` keeps React Router's
// history index consistent.
function go(path) {
  const url = `${BASE_PATH}${path}`
  if (`${window.location.pathname}${window.location.search}` === url) return
  const state = { usr: null, key: Math.random().toString(36).slice(2, 10), idx: (window.history.state?.idx ?? 0) + 1 }
  window.history.pushState(state, '', url)
  window.dispatchEvent(new PopStateEvent('popstate', { state }))
}

// The dashboard's Chat page runs under the profile in `?profile=`; a changed
// profile starts a fresh chat with it.
function chatPath(target) {
  const profile = typeof target === 'string' ? target : target?.targetProfile ?? target?.profile
  return profile ? `/chat?profile=${encodeURIComponent(profile)}` : '/chat'
}

const TOAST_CSS = `
.hps-fleet-toasts { position: fixed; right: 16px; bottom: 16px; z-index: 1000; display: grid; gap: 8px; width: min(360px, calc(100vw - 32px)); }
.hps-fleet-toast { display: grid; gap: 6px; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--midground-base, #ffe6cb) 20%, transparent); border-radius: var(--radius, 8px); background: color-mix(in srgb, var(--midground-base, #ffe6cb) 6%, var(--background-base, #041c1c)); color: var(--midground-base, #ffe6cb); font: 14px/1.4 var(--theme-font-sans, system-ui, sans-serif); box-shadow: 0 12px 30px rgba(0, 0, 0, .35); }
.hps-fleet-toast strong { font-weight: 600; }
.hps-fleet-toast p { margin: 0; opacity: .85; }
.hps-fleet-toast-actions { display: flex; gap: 8px; justify-content: flex-end; }
.hps-fleet-toast button { padding: 4px 10px; border: 1px solid color-mix(in srgb, var(--midground-base, #ffe6cb) 30%, transparent); border-radius: calc(var(--radius, 8px) - 2px); background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
.hps-fleet-toast button[data-primary] { background: var(--midground-base, #ffe6cb); color: var(--background-base, #041c1c); }
`

function toastRegion() {
  let region = document.querySelector('.hps-fleet-toasts')
  if (region) return region
  const style = document.createElement('style')
  style.dataset.hpsFleetToasts = 'true'
  style.textContent = TOAST_CSS
  document.head.appendChild(style)
  region = document.createElement('div')
  region.className = 'hps-fleet-toasts'
  region.setAttribute('aria-live', 'polite')
  document.body.appendChild(region)
  return region
}

// Reads the fields Hermes Desktop's host.notify reads that matter on the web:
// id (a repeat replaces), title, message, detail, action, secondaryAction,
// onDismiss, durationMs.
function notify(item) {
  const region = toastRegion()
  const id = String(item?.id ?? `hps-${Date.now()}`)
  const previous = [...region.children].find((el) => el.dataset.toastId === id)
  previous?.remove()
  const toast = document.createElement('div')
  toast.className = 'hps-fleet-toast'
  toast.dataset.toastId = id
  toast.setAttribute('role', item?.kind === 'error' ? 'alert' : 'status')
  const close = () => {
    if (!toast.isConnected) return
    toast.remove()
    item?.onDismiss?.()
  }
  const text = (tag, value) => {
    if (!value) return
    const el = document.createElement(tag)
    el.textContent = String(value)
    toast.appendChild(el)
  }
  text('strong', item?.title)
  text('p', item?.message)
  text('p', item?.detail)
  const actions = document.createElement('div')
  actions.className = 'hps-fleet-toast-actions'
  const button = (label, onClick, primary) => {
    const el = document.createElement('button')
    el.type = 'button'
    el.textContent = label
    if (primary) el.dataset.primary = 'true'
    el.addEventListener('click', () => { onClick?.(); close() })
    actions.appendChild(el)
  }
  if (item?.action?.label) button(item.action.label, item.action.onClick, true)
  if (item?.secondaryAction?.label) button(item.secondaryAction.label, item.secondaryAction.onClick, false)
  button('Dismiss', null, false)
  toast.appendChild(actions)
  region.appendChild(toast)
  const duration = Number(item?.durationMs)
  if (duration !== 0) window.setTimeout(close, duration > 0 ? duration : 10000)
}

export const host = {
  navigate: (path) => go(path),
  newChat: (target) => go(chatPath(target)),
  notify,
}
