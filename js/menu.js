// Menu screens + lobby UI. Pure DOM; all game/network logic stays in main.js.
export function createMenu(handlers) {
  const el = (id) => document.getElementById(id);
  const menu = el('menu');
  const screenIds = ['scr-main', 'scr-play', 'scr-custom', 'scr-join', 'scr-lobby'];

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

  // --- main ---
  el('btn-play').addEventListener('click', () => show('scr-play'));
  el('btn-custom').addEventListener('click', () => {
    err('custom-err', handlers.customNotice ? handlers.customNotice() : '');
    show('scr-custom');
  });
  el('btn-settings').addEventListener('click', () => {}); // ignored for now
  el('btn-editor').addEventListener('click', () => handlers.onEditor());

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

  return { show, hideAll, err, setLobby };
}
