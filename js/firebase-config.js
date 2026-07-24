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
  apiKey: 'AIzaSyDw9OFW-70DpQgxusbkmMgl8JLI2FwiNkE',
  authDomain: 'tanks-online-11fcf.firebaseapp.com',
  databaseURL: 'https://tanks-online-11fcf-default-rtdb.firebaseio.com/',
  projectId: 'tanks-online-11fcf',
  appId: '1:537032183866:web:0328776208974c675b2503',
};
