'use strict';
/* ============ helpers ============ */
const $ = id => document.getElementById(id);
const FILES = 'abcdefgh';
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2200); }
function parseFen(fen) {
  const b = {}; fen.split(' ')[0].split('/').forEach((r, i) => { let f = 0; for (const c of r) { if (/\d/.test(c)) f += +c; else { b[FILES[f] + (8 - i)] = c; f++; } } }); return b;
}
function turnOf(fen) { return fen.split(' ')[1]; }
function scoreCp(e) { if (!e) return 0; if (e.mate != null) return e.mate > 0 ? 10000 - Math.abs(e.mate) * 10 : -10000 + Math.abs(e.mate) * 10; return e.cp; }
function fmtEval(e) {
  if (!e) return '–';
  if (e.over) return e.over;
  if (e.mate != null) return (e.mate > 0 ? '+' : '−') + 'M' + Math.abs(e.mate);
  const v = e.cp / 100; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
}
function verdict(e, beginner) {
  if (!e) return '';
  if (e.over) return e.overText || '';
  if (e.mate != null) return (e.mate > 0 ? 'White' : 'Black') + (beginner ? ' can force checkmate' : ' has a forced mate');
  const a = Math.abs(e.cp), s = e.cp > 0 ? 'White' : 'Black';
  if (a < 30) return beginner ? 'Even game' : 'Level';
  if (a < 70) return s + ' is slightly better';
  if (a < 150) return s + ' is clearly better';
  if (a < 300) return s + (beginner ? ' is well on top' : ' has a large advantage');
  return s + ' is winning';
}
function winPct(cp) { cp = Math.max(-1500, Math.min(1500, cp)); return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1); }
function barPct(e) { if (!e) return 50; if (e.mate != null) return e.mate > 0 ? 100 : 0; return winPct(e.cp); }
function setBar(bar, e, flipped) { bar.classList.toggle('flip', !!flipped); bar.querySelector('.w').style.height = barPct(e) + '%'; }
function moveNum(ply) { const n = Math.ceil(ply / 2); return ply % 2 ? n + '.' : n + '...'; }
const CLASS = { '??': ['c-blunder', 'Blunder'], '?': ['c-mistake', 'Mistake'], '?!': ['c-inacc', 'Inaccuracy'], '!': ['c-good', 'Strong move'], '!!': ['c-brill', 'Brilliant'], '!?': ['c-good', 'Bold, risky'] };
function copyText(text) {
  const fallback = () => { const t = el('textarea'); t.value = text; document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { } t.remove(); toast(ok ? 'Copied' : 'Copy not allowed here'); };
  try { navigator.clipboard.writeText(text).then(() => toast('Copied'), fallback); } catch (e) { fallback(); }
}
async function cap(name) { try { return window.claude && window.claude.use ? await window.claude.use(name) : null; } catch (e) { return null; } }

/* ============ engine ============ */
class Engine {
  constructor() {
    this.ok = null; this.cur = null; this.chain = Promise.resolve(); this.gen = 0;
    try { this.w = new Worker('stockfish.js'); } catch (e) { this.ok = false; return; }
    this.w.onmessage = e => { const line = typeof e.data === 'string' ? e.data : ''; if (line === 'uciok') this.ok = true; if (this.cur) this.cur.onLine(line); };
    this.w.onerror = () => { this.ok = false; };
    this.w.postMessage('uci'); this.w.postMessage('isready');
    this.ready = new Promise(res => { const t0 = Date.now(); const iv = setInterval(() => { if (this.ok !== null || Date.now() - t0 > 15000) { clearInterval(iv); if (this.ok === null) this.ok = false; res(this.ok); } }, 100); });
  }
  send(c) { this.w && this.w.postMessage(c); }
  stop() { this.gen++; if (this.cur) { this.cur.cancelled = true; this.send('stop'); } }
  search(fen, o = {}) {
    const myGen = ++this.gen;
    if (this.cur) { this.cur.cancelled = true; this.send('stop'); }
    const p = this.chain.then(() => (myGen !== this.gen) ? { cancelled: true, lines: [] } : this._run(fen, o));
    this.chain = p.catch(() => { });
    return p;
  }
  async _run(fen, o) {
    if (!(await this.ready)) return { cancelled: true, lines: [], failed: true };
    const white = turnOf(fen) === 'w';
    return new Promise(resolve => {
      const job = { cancelled: false, lines: [], depth: 0 };
      job.onLine = line => {
        if (line.startsWith('info') && line.includes(' pv ') && !line.includes('bound')) {
          const t = line.split(' '); const g = k => t[t.indexOf(k) + 1];
          const mpv = +(t.includes('multipv') ? g('multipv') : 1), depth = +g('depth');
          let cp = null, mate = null;
          if (t.includes('cp')) cp = +g('cp'); else if (t.includes('mate')) mate = +g('mate');
          if (!white) { if (cp != null) cp = -cp; if (mate != null) mate = -mate; }
          const uci = t.slice(t.indexOf('pv') + 1);
          job.lines[mpv - 1] = { cp, mate, uci, depth }; job.depth = depth;
          if (o.onInfo && !job.cancelled) o.onInfo(job.lines.filter(Boolean), depth);
        } else if (line.startsWith('bestmove')) {
          this.cur = null; resolve({ bestmove: line.split(' ')[1], lines: job.lines.filter(Boolean), cancelled: job.cancelled, depth: job.depth });
        }
      };
      this.cur = job;
      const opt = { MultiPV: o.multipv || 1, 'Skill Level': o.skill ?? 20, UCI_LimitStrength: o.elo ? 'true' : 'false' };
      if (o.elo) opt.UCI_Elo = o.elo;
      for (const [k, v] of Object.entries(opt)) this.send(`setoption name ${k} value ${v}`);
      this.send('position fen ' + fen);
      this.send(o.depth ? 'go depth ' + o.depth : o.movetime ? 'go movetime ' + o.movetime : 'go infinite');
    });
  }
}
let engA = null, engR = null;
function engineA() { if (!engA) engA = new Engine(); return engA; }
function engineR() { if (!engR) engR = new Engine(); return engR; }

