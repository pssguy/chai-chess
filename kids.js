'use strict';
/* Kids' Corner: "Meet the pieces" lessons (collect the stars in as few moves as you can)
   and Pawn Race against a friendly computer. Progress is kept in this browser only. */
const KIDS = (() => {
  const F = 'abcdefgh';
  const sqXY = s => [F.indexOf(s[0]), +s[1] - 1];
  const xySq = (x, y) => F[x] + (y + 1);
  const on = (x, y) => x >= 0 && x < 8 && y >= 0 && y < 8;
  const store = { get() { try { return JSON.parse(localStorage.getItem('chai-kids') || '{}'); } catch (e) { return {}; } }, set(v) { try { localStorage.setItem('chai-kids', JSON.stringify(v)); } catch (e) { } } };
  let progress = store.get();
  let sound = progress._sound !== false;
  const play = (note, vel = .5, when = 0) => { if (sound && window.chaiPiano) window.chaiPiano(note, vel, when); };
  const uhoh = () => { play('E4', .35); play('C4', .35, .18); };            // a gentle two-note 'uh-oh'

  /* ---------- the pieces ---------- */
  const PIECE = {
    P: { name: 'Pawn', worth: '1 point', note: 'E5', text: ['Pawns march forward, one square at a time.', 'On its very first move a pawn may jump two squares.'],
      levelText: [
        ['Pawns march forward, one square at a time. They never go backwards.', 'On its very first move a pawn may jump two squares instead of one.'],
        ['Pawns capture differently from how they move: one square diagonally forward.', 'A pawn can’t move forward into another piece. Capture the black pawns to reach their stars!'],
        ['If a pawn reaches the far side of the board, it becomes a queen!', 'Capture the black pawn, then march all the way to the end.']] },
    N: { name: 'Knight', worth: '3 points', note: 'C5', text: ['The knight moves in an L shape: two squares one way, then one square to the side.', 'It is the only piece that can jump over other pieces.', 'Tip: a knight always lands on a different colour from where it started.'] },
    B: { name: 'Bishop', worth: '3 points', note: 'C5', text: ['The bishop slides diagonally, as far as it likes.', 'A bishop stays on the same colour for the whole game. This one lives on the light squares or the dark squares, never both.'] },
    R: { name: 'Rook', worth: '5 points', note: 'G4', text: ['The rook slides in straight lines: up, down, left or right, as far as it likes.', 'Rooks are strongest on open lines with nothing in the way.'] },
    Q: { name: 'Queen', worth: '9 points', note: 'C4', text: ['The queen is the most powerful piece.', 'She moves like a rook and a bishop together: straight or diagonal, as far as she likes.'] },
    K: { name: 'King', worth: 'Priceless', note: 'C3', text: ['The king moves one square in any direction.', 'He is the most important piece: if your king is trapped (checkmate), you lose the game. So keep him safe!'] },
  };
  // hand-made levels; the best possible number of moves is worked out automatically
  const LEVELS = {
    P: [{ at: 'e2', stars: ['e4', 'e6'] }, { at: 'c2', stars: ['d3', 'e4', 'e6'], foes: ['d3', 'e4'] }, { at: 'b2', stars: ['c3', 'c8'], foes: ['c3'], promote: true }],
    N: [{ at: 'b1', stars: ['c3', 'd5'] }, { at: 'g1', stars: ['f3', 'e5', 'g6'] }, { at: 'd4', stars: ['b5', 'c7', 'e8', 'f6'] }],
    B: [{ at: 'c1', stars: ['f4', 'h6'] }, { at: 'f1', stars: ['b5', 'e8', 'h5'] }, { at: 'c1', stars: ['a3', 'e7', 'h2', 'f8'] }],
    R: [{ at: 'a1', stars: ['a5', 'e5'] }, { at: 'd4', stars: ['d8', 'h8', 'h1'] }, { at: 'a1', stars: ['c3', 'f3', 'f7', 'b7'] }],
    Q: [{ at: 'd1', stars: ['d6', 'h2'] }, { at: 'a1', stars: ['a8', 'h8', 'h1', 'e4'] }, { at: 'c3', stars: ['c7', 'g7', 'g3', 'e1'] }],
    K: [{ at: 'e1', stars: ['e3'] }, { at: 'd4', stars: ['c5', 'd6', 'e5'] }, { at: 'a1', stars: ['c3', 'e5', 'g7'] }],
  };
  const ORDER = ['P', 'N', 'B', 'R', 'Q', 'K'];

  function moves(type, sq, foes) {           // squares a lone white piece can reach
    const [x, y] = sqXY(sq), out = [];
    const slide = dirs => dirs.forEach(([dx, dy]) => { let i = x + dx, j = y + dy; while (on(i, j)) { out.push(xySq(i, j)); if (foes.has(xySq(i, j))) break; i += dx; j += dy; } });
    const R = [[1, 0], [-1, 0], [0, 1], [0, -1]], B = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    if (type === 'R') slide(R); else if (type === 'B') slide(B); else if (type === 'Q') slide([...R, ...B]);
    else if (type === 'N') [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]].forEach(([dx, dy]) => on(x + dx, y + dy) && out.push(xySq(x + dx, y + dy)));
    else if (type === 'K') [...R, ...B].forEach(([dx, dy]) => on(x + dx, y + dy) && out.push(xySq(x + dx, y + dy)));
    else if (type === 'P') {
      if (on(x, y + 1) && !foes.has(xySq(x, y + 1))) { out.push(xySq(x, y + 1)); if (y === 1 && !foes.has(xySq(x, y + 2))) out.push(xySq(x, y + 2)); }
      [[-1, 1], [1, 1]].forEach(([dx, dy]) => on(x + dx, y + dy) && foes.has(xySq(x + dx, y + dy)) && out.push(xySq(x + dx, y + dy)));
    }
    return out;
  }
  function best(type, lv) {                    // fewest moves to collect every star (breadth-first search)
    const stars = lv.stars, full = (1 << stars.length) - 1, seen = new Set();
    let frontier = [[lv.at, 0, new Set(lv.foes || [])]], d = 0;
    while (frontier.length && d < 40) {
      const next = [];
      for (const [sq, mask, foes] of frontier) {
        if (mask === full) return d;
        for (const t of moves(type, sq, foes)) {
          const i = stars.indexOf(t), m = i >= 0 ? mask | (1 << i) : mask;
          const f2 = new Set(foes); f2.delete(t);
          const key = t + '|' + m + '|' + [...f2].sort().join();
          if (!seen.has(key)) { seen.add(key); next.push([t, m, f2]); }
        }
      }
      frontier = next; d++;
    }
    return 99;
  }

  /* ---------- board ---------- */
  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17.2 6.1 20.4l1.3-6.5L2.5 9.4l6.6-.8z" fill="#F2B632" stroke="#9A6A12" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  function drawBoard(node, st) {
    node.innerHTML = '';
    for (let r = 7; r >= 0; r--) for (let f = 0; f < 8; f++) {
      const sq = xySq(f, r), d = el('div', 'ksq ' + ((f + r) % 2 ? 'l' : 'd')); d.dataset.sq = sq;
      if (st.last && st.last.includes(sq)) d.classList.add('last');
      if (st.stars && st.stars.has(sq)) { const s = el('span', 'kstar'); s.innerHTML = STAR; d.appendChild(s); }
      const p = st.pieces[sq]; if (p) { const i = el('img', 'kpiece' + (st.sel === sq ? ' sel' : '')); i.src = PIECES[p]; i.alt = p; d.appendChild(i); }
      if (st.dots && st.dots.has(sq)) d.appendChild(el('span', 'kdot' + (p || (st.stars && st.stars.has(sq)) ? ' cap' : '')));
      if (f === 0) d.appendChild(el('span', 'kco r', r + 1)); if (r === 0) d.appendChild(el('span', 'kco f', F[f]));
      node.appendChild(d);
    }
  }

  /* ---------- lessons ---------- */
  const L = { type: 'P', lv: 0 };
  function score(type, i) { return ((progress[type] || [])[i]) || 0; }
  function totals() { let got = 0; ORDER.forEach(t => [0, 1, 2].forEach(i => got += score(t, i))); got += progress.raceWins ? 3 : 0; return got; }
  const MAX = ORDER.length * 9 + 3;

  function buildPicker() {
    const P = $('kPick'); P.innerHTML = '';
    ORDER.forEach(t => {
      const b = el('button', 'kcard' + (L.mode === 'lesson' && L.type === t ? ' on' : '')); b.type = 'button';
      const i = el('img'); i.src = PIECES[t]; i.alt = ''; b.appendChild(i);
      const tx = el('span', 'ktxt'); tx.appendChild(el('b', '', PIECE[t].name)); const got = [0, 1, 2].reduce((a, k) => a + score(t, k), 0);
      tx.appendChild(el('small', '', got + ' / 9 stars' + (got === 9 ? ' · mastered' : ''))); b.appendChild(tx);
      b.onclick = () => { openLesson(t, firstUnfinished(t)); play(PIECE[t].note, .5); }; P.appendChild(b);
    });
    const b = el('button', 'kcard race' + (L.mode === 'race' ? ' on' : '')); b.type = 'button';
    const i = el('img'); i.src = PIECES.P; i.alt = ''; b.appendChild(i);
    const tx = el('span', 'ktxt'); tx.appendChild(el('b', '', 'Pawn Race')); tx.appendChild(el('small', '', progress.raceWins ? 'Won ' + progress.raceWins + '×' : 'A game against the computer')); b.appendChild(tx);
    b.onclick = () => openRace(); P.appendChild(b);
    $('kTotal').textContent = totals() + ' / ' + MAX;
  }
  const firstUnfinished = t => { const i = [0, 1, 2].findIndex(k => score(t, k) < 3); return i < 0 ? 0 : i; };

  function openLesson(type, lv) {
    Object.assign(L, { mode: 'lesson', type, lv }); const P = PIECE[type], level = LEVELS[type][lv];
    $('kLesson').hidden = false; $('kRace').hidden = true;
    $('kTitle').textContent = 'The ' + P.name; $('kWorth').textContent = 'Worth: ' + P.worth;
    const T = $('kText'); T.innerHTML = ''; (P.levelText ? P.levelText[lv] : P.text).forEach(t => T.appendChild(el('p', '', t)));
    const LB = $('kLevels'); LB.innerHTML = '';
    [0, 1, 2].forEach(i => { const b = el('button', 'klv' + (i === lv ? ' on' : '')); b.type = 'button'; b.textContent = 'Level ' + (i + 1) + ' ' + '★'.repeat(score(type, i)) + '☆'.repeat(3 - score(type, i)); b.onclick = () => openLesson(type, i); LB.appendChild(b); });
    L.best = best(type, level); L.at = level.at; L.stars = new Set(level.stars); L.foes = new Set(level.foes || []); L.count = 0; L.done = false; L.last = null; L.piece = type;
    $('kNext').hidden = true; $('kRetry').hidden = false; $('kMsg').textContent = 'Tap a green dot to move there.'; $('kMsg').className = 'kmsg hint';
    $('kGoal').textContent = `Collect all ${level.stars.length} stars. The best anyone can do is ${L.best} move${L.best === 1 ? '' : 's'}.` + (level.promote ? ' Reach the far side to become a queen!' : '');
    buildPicker(); renderLesson();
  }
  function renderLesson(msg) {
    const pieces = {}; pieces[L.at] = L.piece; L.foes.forEach(s => pieces[s] = 'p');
    const dots = L.done ? new Set() : new Set(moves(L.piece === 'Q' && L.promoted ? 'Q' : L.piece, L.at, L.foes));
    drawBoard($('kBoard'), { pieces, stars: L.stars, dots, sel: L.done ? null : L.at, last: L.last });
    $('kCount').textContent = `Moves: ${L.count} · Stars left: ${L.stars.size}`;
    if (msg !== undefined) { $('kMsg').textContent = msg; }
  }
  function lessonClick(sq) {
    if (L.done || L.mode !== 'lesson') return;
    const legal = moves(L.piece, L.at, L.foes); if (!legal.includes(sq)) { if (sq !== L.at) { $('kMsg').textContent = `Uh-oh! The ${PIECE[L.piece].name.toLowerCase()} can't go there. Tap one of the green dots.`; $('kMsg').className = 'kmsg oops'; uhoh(); } else { $('kMsg').textContent = 'Now tap a green dot to move there.'; $('kMsg').className = 'kmsg hint'; } return; }
    L.last = [L.at, sq]; L.at = sq; L.count++; L.foes.delete(sq); $('kMsg').className = 'kmsg';
    const lvDef = LEVELS[L.type][L.lv];
    if (L.stars.has(sq)) { L.stars.delete(sq); const n = lvDef.stars.length - L.stars.size; play(['C5', 'E5', 'G5', 'C6', 'E6'][Math.min(4, n - 1)], .55); } else play(PIECE[L.piece].note, .25);
    if (lvDef.promote && L.piece === 'P' && sq[1] === '8') { L.piece = 'Q'; play('C4', .4, .15); play('E4', .35, .3); play('G4', .35, .45); }
    if (!L.stars.size) {
      L.done = true; const s = L.count <= L.best ? 3 : L.count <= L.best + 2 ? 2 : 1;
      const arr = progress[L.type] || [0, 0, 0]; arr[L.lv] = Math.max(arr[L.lv], s); progress[L.type] = arr; store.set(progress);
      ['C4', 'E4', 'G4', 'C5'].forEach((n, i) => play(n, .45, .12 * i));
      const say = s === 3 ? 'Perfect! You found the quickest way.' : s === 2 ? 'Well done! Can you do it in fewer moves?' : 'You got them all! Try again for more stars.';
      renderLesson(`${'★'.repeat(s)}${'☆'.repeat(3 - s)}  ${say} (${L.count} moves, best is ${L.best})`);
      $('kNext').hidden = false; $('kNext').textContent = L.lv < 2 ? 'Next level' : (ORDER.indexOf(L.type) < ORDER.length - 1 ? 'Next piece: ' + PIECE[ORDER[ORDER.indexOf(L.type) + 1]].name : 'Play Pawn Race');
      const lb = $('kLevels').children[L.lv]; if (lb) lb.textContent = 'Level ' + (L.lv + 1) + ' ' + '★'.repeat(score(L.type, L.lv)) + '☆'.repeat(3 - score(L.type, L.lv));
      buildPicker(); return;
    }
    renderLesson(L.piece === 'Q' && L.type === 'P' ? 'Your pawn became a queen!' : '');
  }
  function next() {
    if (L.lv < 2) return openLesson(L.type, L.lv + 1);
    const i = ORDER.indexOf(L.type); if (i < ORDER.length - 1) openLesson(ORDER[i + 1], 0); else openRace();
  }

  /* ---------- pawn race ---------- */
  const R = { pos: {}, turn: 'w', sel: null, over: false, level: 'easy' };
  function openRace() {
    L.mode = 'race'; $('kLesson').hidden = true; $('kRace').hidden = false; buildPicker(); newRace();
  }
  function newRace() {
    R.pos = {}; for (let f = 0; f < 8; f++) { R.pos[xySq(f, 1)] = 'P'; R.pos[xySq(f, 6)] = 'p'; }
    R.turn = 'w'; R.sel = null; R.over = false; R.last = null; R.level = $('kRaceLevel').value;
    renderRace('Your turn. Tap one of your white pawns, then tap a green dot to move it.');
  }
  function pawnMoves(pos, side) {
    const out = [], dir = side === 'w' ? 1 : -1, home = side === 'w' ? 1 : 6, mine = side === 'w' ? 'P' : 'p', theirs = side === 'w' ? 'p' : 'P';
    for (const s in pos) {
      if (pos[s] !== mine) continue; const [x, y] = sqXY(s);
      if (on(x, y + dir) && !pos[xySq(x, y + dir)]) { out.push([s, xySq(x, y + dir)]); if (y === home && !pos[xySq(x, y + 2 * dir)]) out.push([s, xySq(x, y + 2 * dir)]); }
      [-1, 1].forEach(dx => { const t = on(x + dx, y + dir) && xySq(x + dx, y + dir); if (t && pos[t] === theirs) out.push([s, t]); });
    }
    return out;
  }
  function renderRace(msg) {
    const dots = R.sel && !R.over ? new Set(pawnMoves(R.pos, 'w').filter(m => m[0] === R.sel).map(m => m[1])) : new Set();
    drawBoard($('kRaceBoard'), { pieces: R.pos, dots, sel: R.sel, last: R.last });
    if (msg !== undefined) $('kRaceMsg').textContent = msg;
    const cw = Object.values(R.pos).filter(p => p === 'P').length, cb = Object.values(R.pos).filter(p => p === 'p').length;
    $('kRaceCount').textContent = `Your pawns: ${cw} · Computer's pawns: ${cb}`;
  }
  function apply(m, side) {
    const [a, b] = m; const cap = !!R.pos[b]; R.pos[b] = R.pos[a]; delete R.pos[a]; R.last = [a, b];
    play(side === 'w' ? (cap ? 'G5' : 'E5') : (cap ? 'G4' : 'C5'), cap ? .45 : .28);
    if (side === 'w' && b[1] === '8') return finish(true, 'You reached the far side. You win!');
    if (side === 'b' && b[1] === '1') return finish(false, 'The computer got there first. Try again!');
    const other = side === 'w' ? 'b' : 'w';
    if (!pawnMoves(R.pos, other).length) return finish(side === 'w', side === 'w' ? 'The computer is stuck with no moves. You win!' : 'You have no moves left, so the computer wins. Try again!');
    return false;
  }
  function finish(won, msg) {
    R.over = true;
    if (won) { progress.raceWins = (progress.raceWins || 0) + 1; store.set(progress); ['C4', 'E4', 'G4', 'C5', 'E5'].forEach((n, i) => play(n, .45, .12 * i)); }
    else ['G4', 'E4', 'C4'].forEach((n, i) => play(n, .35, .15 * i));
    renderRace(msg); buildPicker(); return true;
  }
  function raceClick(sq) {
    if (R.over || R.turn !== 'w') return;
    const legal = pawnMoves(R.pos, 'w');
    if (R.sel) { const m = legal.find(m => m[0] === R.sel && m[1] === sq); if (m) { R.sel = null; if (apply(m, 'w')) return; R.turn = 'b'; renderRace('The computer is thinking…'); setTimeout(computer, 550); return; } }
    if (R.pos[sq] === 'P' && legal.some(m => m[0] === sq)) { R.sel = sq; renderRace(''); play('E5', .15); }
    else if (R.pos[sq] === 'P') { renderRace('Uh-oh, that pawn is blocked. Pick another one.'); uhoh(); }
    else if (R.sel) { R.sel = null; renderRace('Uh-oh, that pawn can’t go there. Tap a pawn, then tap a green dot.'); uhoh(); return; }
    else { R.sel = null; renderRace(); }
  }
  function computer() {
    const ms = pawnMoves(R.pos, 'b'); if (!ms.length || R.over) return;
    const hard = R.level === 'hard';
    const attackedByWhite = (pos, s) => { const [x, y] = sqXY(s); return [-1, 1].some(dx => on(x + dx, y - 1) && pos[xySq(x + dx, y - 1)] === 'P'); };
    const defendedByBlack = (pos, s) => { const [x, y] = sqXY(s); return [-1, 1].some(dx => on(x + dx, y + 1) && pos[xySq(x + dx, y + 1)] === 'p'); };
    const whiteThreat = pawnMoves(R.pos, 'w').filter(m => m[1][1] === '8').map(m => m[0]);
    let bestM = null, bestS = -1e9;
    ms.forEach(m => {
      const [a, b] = m, pos = { ...R.pos }; const cap = pos[b]; pos[b] = 'p'; delete pos[a];
      let s = 0; const y = +b[1];
      if (y === 1) s += 1000;
      if (cap) s += 6 + (8 - +b[1]) * (hard ? 1.5 : .5);
      if (whiteThreat.includes(b)) s += hard ? 400 : 60;          // stop a pawn about to win
      if (attackedByWhite(pos, b)) s -= defendedByBlack(pos, b) ? 1 : 5;
      s += (7 - y) * (hard ? .6 : .3);
      s += Math.random() * (hard ? 1.5 : 6);
      if (s > bestS) { bestS = s; bestM = m; }
    });
    if (apply(bestM, 'b')) return;
    R.turn = 'w'; renderRace('Your turn.');
  }

  /* ---------- wiring ---------- */
  function init() {
    $('kBoard').addEventListener('click', e => { const s = e.target.closest('.ksq'); if (s) lessonClick(s.dataset.sq); });
    $('kRaceBoard').addEventListener('click', e => { const s = e.target.closest('.ksq'); if (s) raceClick(s.dataset.sq); });
    $('kRetry').onclick = () => openLesson(L.type, L.lv);
    $('kNext').onclick = next;
    $('kRaceNew').onclick = newRace;
    $('kRaceLevel').onchange = newRace;
    const sb = $('kSound'); const lab = () => { sb.textContent = sound ? '♪ Sound: on' : '♪ Sound: off'; sb.setAttribute('aria-pressed', sound); };
    lab(); sb.onclick = () => { sound = !sound; progress._sound = sound; store.set(progress); lab(); if (sound) play('C5', .4); };
    $('kReset').onclick = () => { if ($('kReset').dataset.armed) { progress = { _sound: sound }; store.set(progress); $('kReset').dataset.armed = ''; $('kReset').textContent = 'Start again'; openLesson(L.type || 'P', 0); } else { $('kReset').dataset.armed = '1'; $('kReset').textContent = 'Sure? Tap again to clear all stars'; setTimeout(() => { $('kReset').dataset.armed = ''; $('kReset').textContent = 'Start again'; }, 4000); } };
  }
  return { init, enter() { if (!L.mode) openLesson('P', firstUnfinished('P')); else buildPicker(); } };
})();
KIDS.init();
