// Multiplayer runs on Firebase Realtime Database.
//
// Setup (once, ~2 minutes):
//   1. console.firebase.google.com -> Add project (any name, Analytics off is fine)
//   2. Build -> Realtime Database -> Create database -> start in test mode
//      (or paste the rules from the README for something less wide open)
//   3. Project settings (gear icon) -> Your apps -> Web app (</>) -> Register
//   4. Copy the config object it shows you over the placeholders below
//
// The databaseURL line is required — grab it from the Realtime Database page
// if the generated config doesn't include it.

export const firebaseConfig = {
  apiKey: 'AIzaSyC2rmYubOuCwcJTdUz02AfqDBnBMyb_m4g',
  authDomain: 'tanks-online-5e61c.firebaseapp.com',
  databaseURL: 'https://tanks-online-5e61c-default-rtdb.firebaseio.com/',
  projectId: 'tanks-online-5e61c',
  appId: '1:863277929250:web:751d9689adbbcaecb1cb7b',
};