/* ============ board component ============ */
class Board {
  constructor(node, opts = {}) {
    this.node = node; this.flipped = false; this.opts = opts; this.sel = null; this.fen = null; this.hl = [];
    node.addEventListener('pointerdown', e => this._down(e));
    window.addEventListener('pointermove', e => this._move(e));
    window.addEventListener('pointerup', e => this._up(e));
  }
  set(fen, hl = [], interactive = false) { this.fen = fen; this.hl = hl; this.interactive = interactive; this.sel = null; this.render(); }
  sqAt(r, f) { const file = this.flipped ? 7 - f : f, rank = this.flipped ? r + 1 : 8 - r; return FILES[file] + rank; }
  render() {
    const b = parseFen(this.fen), n = this.node; n.innerHTML = ''; n.classList.toggle('interactive', !!this.interactive);
    let chk = null;
    if (this.interactive || this.opts.showCheck) { const c = new Chess(this.fen); if (c.in_check()) { const t = c.turn(); for (const s in b) if (b[s] === (t === 'w' ? 'K' : 'k')) chk = s; } }
    const targets = this.sel ? (this.opts.dotTargets ? this.opts.dotTargets(this.sel) : this._targets(this.sel)) : {};
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const sq = this.sqAt(r, f), file = FILES.indexOf(sq[0]), rank = +sq[1];
      const d = el('div', 'sq ' + (((file + rank) % 2 === 1) ? 'l' : 'd'));
      if (this.hl.includes(sq)) d.classList.add('hl');
      if (sq === this.sel) d.classList.add('sel');
      if (targets[sq]) { d.classList.add('tgt'); if (b[sq]) d.classList.add('cap'); }
      if (sq === chk) d.classList.add('chk');
      d.dataset.sq = sq;
      if (f === 0 && !this.opts.noCoords) d.appendChild(el('span', 'coord r', rank));
      if (r === 7 && !this.opts.noCoords) d.appendChild(el('span', 'coord f', sq[0]));
      if (b[sq]) { const i = el('img'); i.src = PIECES[b[sq]]; i.alt = b[sq]; i.draggable = false; d.appendChild(i); }
      if (this.opts.decorate) this.opts.decorate(sq, d);
      n.appendChild(d);
    }
  }
  _targets(from) { if (this.opts.targets) return this.opts.targets(from); const c = new Chess(this.fen); const t = {}; c.moves({ square: from, verbose: true }).forEach(m => t[m.to] = true); return t; }
  _own(sq) { const p = parseFen(this.fen)[sq]; if (!p) return false; const w = p === p.toUpperCase(); return (turnOf(this.fen) === 'w') === w && (!this.opts.side || this.opts.side() === turnOf(this.fen) || this.opts.side() === 'both'); }
  _sqFromEvent(e) { const t = document.elementFromPoint(e.clientX, e.clientY); const s = t && t.closest && t.closest('.sq'); return s && this.node.contains(s) ? s.dataset.sq : null; }
  _down(e) {
    if (!this.interactive) return;
    const sq = this._sqFromEvent(e); if (!sq) return;
    if (this.sel && sq !== this.sel && this._targets(this.sel)[sq]) { this._try(this.sel, sq); return; }
    if (this._own(sq)) {
      e.preventDefault(); this.sel = sq; this.render();
      const img = this.node.querySelector(`[data-sq="${sq}"] img`);
      if (img) { const r = img.getBoundingClientRect(); const g = img.cloneNode(); g.className = 'ghost'; g.style.width = r.width + 'px'; g.style.height = r.height + 'px'; g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px'; document.body.appendChild(g); this.drag = { g, from: sq, img }; img.classList.add('lift'); }
    } else { this.sel = null; this.render(); }
  }
  _move(e) { if (this.drag) { this.drag.g.style.left = e.clientX + 'px'; this.drag.g.style.top = e.clientY + 'px'; } }
  _up(e) {
    if (!this.drag) return; const { g, from, img } = this.drag; this.drag = null; g.remove(); img.classList.remove('lift');
    const to = this._sqFromEvent(e);
    if (to && to !== from && this._targets(from)[to]) this._try(from, to);
  }
  _try(from, to) {
    const c = new Chess(this.fen); const p = c.get(from);
    const promo = p && p.type === 'p' && (to[1] === '8' || to[1] === '1');
    const done = pr => { this.sel = null; if (this.opts.customMove) return this.opts.customMove(from, to, pr || 'q'); const m = c.move({ from, to, promotion: pr || 'q' }); if (m && this.opts.onMove) this.opts.onMove(m, c.fen()); else this.render(); };
    if (!promo) return done();
    const box = el('div', 'promo'); const col = p.color;
    ['q', 'r', 'b', 'n'].forEach(t => { const b = el('button'); const i = el('img'); i.src = PIECES[col === 'w' ? t.toUpperCase() : t]; i.alt = t; b.appendChild(i); b.onclick = ev => { ev.stopPropagation(); box.remove(); done(t); }; box.appendChild(b); });
    this.node.appendChild(box);
  }
}

