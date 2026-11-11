import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../src/app/store.js';

// A stand-in for the browser's local storage and for the account database the page
// talks to inside the Claude viewer (documents in collections, with live listeners).

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function fakeAccount(initial = {}) {
  const data = { profiles: new Map(Object.entries(initial.profiles || {})), sessions: new Map(Object.entries(initial.sessions || {})) };
  const listeners = { profiles: [], sessions: [] };
  const account = { data, refuseWrites: false, answer: true };
  const snap = (kind) => ({ metadata: { fromCache: false }, empty: data[kind].size === 0, docs: [...data[kind]].map(([id, v]) => ({ id, data: () => v })) });
  const tell = (kind) => {
    if (account.answer) for (const fn of listeners[kind]) fn(snap(kind));
  };
  account.start = () => {
    account.answer = true;
    tell('profiles');
    tell('sessions');
  };
  const root = {
    collection: (kind) => ({
      doc: (id) => ({
        set: async (v) => {
          if (account.refuseWrites) throw new Error('offline');
          data[kind].set(id, v);
          tell(kind);
        },
        delete: async () => {
          if (account.refuseWrites) throw new Error('offline');
          data[kind].delete(id);
          tell(kind);
        },
      }),
      onSnapshot: (fn) => {
        listeners[kind].push(fn);
        queueMicrotask(() => tell(kind));
      },
    }),
  };
  account.claude = { use: async (name) => (name === 'db' ? { doc: () => root } : { id: async () => 'u1' }) };
  return account;
}

const tick = () => new Promise((r) => setTimeout(r, 5));
const profile = (id, at = 1) => ({ id, name: id, hand: 'right', heightCm: null, createdAt: at });
const session = (id, profileId, at = 1) => ({ id, profileId, mode: 'quick', createdAt: at, distance: 'mid', shots: [], clips: [], app: '1' });
const stored = () => JSON.parse(globalThis.localStorage.getItem('shotlab.v1') || '{"profiles":[],"sessions":[]}');

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
  globalThis.window = {};
});

test('without an account, history is kept in the browser and survives a reload', async () => {
  const a = createStore();
  await a.connect();
  assert.equal(a.state.mode, 'local');
  await a.saveProfile(profile('p1'));
  await a.saveSession(session('s1', 'p1'));
  const b = createStore();
  assert.deepEqual(b.state.profiles.map((p) => p.id), ['p1']);
  assert.deepEqual(b.sessionsFor('p1').map((s) => s.id), ['s1']);
  await b.deleteProfile('p1');
  assert.equal(createStore().state.sessions.length, 0, 'deleting a profile removes its sessions');
});

test('history made on the device is carried over to an account that already has some', async () => {
  const account = fakeAccount({ profiles: { cloudP: { name: 'cloud', hand: 'right', heightCm: null, createdAt: 5 } } });
  account.answer = false; // the account is slow to answer
  globalThis.window = { claude: account.claude };
  const store = createStore();
  const connecting = store.connect();
  await tick();
  // Saved while the account has not answered yet.
  await store.saveProfile(profile('p1', 9));
  await store.saveSession(session('s1', 'p1', 9));
  assert.equal(store.state.mode, 'local');
  account.start();
  await connecting;
  await tick();
  assert.equal(store.state.mode, 'cloud');
  assert.deepEqual(store.state.profiles.map((p) => p.id).sort(), ['cloudP', 'p1'], 'both the account profile and the new one are shown');
  assert.ok(account.data.profiles.has('p1') && account.data.sessions.has('s1'), 'the new items reached the account');
  assert.deepEqual(stored(), { profiles: [], sessions: [] }, 'the device copies are dropped once the account has them');
  assert.equal(store.state.waiting, 0);
});

test('a save the account does not confirm is kept on the device and sent on the next visit', async () => {
  const account = fakeAccount({ profiles: { p1: { name: 'p1', hand: 'right', heightCm: null, createdAt: 1 } } });
  globalThis.window = { claude: account.claude };
  const store = createStore();
  await store.connect();
  await tick();
  assert.equal(store.state.mode, 'cloud');
  account.refuseWrites = true;
  await store.saveSession(session('s1', 'p1')); // must not throw: the device has it
  assert.deepEqual(store.state.sessions.map((s) => s.id), ['s1']);
  assert.equal(store.state.waiting, 1);
  assert.deepEqual(stored().sessions.map((s) => s.id), ['s1']);
  assert.ok(!account.data.sessions.has('s1'));
  // Next visit, with the account reachable again.
  account.refuseWrites = false;
  const again = createStore();
  await again.connect();
  await tick();
  assert.ok(account.data.sessions.has('s1'), 'sent to the account');
  assert.deepEqual(again.state.sessions.map((s) => s.id), ['s1']);
  assert.equal(again.state.waiting, 0);
  assert.deepEqual(stored(), { profiles: [], sessions: [] });
});

test('deleting something held on the device does not bring it back later', async () => {
  const account = fakeAccount();
  globalThis.window = { claude: account.claude };
  const store = createStore();
  await store.connect();
  await tick();
  account.refuseWrites = true;
  await store.saveProfile(profile('p1'));
  assert.equal(store.state.waiting, 1);
  account.refuseWrites = false;
  await store.deleteProfile('p1');
  assert.equal(store.state.profiles.length, 0);
  assert.equal(store.state.waiting, 0);
  const again = createStore();
  await again.connect();
  await tick();
  assert.equal(again.state.profiles.length, 0);
  assert.ok(!account.data.profiles.has('p1'));
});
