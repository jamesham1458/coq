// Profiles and session history.
//
// Inside the Claude viewer these live in the page's database, in the part that is
// private to each signed-in person, so they follow the person across devices. Anywhere
// else (or when signed out) they fall back to this browser's local storage.
// Only measurements are stored. Videos and still frames never leave the device.

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

export function createStore() {
  const listeners = new Set();
  const state = {
    /** 'local' until the cloud store answers, then 'cloud' when it is usable */
    mode: 'local',
    /** 'pending' | 'ready' | 'slow' | 'error' */
    cloud: 'pending',
    /** true when the last save to the device failed (storage full or blocked) */
    localBlocked: false,
    profiles: [],
    sessions: [],
  };
  const local = readLocal();
  state.profiles = local.profiles;
  state.sessions = local.sessions;
  let cloudRoot = null;

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
    const localSnapshot = { profiles: [...state.profiles], sessions: [...state.sessions] };
    let gotProfiles = false;
    let gotSessions = false;
    let migrated = false;
    const slowTimer = setTimeout(() => {
      if (!(gotProfiles && gotSessions)) {
        state.cloud = 'slow';
        emit();
      }
    }, 10000);
    const settle = async () => {
      if (!(gotProfiles && gotSessions)) return;
      clearTimeout(slowTimer);
      cloudRoot = root;
      state.mode = 'cloud';
      state.cloud = 'ready';
      // First visit with history made on this device: carry it over once.
      if (!migrated && !state.profiles.length && localSnapshot.profiles.length) {
        migrated = true;
        try {
          for (const p of localSnapshot.profiles) await root.collection('profiles').doc(p.id).set(strip(p));
          for (const s of localSnapshot.sessions) await root.collection('sessions').doc(s.id).set(strip(s));
        } catch {
          // The listeners will show whatever did get written.
        }
      }
      sortAll();
      emit();
    };
    const fail = () => {
      clearTimeout(slowTimer);
      if (state.mode !== 'cloud') {
        state.cloud = 'error';
        state.profiles = localSnapshot.profiles;
        state.sessions = localSnapshot.sessions;
        sortAll();
      }
      emit();
    };
    const docs = (snap) => snap.docs.map((d) => ({ ...clone(d.data()), id: d.id }));
    root.collection('profiles').onSnapshot((snap) => {
      if (snap.metadata.fromCache && !gotProfiles && snap.empty) return;
      state.profiles = docs(snap);
      gotProfiles = true;
      if (state.mode === 'cloud') {
        sortAll();
        emit();
      } else settle();
    }, fail);
    root.collection('sessions').onSnapshot((snap) => {
      if (snap.metadata.fromCache && !gotSessions && snap.empty) return;
      state.sessions = docs(snap);
      gotSessions = true;
      if (state.mode === 'cloud') {
        sortAll();
        emit();
      } else settle();
    }, fail);
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
      await cloudRoot.collection(kind).doc(item.id).set(strip(item));
    } else {
      persistLocal();
      if (state.localBlocked) throw new Error('This browser would not save the data.');
    }
  }

  async function remove(kind, id) {
    state[kind] = state[kind].filter((x) => x.id !== id);
    emit();
    if (state.mode === 'cloud' && cloudRoot) await cloudRoot.collection(kind).doc(id).delete();
    else persistLocal();
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