/* ============ game model helpers ============ */
function lineSteps(fen, ucis, max = 8) {
  const c = new Chess(fen); const out = [];
  for (const u of (ucis || []).slice(0, max)) {
    const t = c.turn(), n = +c.fen().split(' ')[5];
    const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' }); if (!m) break;
    out.push({ san: m.san, num: t === 'w' ? n + '.' : n + '...', fen: c.fen(), from: m.from, to: m.to, white: t === 'w' });
  }
  return out;
}
function finalEval(fen) {
  const c = new Chess(fen);
  if (c.in_checkmate()) return { cp: c.turn() === 'w' ? -10000 : 10000, mate: null, over: c.turn() === 'w' ? '0–1' : '1–0', overText: 'Checkmate' };
  if (c.in_draw() || c.in_stalemate()) return { cp: 0, mate: null, over: '½–½', overText: c.in_stalemate() ? 'Stalemate' : 'Draw' };
  return null;
}
function prepareGame(g) {
  // derive evals + classification + accuracy
  g.evals = g.fens.map((f, k) => { const fe = finalEval(f); if (fe) return fe; const l = g.lines[k] && g.lines[k][0]; return l ? { cp: l.cp, mate: l.mate } : { cp: 0, mate: null }; });
  g.cls = [null]; g.loss = [0];
  const acc = { w: [], b: [] }, counts = { w: { '?!': 0, '?': 0, '??': 0 }, b: { '?!': 0, '?': 0, '??': 0 } };
  for (let k = 1; k < g.fens.length; k++) {
    const white = k % 2 === 1;
    const before = winPct(scoreCp(g.evals[k - 1])), after = winPct(scoreCp(g.evals[k]));
    const loss = Math.max(0, white ? before - after : after - before);
    g.loss[k] = loss;
    let c = loss >= 30 ? '??' : loss >= 20 ? '?' : loss >= 10 ? '?!' : null;
    // a move that matches the engine's first choice is never marked down
    const best = g.lines[k - 1] && g.lines[k - 1][0]; if (best && best.uci && best.uci[0] === g.ucis[k - 1]) c = null;
    if (g.marks && g.marks[k]) c = g.marks[k];
    g.cls[k] = c;
    const side = white ? 'w' : 'b';
    acc[side].push(Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669)));
    if (c && counts[side][c] != null) counts[side][c]++;
  }
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  g.accuracy = { w: avg(acc.w), b: avg(acc.b) }; g.counts = counts;
  let tp = 0, mx = 0; for (let k = 1; k < g.loss.length; k++) if (g.loss[k] > mx) { mx = g.loss[k]; tp = k; }
  g.turning = mx >= 4 ? tp : null;
  return g;
}
function openingAt(g, ply) { let name = g.openingText || ''; if (g.openings) for (const [p, n] of g.openings) if (ply >= p) name = n; return name; }
function gamePgn(g, level) {
  const H = [['Event', g.event || '?'], ['Site', g.site || '?'], ['Date', g.date || '????'], ['White', g.white || '?'], ['Black', g.black || '?'], ['Result', g.result || '*']];
  let s = H.map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`).join('\n') + '\n\n';
  const notes = (g.notes && g.notes[level]) || {};
  if (notes[0]) s += `{ ${notes[0].replace(/[{}]/g, '')} } `;
  for (let k = 1; k < g.fens.length; k++) {
    if (k % 2) s += Math.ceil(k / 2) + '. ';
    s += g.sans[k - 1] + (g.cls[k] || '') + ' ';
    const e = g.evals[k]; const ev = e.mate != null ? '#' + e.mate : (e.cp / 100).toFixed(2);
    const n = notes[k] ? notes[k].replace(/[{}]/g, '') + ' ' : '';
    s += `{ ${n}[%eval ${ev}] } `;
  }
  return s + (g.result || '*') + '\n';
}

/* ============ router ============ */
const VIEWS = ['home', 'game', 'import', 'analysis', 'play', 'puzzles', 'kids', 'secret'];
let view = 'home';
function show(v) {
  if (view === 'analysis' && v !== 'analysis') engineA().stop();
  if (view === 'game' && v !== 'game') { G.stopAuto(); }
  view = v; VIEWS.forEach(x => $('v-' + x).hidden = x !== v);
  document.querySelectorAll('nav.top .links button').forEach(b => b.classList.toggle('on', b.dataset.nav === v || (v === 'game' && b.dataset.nav === 'home') || (v === 'secret' && b.dataset.nav === 'play')));
  window.scrollTo(0, 0);
  if (v === 'analysis') A.enter(); if (v === 'play') P.enter(); if (v === 'puzzles') Z.enter();
  if (v === 'kids' && typeof KIDS !== 'undefined') KIDS.enter(); if (v === 'secret' && typeof SQ !== 'undefined') SQ.enter();
}
document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => show(b.dataset.nav)));
$('brand').onclick = () => show('home');

/* ============ home ============ */
function miniBoard(node, fen) { const b = parseFen(fen); for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) { const sq = FILES[f] + (8 - r); const d = el('div', 'sq ' + ((f + 8 - r) % 2 ? 'l' : 'd')); if (b[sq]) { const i = el('img'); i.src = PIECES[b[sq]]; i.alt = ''; d.appendChild(i); } node.appendChild(d); } }
function buildHome() {
  const grid = $('grid');
  GAMES.forEach(g => {
    const c = el('button', 'card gcard');
    const m = el('div', 'mini'); miniBoard(m, g.fens[g.thumb ?? g.fens.length - 1]); c.appendChild(m);
    const info = el('div', 'info');
    const yr = el('div', 'yr'); yr.appendChild(el('span', '', g.date + ' · ' + g.site)); yr.appendChild(el('i', '', g.tag)); info.appendChild(yr);
    info.appendChild(el('div', 't', g.title));
    info.appendChild(el('div', 'p', g.white + ' – ' + g.black + ' · ' + g.result.replace('1/2', '½').replace('-', '\u2060–\u2060')));
    c.appendChild(info); c.onclick = () => G.open(g, 0); grid.appendChild(c);
  });
}

/* ============ game view ============ */
const G = {
  g: null, ply: 0, flipped: false, preview: null, timer: null, level: 'expert', mode: 'replay',
  guess: { score: 0, n: 0, busy: false },
  init() {
    this.board = new Board($('gBoard'), { onMove: (m, fen) => this.guessMove(m, fen), side: () => $('guessSide').value });
    $('gStart').onclick = () => { this.stopAuto(); this.go(0); };
    $('gEnd').onclick = () => { this.stopAuto(); this.go(this.g.fens.length - 1); };
    $('gPrev').onclick = () => { this.stopAuto(); if (this.preview) { this.preview = null; this.render(); } else this.go(this.ply - 1); };
    $('gNext').onclick = () => { this.stopAuto(); this.go(this.ply + 1); };
    $('gPlay').onclick = () => this.auto();
    $('gFlip').onclick = () => { this.flipped = !this.flipped; this.render(); };
    $('gBack').onclick = () => { this.preview = null; this.render(); };
    $('lvB').onclick = () => this.setLevel('beginner'); $('lvE').onclick = () => this.setLevel('expert');
    $('mReplay').onclick = () => this.setMode('replay'); $('mGuess').onclick = () => this.setMode('guess');
    $('guessSide').onchange = () => { this.render(); this.autoOpp(); };
    $('guessSkip').onclick = () => { if (this.ply < this.g.fens.length - 1) { $('guessFb').className = 'feedback'; $('guessFb').textContent = 'Skipped. The game move was ' + moveNum(this.ply + 1) + ' ' + this.g.sans[this.ply] + '.'; this.go(this.ply + 1); this.autoOpp(); } };
    $('gExplore').onclick = () => { const f = this.preview ? this.g.lines[this.ply][this.preview.line] && lineSteps(this.g.fens[this.ply], this.g.lines[this.ply][this.preview.line].uci)[this.preview.step].fen : this.g.fens[this.ply]; A.load(f); show('analysis'); };
    $('gCopy').onclick = () => copyText(gamePgn(this.g, this.level));
    $('gDownload').onclick = async () => {
      const base = (this.g.white + '-' + this.g.black + '-' + (this.g.date || '')).replace(/[^\w-]+/g, '_');
      if (window.CHAI_STANDALONE) { const url = URL.createObjectURL(new Blob([gamePgn(this.g, this.level)], { type: 'application/x-chess-pgn' })); const aEl = el('a'); aEl.href = url; aEl.download = base + '.pgn'; document.body.appendChild(aEl); aEl.click(); aEl.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); return; }
      const d = await cap('downloads'); if (!d) return; const name = base + '.pgn.txt'; try { await d.save({ filename: name, data: gamePgn(this.g, this.level) }); } catch (e) { if (e && e.code !== 'declined') toast('Download not available here'); } };
    if (window.CHAI_STANDALONE) $('gDownload').hidden = false; else cap('downloads').then(d => { if (d) $('gDownload').hidden = false; });
    $('gGraph').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); this.stopAuto(); this.go(Math.round((e.clientX - r.left) / r.width * (this.g.fens.length - 1))); });
    $('askClaude').onclick = () => this.askClaude();
    $('stopClaude').onclick = () => this.ctl && this.ctl.abort();
    document.addEventListener('keydown', e => {
      if (view !== 'game' || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') { this.stopAuto(); this.go(this.ply + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { this.stopAuto(); this.go(this.ply - 1); e.preventDefault(); }
      else if (e.key === 'Home') { this.stopAuto(); this.go(0); } else if (e.key === 'End') { this.stopAuto(); this.go(this.g.fens.length - 1); }
      else if (e.key === ' ' && this.mode === 'replay') { this.auto(); e.preventDefault(); }
    });
  },
  open(g, ply = 0) {
    this.g = g; this.preview = null; this.flipped = !!g.flip; this.mode = 'replay'; this.guess = { score: 0, n: 0, busy: false };
    $('mReplay').classList.add('on'); $('mGuess').classList.remove('on');
    $('gEyebrow').textContent = g.user ? 'Your game' + (g.event && g.event !== '?' ? ' · ' + g.event : '') : g.event;
    $('gTitle').textContent = g.user ? g.white + ' v ' + g.black : g.title;
    $('gMeta').innerHTML = ''; [g.user ? '' : g.white + ' v ' + g.black, [g.site, g.date].filter(x => x && x !== '?').join(' · '), 'Result ' + (g.result || '*') + ' · ' + Math.ceil((g.fens.length - 1) / 2) + ' moves'].filter(Boolean).forEach(t => { $('gMeta').appendChild(el('div', '', t)); });
    this.buildMoves(); this.buildReview();
    cap('sample').then(s => { this.sample = s; $('claudeBox').hidden = !(g.user && s); });
    $('claudeBox').hidden = true; $('claudeStatus').textContent = '';
    show('game'); this.go(ply);
  },
  setLevel(l) { this.level = l; $('lvB').classList.toggle('on', l === 'beginner'); $('lvE').classList.toggle('on', l === 'expert'); this.render(); },
  setMode(m) {
    this.mode = m; this.stopAuto(); this.preview = null;
    $('mReplay').classList.toggle('on', m === 'replay'); $('mGuess').classList.toggle('on', m === 'guess');
    if (m === 'guess') { this.guess = { score: 0, n: 0, busy: false }; $('guessFb').className = 'feedback'; $('guessFb').textContent = 'Play the move you think the master chose. Exact match 3 points; an engine-approved alternative 2 or 1.'; if (this.ply >= this.g.fens.length - 1) this.ply = 0; }
    this.render(); if (m === 'guess') this.autoOpp();
  },
  guessing() { if (this.mode !== 'guess' || this.ply >= this.g.fens.length - 1) return false; const s = $('guessSide').value; return s === 'both' || s === turnOf(this.g.fens[this.ply]); },
  autoOpp() {
    clearTimeout(this._opp);
    if (this.mode !== 'guess' || this.guessing() || this.ply >= this.g.fens.length - 1) { if (this.mode === 'guess' && this.ply >= this.g.fens.length - 1) { $('guessFb').className = 'feedback ok'; $('guessFb').textContent = `End of the game. You scored ${this.guess.score} from ${this.guess.n} guesses (maximum ${this.guess.n * 3}).`; } return; }
    this._opp = setTimeout(() => { if (this.mode === 'guess' && !this.guessing()) { this.go(this.ply + 1); this.autoOpp(); } }, 700);
  },
  async guessMove(m, fen) {
    if (!this.guessing() || this.guess.busy) return;
    const g = this.g, k = this.ply, uci = m.from + m.to + (m.promotion && m.promotion !== 'q' ? m.promotion : (g.ucis[k].length > 4 && m.promotion ? m.promotion : ''));
    const master = g.sans[k]; const fb = $('guessFb'); this.guess.busy = true; this.guess.n++;
    this.board.set(fen, [m.from, m.to], false);
    if (uci.slice(0, 4) === g.ucis[k].slice(0, 4)) { this.guess.score += 3; fb.className = 'feedback ok'; fb.textContent = `${m.san} is exactly what was played. +3`; }
    else {
      fb.className = 'feedback'; fb.textContent = `${m.san}: checking with the engine…`;
      const res = await engineA().search(fen, { depth: 12 });
      let pts = 0, txt;
      const fe = finalEval(fen);
      const after = fe ? fe : (res.lines[0] || { cp: 0 }), best = g.evals[k];
      const white = turnOf(g.fens[k]) === 'w';
      const diff = white ? scoreCp(best) - scoreCp(after) : scoreCp(after) - scoreCp(best);
      if (diff <= 30) { pts = 2; txt = `Not the game move, but the engine rates ${m.san} as just as good. +2`; }
      else if (diff <= 100) { pts = 1; txt = `${m.san} is playable but a bit weaker (about ${(diff / 100).toFixed(1)} pawns by the engine). +1`; }
      else { txt = `${m.san} costs about ${(Math.min(diff, 2000) / 100).toFixed(1)} pawns by the engine. 0`; }
      this.guess.score += pts; fb.className = 'feedback ' + (pts === 2 ? 'ok' : pts ? 'meh' : 'no'); fb.textContent = txt + ` · The game move: ${moveNum(k + 1)} ${master}.`;
    }
    setTimeout(() => { this.guess.busy = false; this.go(k + 1); this.autoOpp(); }, 1300);
  },
  auto() { if (this.timer) { this.stopAuto(); return; } if (this.ply >= this.g.fens.length - 1) this.go(0); $('gPlay').textContent = '❚❚ Pause'; this.timer = setInterval(() => { if (this.ply >= this.g.fens.length - 1) { this.stopAuto(); return; } this.go(this.ply + 1); }, 2200); },
  stopAuto() { if (this.timer) { clearInterval(this.timer); this.timer = null; } $('gPlay').textContent = '▶ Play'; },
  go(k) { this.preview = null; this.ply = Math.max(0, Math.min(this.g.fens.length - 1, k)); this.render(); },
  buildMoves() {
    const M = $('gMoves'); M.innerHTML = ''; const g = this.g;
    for (let k = 1; k < g.fens.length; k += 2) {
      M.appendChild(el('span', 'n', Math.ceil(k / 2) + '.'));
      [k, k + 1].forEach(j => {
        if (j < g.fens.length) { const b = el('button'); b.dataset.k = j; b.textContent = g.sans[j - 1]; if (g.cls[j]) { const s = el('sup', CLASS[g.cls[j]][0], g.cls[j]); b.appendChild(s); } b.onclick = () => { this.stopAuto(); if (this.mode === 'guess') this.setMode('replay'); this.go(j); }; M.appendChild(b); }
        else M.appendChild(el('span'));
      });
    }
  },
  buildReview() {
    const g = this.g, R = $('gReview'); R.innerHTML = '';
    [['w', g.white], ['b', g.black]].forEach(([s, name]) => {
      const d = el('div', 'pl'); d.appendChild(el('div', 'eyebrow', (s === 'w' ? 'White · ' : 'Black · ') + name));
      const a = el('div', 'acc'); a.textContent = g.accuracy[s] != null ? Math.round(g.accuracy[s]) : '–'; a.appendChild(el('small', '', '% accuracy')); d.appendChild(a);
      const ul = el('ul'); [['?!', 'Inaccuracies'], ['?', 'Mistakes'], ['??', 'Blunders']].forEach(([k, lab]) => { const li = el('li'); li.appendChild(el('span', '', lab)); li.appendChild(el('b', CLASS[k][0], g.counts[s][k])); ul.appendChild(li); }); d.appendChild(ul); R.appendChild(d);
    });
    const T = $('gTurn'); T.innerHTML = '';
    if (g.turning) { T.appendChild(document.createTextNode('Biggest swing: ')); const b = el('button', '', moveNum(g.turning) + ' ' + g.sans[g.turning - 1] + (g.cls[g.turning] && g.cls[g.turning].includes('?') ? g.cls[g.turning] : '')); b.onclick = () => { if (this.mode === 'guess') this.setMode('replay'); this.go(g.turning); }; T.appendChild(b); T.appendChild(document.createTextNode(` · winning chances moved ${Math.round(g.loss[g.turning])} points.`)); }
    else T.textContent = 'No big swings: neither side made a serious error by the engine\'s standards.';
  },
  autoNote(k, beginner) {
    const g = this.g; if (k === 0) return '';
    const c = g.cls[k]; const best = g.lines[k - 1] && g.lines[k - 1][0];
    if (k === g.fens.length - 1) { const fe = finalEval(g.fens[k]); if (fe && fe.overText === 'Checkmate') return beginner ? 'Checkmate. The game is over.' : 'Checkmate.'; }
    if (!c || c === '!' || c === '!!') return '';
    const bestSan = best ? lineSteps(g.fens[k - 1], best.uci, 1)[0] : null;
    const name = CLASS[c][1].toLowerCase();
    if (beginner) return `The engine thinks this was ${c === '?!' ? 'not the best choice' : 'a ' + name}. ${bestSan ? 'A better move was ' + bestSan.san + '.' : ''} Click the engine lines below to see why.`;
    return `Engine assessment: ${name}, winning chances drop by about ${Math.round(g.loss[k])} points. ${bestSan ? 'Stockfish preferred ' + bestSan.num + ' ' + bestSan.san + '.' : ''}`;
  },
  render() {
    const g = this.g, k = this.ply, guessing = this.mode === 'guess';
    const names = [g.white, g.black];
    const top = this.flipped ? 0 : 1, bot = 1 - top;
    $('gTop').innerHTML = ''; $('gTop').appendChild(el('span', '', names[top])); $('gTop').appendChild(el('small', '', top === 0 ? 'White' : 'Black'));
    $('gBot').innerHTML = ''; $('gBot').appendChild(el('span', '', names[bot])); $('gBot').appendChild(el('small', '', bot === 0 ? 'White' : 'Black'));
    this.board.flipped = this.flipped;
    if (this.preview) {
      const st = lineSteps(g.fens[k], g.lines[k][this.preview.line].uci)[this.preview.step];
      this.board.set(st.fen, [st.from, st.to]); $('gBoard').classList.add('previewing');
    } else {
      const hl = k > 0 ? [g.ucis[k - 1].slice(0, 2), g.ucis[k - 1].slice(2, 4)] : [];
      this.board.set(g.fens[k], hl, this.guessing()); $('gBoard').classList.remove('previewing');
    }
    $('gPreviewBar').hidden = !this.preview;
    setBar($('gBar'), g.evals[k], this.flipped);
    // mode visibility
    $('guessCard').hidden = !guessing; ['linesCard', 'reviewCard'].forEach(id => $(id).hidden = guessing);
    $('gGraph').parentElement.hidden = guessing; $('gMoves').parentElement.hidden = guessing;
    if (guessing) { $('guessScore').textContent = this.guess.score; $('guessTally').textContent = `points from ${this.guess.n} guess${this.guess.n === 1 ? '' : 'es'}`; }
    // commentary
    const beginner = this.level === 'beginner';
    $('gOpening').textContent = openingAt(g, k) || (g.user ? 'Opening not identified' : '');
    $('gSan').textContent = k ? moveNum(k) + ' ' + g.sans[k - 1] : 'Start';
    const c = g.cls[k]; $('gGlyph').innerHTML = ''; if (c) { const s = el('span', 'glyph ' + CLASS[c][0], c + ' ' + CLASS[c][1]); $('gGlyph').appendChild(s); }
    const e = g.evals[k]; $('gEv').textContent = fmtEval(e);
    $('gEvText').textContent = verdict(e, beginner) + (k === g.fens.length - 1 && !finalEval(g.fens[k]) && g.result && g.result !== '*' ? ' · game ended ' + g.result : '');
    const notes = (g.notes && g.notes[this.level]) || {};
    let txt = notes[k] || '', auto = false;
    if (!txt) { txt = this.autoNote(k, beginner); auto = true; }
    if (!txt) txt = k === 0 ? (g.user ? 'Step through the game, or ask Claude for commentary below.' : '') : (beginner ? 'Nothing special here. Keep going.' : 'No comment needed.');
    $('gNote').textContent = txt; $('gNote').className = 'note' + (auto ? ' auto' : '');
    // engine lines
    const L = $('gLines'); L.innerHTML = '';
    const side = turnOf(g.fens[k]) === 'w' ? 'White' : 'Black';
    $('gLinesHead').textContent = k === g.fens.length - 1 ? (g.lines[k] && g.lines[k].length ? 'How it could have continued' : 'Game over') : `Best moves for ${side} here`;
    (g.lines[k] || []).forEach((ln, li) => {
      const row = el('div', 'line'); row.appendChild(el('span', 'ev', fmtEval(ln)));
      lineSteps(g.fens[k], ln.uci).forEach((s, si) => {
        if (si === 0 || s.white) row.appendChild(el('span', 'num', s.num));
        const b = el('button', 'stp' + (this.preview && this.preview.line === li && this.preview.step === si ? ' on' : ''), s.san);
        b.onclick = () => { this.stopAuto(); this.preview = { line: li, step: si }; this.render(); }; row.appendChild(b);
      });
      L.appendChild(row);
    });
    if (!(g.lines[k] || []).length) L.appendChild(el('p', 'status', k === g.fens.length - 1 ? 'No moves left to analyse.' : 'No engine lines for this position.'));
    document.querySelectorAll('#gMoves button').forEach(b => b.classList.toggle('cur', +b.dataset.k === k));
    const cur = document.querySelector('#gMoves button.cur'); if (cur) { const box = $('gMoves'), br = box.getBoundingClientRect(), cr = cur.getBoundingClientRect(); if (cr.top < br.top || cr.bottom > br.bottom) box.scrollTop += (cr.top - br.top) - box.clientHeight / 2; }
    this.drawGraph();
  },
  drawGraph() {
    const g = this.g, W = 400, n = Math.max(1, g.fens.length - 1), svg = $('gGraph'), cs = getComputedStyle(document.documentElement);
    const y = e => { const v = Math.max(-6, Math.min(6, scoreCp(e) / 100)); return 35 - v / 6 * 32; };
    const pts = g.evals.map((e, i) => [i / n * W, y(e)]);
    const area = 'M0,35 ' + pts.map(q => `L${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ') + ` L${W},35 Z`;
    let marks = ''; g.cls.forEach((c, i) => { if (c && c.includes('?')) marks += `<circle cx="${(i / n * W).toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="2.6" fill="${cs.getPropertyValue(c === '??' ? '--bad' : c === '?' ? '--mist' : '--dubious')}"/>`; });
    const x = this.ply / n * W;
    svg.innerHTML = `<rect x="0" y="0" width="${W}" height="70" fill="${cs.getPropertyValue('--bar-black')}"/><path d="${area}" fill="${cs.getPropertyValue('--bar-white')}"/><line x1="0" x2="${W}" y1="35" y2="35" stroke="${cs.getPropertyValue('--accent')}" stroke-width="1" vector-effect="non-scaling-stroke"/>${marks}<line x1="${x}" x2="${x}" y1="0" y2="70" stroke="${cs.getPropertyValue('--accent')}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  },
  async askClaude() {
    const g = this.g, level = this.level, S = this.sample; if (!S) return;
    const st = $('claudeStatus'); this.ctl = new AbortController(); $('askClaude').disabled = true; $('stopClaude').hidden = false; st.textContent = 'Thinking… (usually 30–90 seconds)';
    const rows = [];
    for (let k = 1; k < g.fens.length; k++) {
      const best = g.lines[k - 1] && g.lines[k - 1][0]; const bs = best ? lineSteps(g.fens[k - 1], best.uci, 3).map(s => s.san).join(' ') : '';
      rows.push(`${k}: ${moveNum(k)} ${g.sans[k - 1]} | eval after ${fmtEval(g.evals[k])}${g.cls[k] ? ' | ' + CLASS[g.cls[k]][1] : ''}${best && best.uci[0] !== g.ucis[k - 1] ? ' | engine preferred ' + bs : ''}`);
    }
    const audience = level === 'beginner'
      ? 'a BEGINNER who knows how the pieces move but not much strategy. Use plain words, explain any chess term you must use (fork, pin, development, open file) in a few words, focus on the big ideas: piece safety, development, king safety, simple tactics.'
      : 'an experienced CLUB PLAYER. Use normal chess terminology, name the opening and plans, explain the engine\'s preferences concretely.';
    const prompt = `You are a chess coach writing move-by-move commentary for ${audience}\n\nGame: ${g.white} (White) v ${g.black} (Black)${g.event && g.event !== '?' ? ', ' + g.event : ''}${g.date && g.date !== '?' ? ', ' + g.date : ''}. Result ${g.result || 'unknown'}.\nEach line below is: ply number: move | Stockfish evaluation after the move in pawns from White's side | engine classification if any | engine's preferred line if different.\n\n${rows.join('\n')}\n\nWrite commentary for 12 to 25 of the most instructive plies: the opening's main idea, every mistake or blunder, turning points and the finish. Base tactical claims on the engine data given; do not invent variations you cannot justify. Each note 1 to 3 sentences, plain prose, no markdown. Be direct and objective, not gushing.\n\nReply with only JSON of this shape:\n{"opening": "opening name, e.g. Italian Game: Giuoco Piano", "summary": "2-4 sentence overview of how the game went", "notes": {"5": "note on ply 5", "12": "note on ply 12"}}`;
    try {
      const res = await S.json(prompt, { signal: this.ctl.signal, onText: () => { st.textContent = 'Writing…'; } });
      if (!res || typeof res !== 'object' || !res.notes) throw { code: 'invalid_json' };
      g.notes = g.notes || {}; const n = {}; if (res.summary) n[0] = String(res.summary);
      for (const [p, t] of Object.entries(res.notes)) { const pi = parseInt(p, 10); if (pi >= 1 && pi < g.fens.length) n[pi] = String(t); }
      g.notes[level] = n; if (res.opening && !g.openingText) g.openingText = String(res.opening);
      st.textContent = `Done: ${Object.keys(n).length} notes (${level}). Switch level to get the other style.`;
      this.render();
    } catch (e) {
      const code = e && e.code;
      st.textContent = code === 'cancelled' ? 'Stopped.' : code === 'not_granted' || code === 'sampling_disabled' ? 'Claude is not available for this page.' : code === 'rate_limited' ? 'Too many requests just now. Try again in a minute.' : code === 'invalid_json' ? 'The reply could not be read. Try again.' : 'Something went wrong. Try again.';
      if (code === 'not_granted' || code === 'sampling_disabled') $('askClaude').hidden = true;
    } finally { $('askClaude').disabled = false; $('stopClaude').hidden = true; }
  }
};

