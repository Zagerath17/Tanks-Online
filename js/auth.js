// Accounts, on Firebase Authentication plus a little bookkeeping in the
// Realtime Database.
//
// Two records back every account:
//   /usernames/{lowercased}  -> { uid, email }   claims the name, and lets
//                                                 people sign in by username
//   /users/{uid}             -> { username, email, loadout }
//
// The username record is what makes a name exclusive: it is written with a
// rule that forbids overwriting one that already exists, so the first account
// to take a name keeps it.
import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, deleteUser,
  onAuthStateChanged, reauthenticateWithCredential, EmailAuthProvider,
  fetchSignInMethodsForEmail,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getDatabase, ref, get, set, remove, update,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

let app = null;
let auth = null;
let db = null;
let profile = null; // { uid, username, email }
const listeners = [];

export function authConfigured() {
  return !!(
    firebaseConfig &&
    firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes('PASTE') &&
    firebaseConfig.databaseURL && !String(firebaseConfig.databaseURL).includes('PASTE')
  );
}

function ensure() {
  if (!app) {
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getDatabase(app);
  }
  return { auth, db };
}

export function currentProfile() {
  return profile;
}

export function onProfileChange(fn) {
  listeners.push(fn);
  fn(profile);
}

function emit() {
  for (const fn of listeners) fn(profile);
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;

export function validateUsername(name) {
  if (!USERNAME_RE.test(name || '')) {
    return 'username must be 3-16 letters, numbers or underscores';
  }
  return null;
}

export function validatePassword(pw) {
  if (!pw || pw.length < 8) return 'password must be at least 8 characters';
  return null;
}

export function validateEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) return 'enter a valid email address';
  return null;
}

// Friendlier text than Firebase's raw codes
function readable(err) {
  const code = (err && err.code) || '';
  if (code.includes('email-already-in-use')) return 'that email already has an account';
  if (code.includes('invalid-email')) return 'that email address is not valid';
  if (code.includes('weak-password')) return 'that password is too weak';
  if (code.includes('wrong-password') || code.includes('invalid-credential')) {
    return 'wrong username or password';
  }
  if (code.includes('user-not-found')) return 'wrong username or password';
  if (code.includes('too-many-requests')) return 'too many attempts — wait a minute and retry';
  if (code.includes('network')) return 'network problem — check your connection';
  if (code.includes('requires-recent-login')) return 'please sign in again before doing that';
  if (code.includes('permission-denied')) return 'that username is already taken';
  return (err && err.message) ? String(err.message).replace(/^Firebase:\s*/, '') : 'something went wrong';
}

async function usernameRecord(name) {
  const { db: d } = ensure();
  const snap = await get(ref(d, `usernames/${name.toLowerCase()}`));
  return snap.exists() ? snap.val() : null;
}

export async function usernameAvailable(name) {
  return !(await usernameRecord(name));
}

// ---------------------------------------------------------------------------
// Sign up. The account is created, the name is claimed, and a verification
// email goes out — but signing in is refused until that email is confirmed.
// ---------------------------------------------------------------------------
export async function signUp({ email, username, password }) {
  const { auth: a, db: d } = ensure();
  const bad = validateEmail(email) || validateUsername(username) || validatePassword(password);
  if (bad) throw new Error(bad);

  if (!(await usernameAvailable(username))) throw new Error('that username is already taken');

  const methods = await fetchSignInMethodsForEmail(a, email).catch(() => []);
  if (methods && methods.length) throw new Error('that email already has an account');

  let cred;
  try {
    cred = await createUserWithEmailAndPassword(a, email, password);
  } catch (e) {
    throw new Error(readable(e));
  }

  try {
    // claim the name; the database rules reject this if someone beat us to it
    await set(ref(d, `usernames/${username.toLowerCase()}`), {
      uid: cred.user.uid,
      email,
    });
    await set(ref(d, `users/${cred.user.uid}`), {
      username,
      email,
      created: Date.now(),
    });
  } catch (e) {
    // couldn't hold the name — roll the half-made account back
    try { await deleteUser(cred.user); } catch { /* nothing to undo */ }
    throw new Error('that username is already taken');
  }

  // Do NOT swallow this: if the mail fails to go out, the player needs to be
  // told, not left waiting for a message that was never sent.
  let sent = true;
  let sendError = '';
  try {
    await sendEmailVerification(cred.user);
  } catch (e) {
    sent = false;
    sendError = readable(e);
  }
  await signOut(a);
  return { email, sent, sendError };
}

