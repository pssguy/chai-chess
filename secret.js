'use strict';
/* Secret Queen: two players, one screen. No queens at the start; each player secretly picks
   one pawn to be their queen. It moves as a pawn until its owner moves it like a queen, which
   reveals it. A hidden queen can capture a king that was left open to it, which wins. */
const SQ = (() => {
  const START = 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1';
  const F = 'abcdefgh';
  const S = { c: null, phase: 'idle', hidden: { w: null, b: null }, state: { w: 'hidden', b: 'hidden' }, peek: false, pick: null, log: [], last: [], pending: null, flipped: false };
  const name = s => s === 'w' ? 'White' : 'Black';
  const other = s => s === 'w' ? 'b' : 'w';

  function queenTargets(from, color) {
    const bd = S.c.board(), out = [], x0 = F.indexOf(from[0]), y0 = +from[1];
    [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dx, dy]) => {
      let x = x0 + dx, y = y0 + dy;
      while (x >= 0 && x < 8 && y >= 1 && y <= 8) {
        const p = bd[8 - y][x], sq = F[x] + y;
        if (p) { if (p.color !== color) out.push(sq); break; }
        out.push(sq); x += dx; y += dy;
      }
    });
    return out;
  }
  function toFen(board, turn, castling, full) {
    const rows = board.map(r => { let s = '', n = 0; r.forEach(p => { if (!p) n++; else { if (n) { s += n; n = 0; } s += p.color === 'w' ? p.type.toUpperCase() : p.type; } }); return s + (n || ''); });
    return `${rows.join('/')} ${turn} ${castling || '-'} - 0 ${full}`;
  }
  // result of moving the hidden queen like a queen: {ok, fen, kingCapture, captured}
  function revealMove(from, to) {
    const mover = S.c.turn(), bd = S.c.board(), f = S.c.fen().split(' ');
    const [fx, fy] = [F.indexOf(from[0]), +from[1]], [tx, ty] = [F.indexOf(to[0]), +to[1]];
    const target = bd[8 - ty][tx];
    if (target && target.type === 'k') return { ok: true, kingCapture: true };
    bd[8 - fy][fx] = null; bd[8 - ty][tx] = { type: 'q', color: mover };
    let castling = f[2]; const strip = { a1: 'Q', h1: 'K', a8: 'q', h8: 'k' };
    if (strip[to]) castling = castling.replace(strip[to], ''); if (castling === '') castling = '-';
    const full = +f[5] + (mover === 'b' ? 1 : 0);
    const test = new Chess(); if (!test.load(toFen(bd, mover, castling, f[5]))) return { ok: false };
    if (test.in_check()) return { ok: false, reason: 'check' };
    return { ok: true, fen: toFen(bd, other(mover), castling, full), captured: target };
  }
  function secretMovesExist(side) {                 // can `side`'s hidden queen make any legal queen move?
    const h = S.hidden[side]; if (!h || S.state[side] !== 'hidden') return false;
    return queenTargets(h, side).some(t => revealMove(h, t).ok);
  }

  /* ---------- rendering ---------- */
  const CROWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18l-1.5-9-4.5 4-3-7-3 7-4.5-4z" fill="#E0A845" stroke="#6b4a0e" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  function decorate(sq, d) {
    const show = (S.phase === 'pick' && S.pick === sq) || (S.phase === 'play' && S.peek && S.hidden[S.c.turn()] === sq && S.state[S.c.turn()] === 'hidden');
    if (show) { const c = el('span', 'sq-crown'); c.innerHTML = CROWN; d.appendChild(c); d.classList.add('sq-secret'); }
  }
  function render() {
    const c = S.c, playing = S.phase === 'play';
    S.board.flipped = S.flipped;
    S.board.set(c.fen(), S.last, playing && !S.pending);
    const bar = (id, side) => {
      const n = $(id); n.innerHTML = ''; const d = el('div', 'pname'); d.appendChild(el('span', '', name(side)));
      const st = S.state[side]; d.appendChild(el('small', '', st === 'hidden' ? 'queen: secret' : st === 'revealed' ? 'queen: revealed' : 'queen: captured'));
      n.appendChild(d); if (playing && c.turn() === side) n.appendChild(el('span', 'turnpill', 'to move'));
    };
    bar(S.flipped ? 'sBot' : 'sTop', 'b'); bar(S.flipped ? 'sTop' : 'sBot', 'w');
    const M = $('sMoves'); M.innerHTML = '';
    for (let i = 0; i < S.log.length; i += 2) { M.appendChild(el('span', 'n', (i / 2 + 1) + '.')); M.appendChild(el('span', '', S.log[i])); M.appendChild(el('span', '', S.log[i + 1] || '')); }
    M.scrollTop = M.scrollHeight;
    $('sPeek').disabled = !playing || S.state[c.turn()] !== 'hidden';
    $('sConfirmBar').hidden = !S.pending;
  }
  function say(t, cls = '') { const f = $('sStatus'); f.textContent = t; f.className = 'feedback ' + cls; }
  function cover(show, title, sub, btn, fn) {
    const cv = $('sCover'); cv.hidden = !show; if (!show) return;
    $('sCoverTitle').textContent = title; $('sCoverSub').textContent = sub; $('sCoverBtn').textContent = btn; $('sCoverBtn').onclick = fn;
  }

  /* ---------- flow ---------- */
  function newGame() {
    S.c = new Chess(START); S.hidden = { w: null, b: null }; S.state = { w: 'hidden', b: 'hidden' }; S.log = []; S.last = []; S.pending = null; S.peek = false;
    S.phase = 'cover';
    cover(true, 'White picks first', 'Black, please look away while White chooses a secret pawn.', "I'm White, show me", () => startPick('w'));
    say('Setting up. Each player secretly chooses one pawn to be their queen.'); render();
  }
  function startPick(side) {
    cover(false); S.phase = 'pick'; S.picking = side; S.pick = null;
    $('sPickBar').hidden = false; $('sPickConfirm').disabled = true;
    say(`${name(side)}: tap one of your pawns to make it your Secret Queen, then press Confirm.`); render();
  }
  function pickClick(sq) {
    if (S.phase !== 'pick') return;
    const p = S.c.get(sq); if (!p || p.type !== 'p' || p.color !== S.picking) { say(`${name(S.picking)}: tap one of your own pawns.`); return; }
    S.pick = sq; $('sPickConfirm').disabled = false; say(`${name(S.picking)}: the pawn on ${sq} will be your queen. Press Confirm, or tap another pawn.`); render();
  }
  function confirmPick() {
    if (!S.pick) return; S.hidden[S.picking] = S.pick; S.pick = null; $('sPickBar').hidden = true;
    if (S.picking === 'w') { S.phase = 'cover'; render(); cover(true, 'Pass to Black', 'White, look away now. Black chooses next.', "I'm Black, show me", () => startPick('b')); }
    else { S.phase = 'cover'; render(); cover(true, 'Ready to play', 'Both secret queens are chosen. White moves first. Hold "Peek" on your turn if you forget which pawn is yours (make sure the other player looks away).', 'Start the game', () => { cover(false); S.phase = 'play'; say("White to move."); render(); }); }
  }
  function afterMove(text, captureNote) {
    S.log.push(text);
    const c = S.c, side = c.turn();
    const any = c.moves().length > 0 || secretMovesExist(side);
    if (!any) { S.phase = 'over'; if (c.in_check()) say(`Checkmate! ${name(other(side))} wins.`, 'ok'); else say('Stalemate. The game is drawn.', 'meh'); render(); return; }
    if (c.insufficient_material() && S.state.w !== 'hidden' && S.state.b !== 'hidden') { S.phase = 'over'; say('Draw: not enough pieces left to checkmate.', 'meh'); render(); return; }
    say((captureNote ? captureNote + ' ' : '') + `${name(side)} to move.` + (c.in_check() ? ' Check!' : ''), captureNote ? 'ok' : '');
    render();
  }
  function customMove(from, to, promo) {
    if (S.phase !== 'play' || S.pending) return;
    const c = S.c, mover = c.turn(), opp = other(mover);
    const isSecret = S.hidden[mover] === from && S.state[mover] === 'hidden';
    const legal = c.moves({ square: from, verbose: true }).find(m => m.to === to);
    if (legal) {
      let capturedSq = legal.flags.includes('e') ? to[0] + from[1] : (legal.captured ? to : null);
      const promoteSecret = isSecret && legal.flags.includes('p');
      const m = c.move({ from, to, promotion: promoteSecret ? 'q' : promo });
      S.last = [from, to];
      let note = '';
      if (capturedSq && S.hidden[opp] === capturedSq && S.state[opp] === 'hidden') { S.state[opp] = 'captured'; S.hidden[opp] = null; note = `That pawn was ${name(opp)}'s Secret Queen!`; }
      if (isSecret) { if (promoteSecret) { S.state[mover] = 'revealed'; note = (note ? note + ' ' : '') + `${name(mover)}'s Secret Queen reached the end.`; } else S.hidden[mover] = to; }
      return afterMove(m.san, note);
    }
    if (isSecret && queenTargets(from, mover).includes(to)) {
      const r = revealMove(from, to);
      if (!r.ok) { say(r.reason === 'check' ? 'That queen move would leave your king in check.' : "That move isn't allowed.", 'no'); render(); return; }
      S.pending = { from, to, r }; say(`Reveal your Secret Queen and move ${from} to ${to}?`); render(); return;
    }
    say('That move is not allowed.', 'no'); render();
  }
  function confirmReveal(yes) {
    const P = S.pending; S.pending = null; if (!P) return;
    if (!yes) { say(`${name(S.c.turn())} to move.`); render(); return; }
    const mover = S.c.turn(), opp = other(mover), { from, to, r } = P;
    if (r.kingCapture) {
      S.last = [from, to]; const bd = S.c.board(); bd[8 - +from[1]][F.indexOf(from[0])] = null; bd[8 - +to[1]][F.indexOf(to[0])] = { type: 'q', color: mover };
      S.c.load(toFen(bd, opp, '-', 1)); S.state[mover] = 'revealed'; S.log.push(`Q${from}x${to} (king!)`); S.phase = 'over';
      say(`The Secret Queen was on ${from} all along. She captures the king: ${name(mover)} wins!`, 'ok'); render(); if (window.chaiPiano) ['C4', 'E4', 'G4', 'C5'].forEach((n, i) => window.chaiPiano(n, .4, .12 * i)); return;
    }
    S.c.load(r.fen); S.last = [from, to]; S.state[mover] = 'revealed'; S.hidden[mover] = to;
    let note = `${name(mover)} reveals the Secret Queen!`;
    if (r.captured && S.hidden[opp] === to && S.state[opp] === 'hidden') { S.state[opp] = 'captured'; S.hidden[opp] = null; note += ` And that pawn was ${name(opp)}'s Secret Queen!`; }
    afterMove(`Q${from}${r.captured ? 'x' : '-'}${to}`, note);
  }

  function init() {
    S.board = new Board($('sBoard'), { side: () => S.c ? S.c.turn() : 'w', decorate, customMove,
      targets: from => { const t = {}; S.c.moves({ square: from, verbose: true }).forEach(m => t[m.to] = true); const me = S.c.turn(); if (S.hidden[me] === from && S.state[me] === 'hidden') queenTargets(from, me).forEach(q => t[q] = true); return t; },
      dotTargets: from => { const t = {}; S.c.moves({ square: from, verbose: true }).forEach(m => t[m.to] = true); const me = S.c.turn(); if (S.peek && S.hidden[me] === from && S.state[me] === 'hidden') queenTargets(from, me).forEach(q => t[q] = true); return t; } });
    $('sBoard').addEventListener('click', e => { if (S.phase !== 'pick') return; const s = e.target.closest('.sq'); if (s) pickClick(s.dataset.sq); });
    $('sPickConfirm').onclick = confirmPick;
    $('sNew').onclick = newGame;
    $('sFlip').onclick = () => { S.flipped = !S.flipped; render(); };
    $('sYes').onclick = () => confirmReveal(true); $('sNo').onclick = () => confirmReveal(false);
    const pk = $('sPeek'), on = e => { if (pk.disabled) return; e.preventDefault(); S.peek = true; render(); }, off = () => { if (S.peek) { S.peek = false; render(); } };
    pk.addEventListener('pointerdown', on); ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(ev => pk.addEventListener(ev, off));
    pk.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) on(e); }); pk.addEventListener('keyup', off);
  }
  return { init, enter() { if (!S.c) newGame(); else render(); } };
})();
SQ.init();