/* ============ PGN import + browser review ============ */
function cleanPgn(text) {
  const headers = {}; text.replace(/\[(\w+)\s+"([^"]*)"\]/g, (m, k, v) => { headers[k] = v; return ''; });
  let body = text.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  let prev; do { prev = body; body = body.replace(/\([^()]*\)/g, ' '); } while (body !== prev);
  body = body.replace(/\$\d+/g, ' ').replace(/\d+\.(\.\.)?/g, ' ').replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/, ' ');
  const toks = body.split(/\s+/).filter(t => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)).map(t => t.replace(/[!?]+$/, '').replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O'));
  return { headers, toks };
}
function gameFromPgn(text) {
  const { headers, toks } = cleanPgn(text);
  const c = new Chess(headers.FEN && headers.SetUp !== '0' ? headers.FEN : undefined);
  if (headers.FEN && c.fen() !== headers.FEN && !c.load(headers.FEN)) throw new Error('The FEN header is not valid.');
  const fens = [c.fen()], sans = [], ucis = [];
  for (const t of toks) {
    const m = c.move(t, { sloppy: true });
    if (!m) throw new Error(`Could not read move “${t}” (move ${Math.floor(sans.length / 2) + 1}).`);
    sans.push(m.san); ucis.push(m.from + m.to + (m.promotion || '')); fens.push(c.fen());
  }
  if (!sans.length) throw new Error('No moves found. Paste the full PGN text, including the moves.');
  return { user: true, white: headers.White || 'White', black: headers.Black || 'Black', event: headers.Event || '', site: headers.Site && !/^https?:/.test(headers.Site) ? headers.Site : '', date: (headers.Date || headers.UTCDate || '').replace(/\?+/g, '').replace(/\.+$/, ''), result: headers.Result || '*', openingText: headers.Opening || (headers.ECO ? 'ECO ' + headers.ECO : ''), fens, sans, ucis, lines: [], notes: {} };
}
async function reviewGame(g, onProg) {
  const E = engineR(); if (!(await E.ready)) throw new Error('The engine could not start in this browser.');
  g.lines = [];
  for (let k = 0; k < g.fens.length; k++) {
    if (finalEval(g.fens[k])) { g.lines.push([]); continue; }
    const r = await E.search(g.fens[k], { depth: 13, multipv: 3 });
    g.lines.push(r.lines.map(l => ({ cp: l.cp, mate: l.mate, uci: l.uci.slice(0, 8) })));
    onProg && onProg(k + 1, g.fens.length);
  }
  return prepareGame(g);
}
let reviewing = false;
async function importAndReview(g) {
  if (reviewing) return; reviewing = true;
  show('import'); $('anaProg').hidden = false; $('anaBar').style.width = '0%'; $('anaMsg').textContent = 'Starting the engine…';
  try {
    await reviewGame(g, (d, n) => { $('anaBar').style.width = (d / n * 100) + '%'; $('anaMsg').textContent = `Analysing position ${d} of ${n}…`; });
    $('anaMsg').textContent = 'Done.'; G.open(g, 0);
  } catch (e) { $('anaMsg').textContent = e.message || 'Analysis failed.'; }
  finally { reviewing = false; }
}
$('pgnGo').onclick = () => {
  $('pgnMsg').textContent = '';
  try { const g = gameFromPgn($('pgnIn').value); importAndReview(g); }
  catch (e) { $('pgnMsg').textContent = e.message; }
};
$('pgnSample').onclick = () => { $('pgnIn').value = '[Event "Casual game"]\n[White "Example player"]\n[Black "Opponent"]\n[Result "0-1"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1'; };
$('linkGo').onclick = () => {
  const v = $('linkIn').value.trim(), M = $('linkMsg');
  if (/lichess\.org/.test(v)) M.innerHTML = 'That is a Lichess link. Open it, choose <b>Share &amp; export</b> (or <b>FEN &amp; PGN</b>) under the board, copy the PGN, and paste it above. The page cannot fetch it directly because it has no internet access of its own.';
  else if (/chess\.com/.test(v)) M.innerHTML = 'That is a Chess.com link. Open it, press <b>Share</b>, choose the <b>PGN</b> tab, copy it, and paste it above. The page cannot fetch it directly because it has no internet access of its own.';
  else if (/chessgames\.com/.test(v)) M.innerHTML = 'That is a Chessgames.com link. Use the <b>download</b> link on the game page, open the file and paste its text above.';
  else M.textContent = 'Paste the game\'s PGN text above. If you have a link, open it and copy the PGN from the site\'s share or export option.';
};

