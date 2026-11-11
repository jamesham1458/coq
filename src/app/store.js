// Profiles and session history.
//
// Inside the Claude viewer these live in the page's database, in the part that is
// private to each signed-in person, so they follow the person across devices. Anywhere
// else (or when signed out) they fall back to this browser's local storage.
// Only measurements are stored. Videos and still frames never leave the device.
//
// Local storage doubles as a holding place: anything saved before the account's history
// has loaded, or that the account did not confirm, is kept there and sent to the account
// the next time it connects. Nothing saved is ever dropped because the account was slow.

const LOCAL_KEY = 'shotlab.v1';
const ACTIVE_KEY = 'shotlab.activeProfile';

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (data && Array.isArray(data.profiles) && Array.isArray(data.sessions)) return data;
  } catch {
    // Storage can be unavailable (private window, blocked site data); start empty.
  }
  return { profiles: [], sessions: [] };
}

function writeLocal(data) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function newId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

/**
 * @typedef {{ id:string, name:string, hand:'left'|'right', heightCm:number|null, createdAt:number }} Profile
 * @typedef {{ id:string, profileId:string, mode:'quick'|'full', createdAt:number, distance:string|null, shots:object[], clips:object[], app:string }} Session
 */

const KINDS = ['profiles', 'sessions'];
/** How long to wait for the account to confirm a write before keeping a copy on the device. */
const CONFIRM_MS = 6000;

