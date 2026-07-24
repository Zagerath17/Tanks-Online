// Menu screens + lobby UI. Pure DOM; all game/network logic stays in main.js.
export function createMenu(handlers) {
  const el = (id) => document.getElementById(id);
  const menu = el('menu');
  const screenIds = ['scr-auth', 'scr-login', 'scr-signup', 'scr-main', 'scr-play', 'scr-custom', 'scr-join', 'scr-lobby'];

  function show(id) {
    for (const s of screenIds) el(s).classList.toggle('hidden', s !== id);
    menu.classList.remove('hidden');
    document.body.classList.remove('ingame');
  }

  function hideAll() {
    menu.classList.add('hidden');
    document.body.classList.add('ingame');
  }

  function err(id, msg) {
    el(id).textContent = msg || '';
  }

  // --- accounts ---
  const accountBtn = el('account-name');
  const accountMenu = el('account-menu');

  el('btn-goto-login').addEventListener('click', () => {
    err('login-err', '');
    show('scr-login');
    el('login-user').focus();
  });
  el('btn-goto-signup').addEventListener('click', () => {
    err('signup-err', '');
    show('scr-signup');
    el('signup-email').focus();
  });
  el('btn-guest').addEventListener('click', () => handlers.onGuest());
  el('back-login').addEventListener('click', () => show('scr-auth'));
  el('back-signup').addEventListener('click', () => show('scr-auth'));

  el('btn-login').addEventListener('click', () => handlers.onLogin({
    username: el('login-user').value.trim(),
    password: el('login-pass').value,
  }));
  el('login-pass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el('btn-login').click();
  });
  el('btn-forgot').addEventListener('click', () => handlers.onForgot(el('login-user').value.trim()));
  el('btn-resend').addEventListener('click', () => handlers.onResend({
    username: el('login-user').value.trim(),
    password: el('login-pass').value,
  }));

  el('btn-signup').addEventListener('click', () => handlers.onSignUp({
    email: el('signup-email').value.trim(),
    username: el('signup-user').value.trim(),
    password: el('signup-pass').value,
  }));
  el('signup-pass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el('btn-signup').click();
  });

  accountBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    accountMenu.classList.toggle('hidden');
  });
  document.addEventListener('mousedown', (e) => {
    if (!accountMenu.contains(e.target) && e.target !== accountBtn) {
      accountMenu.classList.add('hidden');
    }
  });
  el('btn-logout').addEventListener('click', () => {
    accountMenu.classList.add('hidden');
    handlers.onLogout();
  });
  el('btn-delete').addEventListener('click', () => {
    accountMenu.classList.add('hidden');
    handlers.onDeleteAccount();
  });

  function setAccount(name) {
    accountBtn.textContent = name || 'guest';
    accountMenu.classList.add('hidden');
    el('btn-logout').textContent = name ? 'Log out' : 'Sign in';
    el('btn-delete').style.display = name ? '' : 'none';
  }

  // --- main ---
  el('btn-play').addEventListener('click', () => show('scr-play'));
  el('btn-custom').addEventListener('click', () => {
    err('custom-err', handlers.customNotice ? handlers.customNotice() : '');
    show('scr-custom');
  });
  el('btn-settings').addEventListener('click', () => {}); // ignored for now
  el('btn-editor').addEventListener('click', () => handlers.onEditor());
  el('btn-garage').addEventListener('click', () => handlers.onGarage());

  // --- play (placeholders — modes do nothing yet) ---
  for (const id of ['btn-tdm', 'btn-ffa', 'btn-ctf']) {
    el(id).addEventListener('click', () => {});
  }
  el('back-play').addEventListener('click', () => show('scr-main'));

  // --- custom ---
  el('btn-create').addEventListener('click', () => handlers.onCreate());
  el('btn-join').addEventListener('click', () => {
    err('join-err', '');
    el('code-input').value = '';
    show('scr-join');
    el('code-input').focus();
  });
  el('back-custom').addEventListener('click', () => show('scr-main'));

  // --- join ---
  function submitJoin() {
    const code = el('code-input').value.trim();
    if (!/^\d{4}$/.test(code)) {
      err('join-err', 'enter the 4-digit code');
      return;
    }
    handlers.onJoin(code);
  }
  el('btn-join-go').addEventListener('click', submitJoin);
  el('code-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitJoin();
  });
  el('code-input').addEventListener('input', () => {
    el('code-input').value = el('code-input').value.replace(/\D/g, '').slice(0, 4);
  });
  el('back-join').addEventListener('click', () => show('scr-custom'));

  // --- lobby ---
  el('btn-start').addEventListener('click', () => handlers.onStart());
  el('btn-leave').addEventListener('click', () => handlers.onLeave());

  function setLobby({ code, players, hostId, myId, isHost }) {
    el('lobby-code').textContent = code;
    const ids = Object.keys(players || {}).sort(
      (a, b) => ((players[a] && players[a].joined) || 0) - ((players[b] && players[b].joined) || 0)
    );
    el('lobby-players').innerHTML = ids
      .map((id, i) => {
        const tags = [];
        const t = players[id] && players[id].team;
        tags.push(t ? 'gold' : 'blue');
        if (id === hostId) tags.push('host');
        if (id === myId) tags.push('you');
        return `<div class="lp">tank ${String(i + 1).padStart(2, '0')}${
          tags.length ? ` <span>&middot; ${tags.join(' &middot; ')}</span>` : ''
        }</div>`;
      })
      .join('');
    el('lobby-count').textContent = `${ids.length} / 12`;
    el('btn-start').style.display = isHost ? '' : 'none';
    el('lobby-hint').textContent = isHost
      ? 'you are the host \u2014 start when ready'
      : 'waiting for the host to start';
  }

  return { show, hideAll, err, setLobby, setAccount };
}