/* ============ analysis board ============ */
const A = {
  c: new Chess(), start: null, flipped: false, lines: [],
  init() {
    this.board = new Board($('aBoard'), { onMove: (m) => { this.c.move(m.san); this.update(); } });
    $('aUndo').onclick = () => { this.c.undo(); this.update(); };
    $('aReset').onclick = () => this.load(null);
    $('aFlip').onclick = () => { this.flipped = !this.flipped; this.update(); };
    $('aFenGo').onclick = () => { const f = $('aFen').value.trim(); const t = new Chess(); if (!t.load(f)) { toast('That FEN is not valid'); return; } this.load(f); };
    $('aCopy').onclick = () => copyText(this.c.pgn() || '(no moves yet)');
  },
  load(fen) { this.c = fen ? new Chess(fen) : new Chess(); this.start = fen; if (fen) { this.c.header('SetUp', '1', 'FEN', fen); } this.flipped = fen ? turnOf(fen) === 'b' : false; if (view === 'analysis') this.update(); else this.pending = true; },
  enter() { this.update(); },
  update() {
    const fen = this.c.fen(); const h = this.c.history({ verbose: true }); const last = h[h.length - 1];
    this.board.flipped = this.flipped; this.board.set(fen, last ? [last.from, last.to] : [], !this.c.game_over());
    // moves list
    const M = $('aMoves'); M.innerHTML = ''; const hs = this.c.history(); const startBlack = turnOf(this.start || 'x w') === 'b'; let n = this.start ? +this.start.split(' ')[5] : 1;
    let i = 0; if (startBlack && hs.length) { M.appendChild(el('span', 'n', n + '.')); M.appendChild(el('span', '', '…')); M.appendChild(el('button', '', hs[0])); i = 1; n++; }
    for (; i < hs.length; i += 2, n++) { M.appendChild(el('span', 'n', n + '.')); M.appendChild(el('button', '', hs[i])); M.appendChild(hs[i + 1] ? el('button', '', hs[i + 1]) : el('span')); }
    const fe = finalEval(fen);
    if (fe) { engineA().stop(); $('aEv').textContent = fe.over; $('aEvText').textContent = fe.overText; $('aLines').innerHTML = ''; $('aDepth').textContent = ''; setBar($('aBar'), { cp: fe.cp }, this.flipped); return; }
    $('aDepth').textContent = 'starting…'; $('aLines').innerHTML = '';
    const E = engineA();
    E.search(fen, { multipv: 3, depth: 22, onInfo: (lines, d) => { if (this.c.fen() !== fen) return; this.show(fen, lines, d); } }).then(r => { if (r.failed) $('aDepth').textContent = 'engine unavailable in this browser'; });
  },
  show(fen, lines, d) {
    $('aDepth').textContent = 'depth ' + d + (d >= 22 ? ' · done' : '');
    const e = lines[0]; $('aEv').textContent = fmtEval(e); $('aEvText').textContent = verdict(e); setBar($('aBar'), e, this.flipped);
    const L = $('aLines'); L.innerHTML = '';
    lines.forEach(ln => {
      const row = el('div', 'line'); row.appendChild(el('span', 'ev', fmtEval(ln)));
      lineSteps(fen, ln.uci, 8).forEach((s, si, arr) => {
        if (si === 0 || s.white) row.appendChild(el('span', 'num', s.num));
        const b = el('button', 'stp', s.san); b.onclick = () => { for (let j = 0; j <= si; j++) this.c.move(arr[j].san); this.update(); }; row.appendChild(b);
      });
      L.appendChild(row);
    });
  }
};