function confirmed(promise, ms = CONFIRM_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The account did not confirm the save in time.')), ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function createStore() {
  const listeners = new Set();
  const state = {
    /** 'local' until the cloud store answers, then 'cloud' when it is usable */
    mode: 'local',
    /** 'pending' | 'ready' | 'slow' | 'error' */
    cloud: 'pending',
    /** true when the last save to the device failed (storage full or blocked) */
    localBlocked: false,
    /** items kept on this device that the account has not confirmed yet */
    waiting: 0,
    profiles: [],
    sessions: [],
  };
  const local = readLocal();
  state.profiles = local.profiles;
  state.sessions = local.sessions;
  let cloudRoot = null;
  /** what the account holds, as last reported */
  const remote = { profiles: [], sessions: [] };
  /** items on this device that the account does not have yet */
  const held = { profiles: [], sessions: [] };

  const emit = () => {
    for (const fn of listeners) {
      try {
        fn(state);
      } catch (e) {
        console.error(e);
      }
    }
  };
  const persistLocal = () => {
    state.localBlocked = !writeLocal({ profiles: state.profiles, sessions: state.sessions });
  };
  const sortAll = () => {
    state.profiles.sort((a, b) => a.createdAt - b.createdAt);
    state.sessions.sort((a, b) => b.createdAt - a.createdAt);
  };
  sortAll();

  /** In cloud mode the view is the account's items plus the ones still held on the device. */
  const showCloud = () => {
    for (const kind of KINDS) {
      const have = new Set(remote[kind].map((x) => x.id));
      held[kind] = held[kind].filter((x) => !have.has(x.id));
      state[kind] = [...remote[kind], ...held[kind]];
    }
    state.waiting = held.profiles.length + held.sessions.length;
    sortAll();
  };
  const hold = (kind, item) => {
    held[kind] = [...held[kind].filter((x) => x.id !== item.id), item];
    const data = readLocal();
    data[kind] = [...data[kind].filter((x) => x.id !== item.id), item];
    return writeLocal(data);
  };
  const unhold = (kind, id) => {
    held[kind] = held[kind].filter((x) => x.id !== id);
    const data = readLocal();
    if (data[kind].some((x) => x.id === id)) {
      data[kind] = data[kind].filter((x) => x.id !== id);
      writeLocal(data);
    }
  };

  /** Send everything held on this device to the account; forget the local copies once it has them all. */
  async function sendHeld(root) {
    const data = readLocal();
    for (const kind of KINDS) {
      const have = new Set(remote[kind].map((x) => x.id));
      held[kind] = data[kind].filter((x) => !have.has(x.id));
    }
    showCloud();
    emit();
    let all = true;
    for (const kind of KINDS) {
      for (const item of [...held[kind]]) {
        try {
          await confirmed(root.collection(kind).doc(item.id).set(strip(item)));
        } catch {
          all = false;
        }
      }
    }
    if (all && (data.profiles.length || data.sessions.length)) {
      // Keep anything that was put on hold while this was running.
      const now = readLocal();
      const sent = { profiles: new Set(data.profiles.map((x) => x.id)), sessions: new Set(data.sessions.map((x) => x.id)) };
      writeLocal({ profiles: now.profiles.filter((x) => !sent.profiles.has(x.id)), sessions: now.sessions.filter((x) => !sent.sessions.has(x.id)) });
      for (const kind of KINDS) held[kind] = held[kind].filter((x) => !sent[kind].has(x.id));
    }
  }

  async function connect() {
    const claude = typeof window !== 'undefined' ? window.claude : null;
    if (!claude || typeof claude.use !== 'function') {
      state.cloud = 'error';
      emit();
      return;
    }
    let db;
    let uid;
    try {
      const [dbNs, userNs] = await Promise.all([claude.use('db'), claude.use('user')]);
      db = dbNs;
      uid = userNs ? await userNs.id() : null;
    } catch {
      db = null;
    }
    if (!db || !uid) {
      state.cloud = 'error';
      emit();
      return;
    }
    let root;
    try {
      root = db.doc(`data/users/${uid}/shotlab`);
    } catch {
      state.cloud = 'error';
      emit();
      return;
    }
    const got = { profiles: false, sessions: false };
    const slowTimer = setTimeout(() => {
      if (!(got.profiles && got.sessions)) {
        state.cloud = 'slow';
        emit();
      }
    }, 10000);
    const settle = async () => {
      if (!(got.profiles && got.sessions) || state.mode === 'cloud') return;
      clearTimeout(slowTimer);
      cloudRoot = root;
      state.mode = 'cloud';
      state.cloud = 'ready';
      // History made on this device (before signing in, or while the account could not
      // be reached) is carried over to the account.
      await sendHeld(root);
      showCloud();
      emit();
    };
    const fail = () => {
      clearTimeout(slowTimer);
      // Until the account has answered, the device's own history stays on screen untouched.
      if (state.mode !== 'cloud') state.cloud = 'error';
      emit();
    };
    const docs = (snap) => snap.docs.map((d) => ({ ...clone(d.data()), id: d.id }));
    for (const kind of KINDS) {
      root.collection(kind).onSnapshot((snap) => {
        if (snap.metadata && snap.metadata.fromCache && !got[kind] && snap.empty) return;
        remote[kind] = docs(snap);
        got[kind] = true;
        if (state.mode === 'cloud') {
          showCloud();
          emit();
        } else settle();
      }, fail);
    }
  }

  function strip(obj) {
    const { id, ...rest } = obj;
    return clone(rest);
  }
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  async function put(kind, item) {
    const list = state[kind];
    const at = list.findIndex((x) => x.id === item.id);
    if (at >= 0) list[at] = item;
    else list.push(item);
    sortAll();
    emit();
    if (state.mode === 'cloud' && cloudRoot) {
      try {
        await confirmed(cloudRoot.collection(kind).doc(item.id).set(strip(item)));
      } catch {
        // Not confirmed by the account: keep it on this device and send it next time.
        const kept = hold(kind, item);
        showCloud();
        emit();
        if (!kept) throw new Error('It could not be saved to your account or to this device.');
      }
    } else {
      persistLocal();
      if (state.localBlocked) throw new Error('This browser would not save the data.');
    }
  }

  async function remove(kind, id) {
    state[kind] = state[kind].filter((x) => x.id !== id);
    if (state.mode === 'cloud' && cloudRoot) {
      // A copy held on the device must go too, or it would come back on the next visit.
      unhold(kind, id);
      state.waiting = held.profiles.length + held.sessions.length;
      emit();
      await confirmed(cloudRoot.collection(kind).doc(id).delete());
    } else {
      emit();
      persistLocal();
    }
  }

  return {
    state,
    connect,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    saveProfile: (p) => put('profiles', p),
    async deleteProfile(id) {
      const mine = state.sessions.filter((s) => s.profileId === id);
      for (const s of mine) await remove('sessions', s.id);
      await remove('profiles', id);
    },
    saveSession: (s) => put('sessions', s),
    deleteSession: (id) => remove('sessions', id),
    sessionsFor(profileId) {
      return state.sessions.filter((s) => s.profileId === profileId);
    },
    getActiveProfileId() {
      try {
        return localStorage.getItem(ACTIVE_KEY);
      } catch {
        return null;
      }
    },
    setActiveProfileId(id) {
      try {
        if (id) localStorage.setItem(ACTIVE_KEY, id);
        else localStorage.removeItem(ACTIVE_KEY);
      } catch {
        // A remembered choice is a convenience only.
      }
    },
  };
}
