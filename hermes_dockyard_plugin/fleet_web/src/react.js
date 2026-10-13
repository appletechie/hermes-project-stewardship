// Fleet web build: `react` and `react/jsx-runtime` for desktop/src, served by
// the Hermes web dashboard's own React (window.__HERMES_PLUGIN_SDK__.React) so
// the tab never ships a second copy.
const sdk = typeof window === 'undefined' ? undefined : window.__HERMES_PLUGIN_SDK__
if (!sdk?.React) throw new Error('[hermes-project-stewardship] Hermes plugin SDK (React) is not present')
const React = sdk.React

export default React
export const { Fragment, createElement, useCallback, useEffect, useMemo, useReducer, useRef, useState } = React

// The automatic JSX runtime passes `key` apart from props. jsx() carries one
// child (or none) in props; jsxs() carries a static array, handed to
// createElement as separate arguments so React treats it as static children,
// not as a list that needs keys.
export function jsx(type, props, key) {
  return createElement(type, key === undefined ? props : { ...props, key })
}

export function jsxs(type, props, key) {
  const { children, ...rest } = props
  if (key !== undefined) rest.key = key
  // desktop/src writes jsxs() calls by hand: anything but an array stays a prop.
  return Array.isArray(children) ? createElement(type, rest, ...children) : createElement(type, { ...rest, children })
}

export const jsxDEV = jsx