/* ============ play the engine ============ */
const LEVELS = [
  { name: '~800 · Beginner', skill: 0, depth: 1, random: 0.3 },
  { name: '~1100 · Casual', skill: 3, depth: 3, random: 0.1 },
  { name: '~1400 · Club', elo: 1400, movetime: 400 },
  { name: '~1700 · Strong club', elo: 1700, movetime: 500 },
  { name: '~2000 · Expert', elo: 2000, movetime: 700 },
  { name: '~2400 · Master', elo: 2400, movetime: 900 },
  { name: 'Full strength (3000+)', movetime: 1500 },
];
const TIME_CONTROLS = [
  { id: 'none', name: 'No clock' },
  { id: '1+0', name: '1 min (bullet)', base: 60, inc: 0 },
  { id: '3+2', name: '3 min + 2 s (blitz)', base: 180, inc: 2 },
  { id: '5+3', name: '5 min + 3 s (blitz)', base: 300, inc: 3 },
  { id: '10+0', name: '10 min (rapid)', base: 600, inc: 0 },
  { id: '15+10', name: '15 min + 10 s (rapid)', base: 900, inc: 10 },
];
function fmtClock(ms) {
  ms = Math.max(0, ms);
  if (ms < 10000) return (ms / 1000).toFixed(1);
  const s = Math.ceil(ms / 1000), m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0');
}
const P = {
  c: null, you: 'w', over: false, thinking: false, colourPick: 'w',
  tc: null, clock: null, running: null, lastTick: 0, started: false, timer: null,
  init() {
    LEVELS.forEach((l, i) => { const o = el('option', '', l.name); o.value = i; $('pLevel').appendChild(o); }); $('pLevel').value = 2;
    TIME_CONTROLS.forEach(t => { const o = el('option', '', t.name); o.value = t.id; $('pTime').appendChild(o); }); $('pTime').value = 'none';
    this.board = new Board($('pBoard'), { onMove: m => this.userMove(m), side: () => this.you });
    [['cW', 'w'], ['cB', 'b'], ['cR', 'r']].forEach(([id, v]) => $(id).onclick = () => { this.colourPick = v; ['cW', 'cB', 'cR'].forEach(x => $(x).classList.toggle('on', x === id)); });
    $('pNew').onclick = () => this.newGame();
    $('pTake').onclick = () => { if (this.thinking || !this.c || this.tc) return; engineA().stop(); this.c.undo(); if (this.c.turn() !== this.you) this.c.undo(); this.over = false; this.update(); };
    $('pResign').onclick = () => { if (!this.c || this.over) return; this.end(this.you === 'w' ? '0-1' : '1-0', 'You resigned.'); };
    $('pReview').onclick = () => {
      const c = this.c; const g = { user: true, white: this.you === 'w' ? 'You' : 'Stockfish ' + LEVELS[this.level].name, black: this.you === 'b' ? 'You' : 'Stockfish ' + LEVELS[this.level].name, event: 'Game against the engine' + (this.tc ? ' · ' + this.tc.id : ''), date: new Date().toISOString().slice(0, 10), result: this.result || '*', flip: this.you === 'b', fens: [new Chess().fen()], sans: [], ucis: [], lines: [], notes: {} };
      const t = new Chess(); c.history({ verbose: true }).forEach(m => { t.move(m.san); g.sans.push(m.san); g.ucis.push(m.from + m.to + (m.promotion || '')); g.fens.push(t.fen()); });
      if (!g.sans.length) { toast('No moves to review'); return; }
      importAndReview(g);
    };
  },
  enter() { if (!this.c) { this.board.set(new Chess().fen(), [], false); this.names(); } },
  names() {
    const eng = 'Stockfish', lv = LEVELS[this.level ?? +$('pLevel').value].name;
    const set = (n, a, b, side) => {
      n.innerHTML = ''; const d = el('div', 'pname'); d.appendChild(el('span', '', a)); d.appendChild(el('small', '', b)); n.appendChild(d);
      const ck = el('span', 'clock'); ck.dataset.side = side; ck.hidden = !this.tc; n.appendChild(ck);
    };
    const engSide = this.you === 'w' ? 'b' : 'w';
    set($('pTop'), eng, lv + (engSide === 'w' ? ' · White' : ' · Black'), engSide);
    set($('pBot'), 'You', this.you === 'w' ? 'White' : 'Black', this.you);
    this.drawClocks();
  },
  newGame() {
    engineA().stop(); this.stopClock();
    this.you = this.colourPick === 'r' ? (Math.random() < .5 ? 'w' : 'b') : this.colourPick; this.level = +$('pLevel').value;
    const T = TIME_CONTROLS.find(t => t.id === $('pTime').value); this.tc = T && T.base ? T : null;
    this.clock = this.tc ? { w: this.tc.base * 1000, b: this.tc.base * 1000 } : null; this.running = null; this.started = false;
    $('pTake').disabled = !!this.tc; $('pTake').title = this.tc ? 'No takebacks in timed games' : 'Take back your last move';
    this.c = new Chess(); this.over = false; this.result = null; this.board.flipped = this.you === 'b'; $('pReview').hidden = true; this.names();
    $('pStatus').textContent = this.you === 'w' ? 'Your move. You have White.' + (this.tc ? ' The clocks start after White\'s first move.' : '') : 'Stockfish is thinking…';
    this.update(); if (this.c.turn() !== this.you) this.engineMove();
  },
  /* ---- clocks ---- */
  settle() { if (this.running && this.clock) { const now = performance.now(); this.clock[this.running] -= now - this.lastTick; this.lastTick = now; } },
  moved(side) {                         // call right after `side` completed a move
    if (!this.tc || this.over) return;
    this.settle();
    if (this.started) this.clock[side] += this.tc.inc * 1000;
    else if (side === 'w') this.started = true;
    this.running = this.started ? (side === 'w' ? 'b' : 'w') : null; this.lastTick = performance.now();
    if (this.running && !this.timer) this.timer = setInterval(() => this.tick(), 100);
    this.drawClocks();
  },
  tick() {
    if (!this.running) return; this.settle();
    if (this.clock[this.running] <= 0) {
      this.clock[this.running] = 0; const loser = this.running;
      const other = loser === 'w' ? 'b' : 'w';
      const board = this.c.board().flat().filter(Boolean);
      const canMate = board.some(p => p.color === other && p.type !== 'k');
      engineA().stop(); this.thinking = false;
      const youLost = loser === this.you;
      if (!canMate) this.end('1/2-1/2', (youLost ? 'Your' : 'Stockfish\'s') + ' flag fell, but the other side has only a king left, so it is a draw.');
      else this.end(loser === 'w' ? '0-1' : '1-0', youLost ? 'Out of time. Stockfish wins on the clock.' : 'Stockfish ran out of time. You win on the clock!');
    }
    this.drawClocks();
  },
  stopClock() { this.settle(); this.running = null; if (this.timer) { clearInterval(this.timer); this.timer = null; } },
  drawClocks() {
    document.querySelectorAll('#v-play .clock').forEach(ck => {
      ck.hidden = !this.tc; if (!this.tc || !this.clock) return;
      const s = ck.dataset.side, ms = this.clock[s];
      ck.textContent = fmtClock(ms); ck.classList.toggle('run', this.running === s && !this.over); ck.classList.toggle('low', ms < 20000);
    });
  },
  budget(L) {                           // how long the engine may think for this move (ms)
    const want = L.movetime || 600;
    if (!this.tc) return want;
    const side = this.you === 'w' ? 'b' : 'w', left = this.clock[side], inc = this.tc.inc * 1000;
    return Math.max(80, Math.min(want, left / 35 + inc * .7));
  },
  end(result, msg) {
    this.stopClock(); this.over = true; this.result = result; $('pStatus').textContent = msg; this.update(); this.drawClocks();
  },
  userMove(m) {
    if (this.over || this.thinking) return;
    this.c.move(m.san); this.moved(this.you); this.update();
    if (!this.checkEnd()) this.engineMove();
  },
  async engineMove() {
    this.thinking = true; $('pStatus').textContent = 'Stockfish is thinking…'; this.update();
    const L = LEVELS[this.level], fen = this.c.fen(); const t0 = Date.now(); const budget = this.budget(L);
    let mv = null;
    if (L.random && Math.random() < L.random) { const ms = this.c.moves({ verbose: true }); const m = ms[Math.floor(Math.random() * ms.length)]; mv = m.from + m.to + (m.promotion || ''); await new Promise(r => setTimeout(r, Math.min(500, budget))); }
    else {
      const r = await engineA().search(fen, { skill: L.skill, elo: L.elo, depth: L.depth, movetime: L.depth ? undefined : budget });
      if (r.cancelled || r.failed) { this.thinking = false; if (r.failed) $('pStatus').textContent = 'The engine could not start in this browser.'; return; }
      mv = r.bestmove; const wait = Math.min(450, budget) - (Date.now() - t0); if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    if (this.c.fen() !== fen || this.over) { this.thinking = false; return; }
    this.c.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] || 'q' });
    this.moved(this.you === 'w' ? 'b' : 'w');
    this.thinking = false; this.update(); if (!this.checkEnd()) $('pStatus').textContent = 'Your move.';
  },
  checkEnd() {
    const c = this.c; if (!c.game_over()) return false;
    if (c.in_checkmate()) { const youWon = c.turn() !== this.you; this.end(c.turn() === 'w' ? '0-1' : '1-0', youWon ? 'Checkmate. You won.' : 'Checkmate. Stockfish wins this one.'); }
    else this.end('1/2-1/2', c.in_stalemate() ? 'Stalemate. Draw.' : c.in_threefold_repetition() ? 'Draw by repetition.' : c.insufficient_material() ? 'Draw: not enough material to mate.' : 'Draw.');
    return true;
  },
  update() {
    const c = this.c; if (!c) return; const h = c.history({ verbose: true }); const last = h[h.length - 1];
    this.board.set(c.fen(), last ? [last.from, last.to] : [], !this.over && !this.thinking && c.turn() === this.you);
    $('pReview').hidden = !(this.over && h.length);
    const M = $('pMoves'); M.innerHTML = ''; const hs = c.history();
    for (let i = 0; i < hs.length; i += 2) { M.appendChild(el('span', 'n', (i / 2 + 1) + '.')); M.appendChild(el('span', '', hs[i])); M.appendChild(el('span', '', hs[i + 1] || '')); }
    M.scrollTop = M.scrollHeight;
  }
};