// Sign in just far enough to send the link again, then sign back out.
export async function resendVerification({ username, password }) {
  const { auth: a } = ensure();
  const rec = await usernameRecord(username);
  if (!rec || !rec.email) throw new Error('wrong username or password');
  let cred;
  try {
    cred = await signInWithEmailAndPassword(a, rec.email, password);
  } catch (e) {
    throw new Error(readable(e));
  }
  if (cred.user.emailVerified) {
    await signOut(a);
    throw new Error('that email is already verified — just log in');
  }
  try {
    await sendEmailVerification(cred.user);
  } catch (e) {
    await signOut(a);
    throw new Error(readable(e));
  }
  await signOut(a);
  return rec.email;
}

// ---------------------------------------------------------------------------
// Sign in by username: look the name up, then use the email behind it.
// ---------------------------------------------------------------------------
export async function signIn({ username, password }) {
  const { auth: a } = ensure();
  const rec = await usernameRecord(username);
  if (!rec || !rec.email) throw new Error('wrong username or password');

  let cred;
  try {
    cred = await signInWithEmailAndPassword(a, rec.email, password);
  } catch (e) {
    throw new Error(readable(e));
  }

  if (!cred.user.emailVerified) {
    let resent = true;
    try {
      await sendEmailVerification(cred.user);
    } catch {
      resent = false;
    }
    await signOut(a);
    throw new Error(resent
      ? 'verify your email first — link sent again, check your spam folder'
      : 'verify your email first (could not resend the link just now)');
  }

  profile = { uid: cred.user.uid, username: rec.username || username, email: rec.email };
  emit();
  return profile;
}

export async function resetPassword(usernameOrEmail) {
  const { auth: a } = ensure();
  let email = usernameOrEmail;
  if (!String(email).includes('@')) {
    const rec = await usernameRecord(usernameOrEmail);
    if (!rec || !rec.email) throw new Error('no account with that username');
    email = rec.email;
  }
  try {
    await sendPasswordResetEmail(a, email);
  } catch (e) {
    throw new Error(readable(e));
  }
  return email;
}

export async function logOut() {
  const { auth: a } = ensure();
  await signOut(a).catch(() => {});
  profile = null;
  emit();
}

// ---------------------------------------------------------------------------
// Delete the account outright: the profile, the username claim, and the
// login itself. Firebase insists on a recent sign-in, so we reauthenticate.
// ---------------------------------------------------------------------------
export async function deleteAccount(password) {
  const { auth: a, db: d } = ensure();
  const user = a.currentUser;
  if (!user || !profile) throw new Error('not signed in');

  try {
    const cred = EmailAuthProvider.credential(profile.email, password);
    await reauthenticateWithCredential(user, cred);
  } catch (e) {
    throw new Error(readable(e));
  }

  const name = profile.username.toLowerCase();
  await remove(ref(d, `users/${user.uid}`)).catch(() => {});
  await remove(ref(d, `usernames/${name}`)).catch(() => {});
  try {
    await deleteUser(user);
  } catch (e) {
    throw new Error(readable(e));
  }
  profile = null;
  emit();
}

// ---------------------------------------------------------------------------
// Loadouts follow the account
// ---------------------------------------------------------------------------
export async function loadCloudLoadout() {
  if (!profile) return null;
  const { db: d } = ensure();
  const snap = await get(ref(d, `users/${profile.uid}/loadout`)).catch(() => null);
  return snap && snap.exists() ? snap.val() : null;
}

export function saveCloudLoadout(loadout) {
  if (!profile) return;
  const { db: d } = ensure();
  update(ref(d, `users/${profile.uid}`), { loadout }).catch(() => {});
}

// Keep the local view in step if Firebase signs someone out on its own
export function watchAuth() {
  const { auth: a } = ensure();
  onAuthStateChanged(a, (user) => {
    if (!user && profile) {
      profile = null;
      emit();
    }
  });
}
