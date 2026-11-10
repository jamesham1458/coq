// Shot Lab: boot, state and routing.

import { createStore } from './app/store.js';
import { h, mount } from './app/dom.js';
import { hideTip } from './app/charts.js';
import { canCompileWasm, loadEngine } from './engine/pose.js';
import { releaseClip, processClip } from './app/pipeline.js';
import { openClip } from './engine/video.js';
import { homeView } from './app/views/home.js';
import { captureView } from './app/views/capture.js';
import { reportView } from './app/views/report.js';
import { progressView } from './app/views/progress.js';
import { profilesView } from './app/views/profiles.js';
import { guideView } from './app/views/guide.js';
import { exampleReport } from './app/session.js';

const ROUTES = {
  home: homeView,
  quick: (app) => captureView(app, 'quick'),
  assess: (app) => captureView(app, 'full'),
  report: reportView,
  progress: progressView,
  profiles: profilesView,
  guide: guideView,
};

function emptyDraft(mode) {
  return { mode, distance: 'mid', clips: [], sessionId: null, error: null };
}

function start(restored) {
  const store = createStore();
  const viewEl = document.getElementById('view');
  const cleanups = [];
  const engineListeners = new Set();

  const app = {
    store,
    state: {
      route: 'home',
      engine: { status: canCompileWasm() ? 'idle' : 'blocked', fraction: 0, message: '', delegate: null },
      drafts: { quick: emptyDraft('quick'), full: emptyDraft('full') },
      /** true while a clip is being analysed; the view must not be torn down under it */
      busy: null,
      /** what the report page shows: { kind: 'draft'|'session'|'example', session, clips, saved } */
      shown: null,
      profileNote: '',
    },

    go(route) {
      if (location.hash === `#${route}`) render();
      else location.hash = route;
    },
    refresh() {
      render();
    },
    /** Register a function to run when the current view is torn down. */
    onLeave(fn) {
      cleanups.push(fn);
    },

    profile() {
      const { profiles } = store.state;
      if (!profiles.length) return null;
      const id = store.getActiveProfileId();
      return profiles.find((p) => p.id === id) || profiles[0];
    },
    setProfile(id) {
      store.setActiveProfileId(id);
      paintWho();
    },

    resetDraft(mode) {
      for (const clip of app.state.drafts[mode].clips) releaseClip(clip);
      app.state.drafts[mode] = emptyDraft(mode);
    },

    /** Start downloading and starting the pose engine if that has not happened yet. */
    ensureEngine() {
      const eng = app.state.engine;
      if (eng.status === 'blocked' || eng.status === 'loading' || eng.status === 'ready') return;
      const set = (patch) => {
        Object.assign(eng, patch);
        for (const fn of engineListeners) fn(eng);
      };
      set({ status: 'loading', fraction: 0, message: '' });
      loadEngine((stage, fraction) => {
        if (stage === 'model') set({ status: 'loading', fraction: fraction * 0.9 });
        else if (stage === 'runtime') set({ status: 'loading', fraction: 0.92 });
      }, app.engineOptions())
        .then((engine) => set({ status: 'ready', fraction: 1, delegate: engine.delegate }))
        .catch((e) => set({ status: e && e.stage === 'wasm' ? 'blocked' : 'failed', message: (e && e.message) || 'The pose engine could not start.' }));
    },
    onEngine(fn) {
      engineListeners.add(fn);
      return () => engineListeners.delete(fn);
    },
    engineOptions() {
      // A test hook: lets automated checks force the CPU path.
      const cfg = typeof window !== 'undefined' ? window.shotLabConfig : null;
      return cfg && cfg.delegate ? { delegate: cfg.delegate } : {};
    },
    readerOption() {
      // A test hook: lets automated checks force one video reader.
      const cfg = typeof window !== 'undefined' ? window.shotLabConfig : null;
      return cfg && cfg.reader ? cfg.reader : undefined;
    },
  };

  function paintWho() {
    const p = app.profile();
    const dot = document.getElementById('who-dot');
    const name = document.getElementById('who-name');
    if (!dot || !name) return;
    dot.textContent = p ? (p.name.trim()[0] || '?').toUpperCase() : '+';
    name.textContent = p ? p.name : 'Add a shooter';
  }

  function currentRoute() {
    const name = (location.hash || '#home').slice(1);
    return ROUTES[name] ? name : 'home';
  }

  function render() {
    const route = currentRoute();
    app.state.route = route;
    while (cleanups.length) {
      try {
        cleanups.pop()();
      } catch (e) {
        console.error(e);
      }
    }
    hideTip();
    for (const a of document.querySelectorAll('.nav a')) {
      if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    paintWho();
    let node;
    try {
      node = ROUTES[route](app);
    } catch (e) {
      console.error(e);
      node = h('div', { class: 'stack' }, h('h1', null, 'Something went wrong on this screen'), h('p', { class: 'muted' }, String((e && e.message) || e)), h('a', { class: 'btn', href: '#home' }, 'Back to home'));
    }
    mount(viewEl, node);
  }

  let lastRoute = currentRoute();
  window.addEventListener('hashchange', () => {
    const next = currentRoute();
    // Leaving or redrawing the capture screen mid-analysis would orphan the running job,
    // so put the address back and leave the screen alone. Stop is the way out.
    if (app.state.busy) {
      if (next !== lastRoute) location.hash = lastRoute;
      return;
    }
    lastRoute = next;
    render();
    window.scrollTo(0, 0);
    viewEl.focus({ preventScroll: true });
  });

  document.getElementById('who').addEventListener('click', () => app.go('profiles'));

  // Stored data arriving (or changing on another device) repaints screens that show it.
  store.onChange(() => {
    paintWho();
    if (app.state.busy) return;
    if (['home', 'progress', 'profiles'].includes(app.state.route)) render();
  });

  if (restored && typeof restored.route === 'string' && ROUTES[restored.route] && !location.hash) {
    location.hash = restored.route;
  }
  render();
  store.connect();

  // Handles for automated browser checks.
  window.shotLab = { app, openClip, processClip, exampleReport };
}

// Keep the viewer's place when the page is republished while open.
const hot = typeof window !== 'undefined' && window.claude ? window.claude.hot : null;
if (hot && typeof hot.snapshot === 'function') {
  hot.snapshot(() => ({ route: (location.hash || '#home').slice(1) }));
}
if (hot && typeof hot.ready === 'function') hot.ready(start);
else start((hot && hot.data) || {});