/* ============ puzzles ============ */
const Z = {
  i: 0, solved: {}, step: 0, c: null,
  init() {
    this.board = new Board($('zBoard'), { onMove: (m, fen) => this.userMove(m) });
    $('zNext').onclick = () => this.open((this.i + 1) % PUZZLES.length);
    $('zRetry').onclick = () => this.open(this.i);
    $('zHint').onclick = () => { $('zFb').className = 'feedback meh'; $('zFb').textContent = 'Hint: ' + this.p.hint; };
    $('zShow').onclick = () => this.reveal();
    $('zOpen').onclick = () => { const g = GAMES.find(x => x.id === this.p.game); G.open(g, this.p.ply); };
    try { this.solved = JSON.parse(localStorage.getItem('ar-solved') || '{}'); } catch (e) { }
    const Lst = $('zList');
    PUZZLES.forEach((p, i) => { const b = el('button'); b.dataset.i = i; b.appendChild(el('span', '', (i + 1) + '. ' + p.task + ' · ' + GAMES.find(g => g.id === p.game).title)); b.appendChild(el('span', 'mono muted', p.level)); b.onclick = () => this.open(i); Lst.appendChild(b); });
  },
  enter() { this.open(this.i); },
  open(i) {
    this.i = i; const p = this.p = PUZZLES[i], g = this.g = GAMES.find(x => x.id === p.game);
    this.step = 0; this.done = false; this.c = new Chess(g.fens[p.ply]); this.you = this.c.turn();
    this.board.flipped = this.you === 'b';
    const prev = p.ply > 0 ? [g.ucis[p.ply - 1].slice(0, 2), g.ucis[p.ply - 1].slice(2, 4)] : [];
    this.board.set(this.c.fen(), prev, true);
    $('zFrom').textContent = g.title + ' · ' + g.white + ' v ' + g.black + ', ' + g.date;
    $('zTitle').textContent = (this.you === 'w' ? 'White' : 'Black') + ' to play · ' + p.task;
    $('zFb').className = 'feedback'; $('zFb').textContent = 'Find the best move. Drag or click the piece.';
    $('zAfter').hidden = true; $('zOpen').hidden = true;
    const tp = this.you === 'w' ? [g.black, 'Black'] : [g.white, 'White'], bt = this.you === 'w' ? [g.white, 'White'] : [g.black, 'Black'];
    $('zTop').innerHTML = ''; $('zTop').appendChild(el('span', '', tp[0])); $('zTop').appendChild(el('small', '', tp[1]));
    $('zBot').innerHTML = ''; $('zBot').appendChild(el('span', '', bt[0])); $('zBot').appendChild(el('small', '', bt[1]));
    this.list();
  },
  list() { document.querySelectorAll('#zList button').forEach(b => { const i = +b.dataset.i; b.classList.toggle('on', i === this.i); b.lastChild.textContent = (this.solved[PUZZLES[i].id] ? '✓ ' : '') + PUZZLES[i].level; b.lastChild.className = 'mono ' + (this.solved[PUZZLES[i].id] ? 'done' : 'muted'); }); $('zTally').textContent = Object.keys(this.solved).length + ' of ' + PUZZLES.length + ' solved'; },
  userMove(m) {
    if (this.done) return;
    const p = this.p, g = this.g, k = p.ply + this.step * 2;
    const uci = m.from + m.to; const gameUci = g.ucis[k].slice(0, 4);
    const best = g.lines[k] && g.lines[k][0] && g.lines[k][0].uci[0].slice(0, 4);
    const t = new Chess(this.c.fen()); t.move(m.san);
    const mates = t.in_checkmate();
    if (uci === gameUci || mates) {
      this.c.move(m.san); this.step++;
      if (mates || this.step >= p.moves) return this.win(uci === gameUci ? '' : 'A different mate from the game, but mate is mate.');
      const reply = g.ucis[k + 1]; const rm = this.c.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] || 'q' });
      this.board.set(this.c.fen(), [m.from, m.to], false);
      $('zFb').className = 'feedback ok'; $('zFb').textContent = `${m.san} is right. Now ${rm.san}; keep going.`;
      setTimeout(() => this.board.set(this.c.fen(), [rm.from, rm.to], true), 700);
    } else if (uci === best) {
      this.c.move(m.san); this.board.set(this.c.fen(), [m.from, m.to], false);
      this.win(`That is Stockfish's first choice, though the game went ${g.sans[k]}. Counted as solved.`);
    } else {
      this.board.set(this.c.fen(), [], true);
      $('zFb').className = 'feedback no'; $('zFb').textContent = `${m.san} is not it. Try again, or take a hint.`;
    }
  },
  win(extra) {
    this.done = true; this.solved[this.p.id] = 1; try { localStorage.setItem('ar-solved', JSON.stringify(this.solved)); } catch (e) { }
    const h = this.c.history({ verbose: true }); const l = h[h.length - 1];
    this.board.set(this.c.fen(), l ? [l.from, l.to] : [], false);
    $('zFb').className = 'feedback ok'; $('zFb').textContent = 'Solved. ' + (extra || '');
    $('zAfter').hidden = false; $('zAfter').textContent = this.p.after; $('zOpen').hidden = false; this.list();
  },
  reveal() {
    const p = this.p, g = this.g; this.done = true; this.c = new Chess(g.fens[p.ply]); const seq = [];
    for (let j = 0; j < p.moves * 2 - 1 && p.ply + j < g.sans.length; j++) { seq.push(moveNum(p.ply + j + 1) + ' ' + g.sans[p.ply + j]); }
    const end = Math.min(p.ply + p.moves * 2 - 1, g.fens.length - 1);
    this.board.set(g.fens[end], [g.ucis[end - 1].slice(0, 2), g.ucis[end - 1].slice(2, 4)], false);
    $('zFb').className = 'feedback meh'; $('zFb').textContent = 'Solution: ' + seq.join('  ');
    $('zAfter').hidden = false; $('zAfter').textContent = p.after; $('zOpen').hidden = false;
  }
};

/* ============ boot ============ */
GAMES.forEach(prepareGame);
buildHome(); G.init(); A.init(); P.init(); Z.init();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (view === 'game') G.drawGraph(); });
new MutationObserver(() => { if (view === 'game') G.drawGraph(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
show('home');
