'use strict';
/* Chai Chess intro: the board ripples in, pieces drop into place grouped by value
   (pawns first, kings last) and each landing plays a piano note: the lower the
   piece's value, the higher the note. Then the board lifts, the name appears and
   the overlay fades to reveal the page. Shown once per browser session.
   Sound: if the browser already allows it, the intro just plays with the piano.
   Otherwise the board waits with "Press any key or tap to begin", because browsers
   only allow sound after a real key press or tap. */
(function () {
  const KEY = 'chai-intro-seen';
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seen = false; try { seen = sessionStorage.getItem(KEY) === '1'; } catch (e) { }

  /* ---------- piano ---------- */
  let AC = null, master = null, soundOn = false;
  function audioInit() {
    if (AC) return AC;
    const Ctor = window.AudioContext || window.webkitAudioContext; if (!Ctor) return null;
    AC = new Ctor();
    const comp = AC.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3; comp.connect(AC.destination);
    master = AC.createGain(); master.gain.value = .55;
    // small room: a short synthetic reverb blended in
    const len = Math.floor(AC.sampleRate * 1.6), ir = AC.createBuffer(2, len, AC.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    const verb = AC.createConvolver(); verb.buffer = ir; const wet = AC.createGain(); wet.gain.value = .22;
    master.connect(comp); master.connect(verb); verb.connect(wet); wet.connect(comp);
    return AC;
  }
  // note names -> Hz
  const HZ = { C3: 130.81, G3: 196.00, C4: 261.63, E4: 329.63, G4: 392.00, C5: 523.25, E5: 659.25, G5: 783.99 };
  function piano(freq, vel = .6, when = 0) {
    if (!soundOn || !AC) return;
    const t = AC.currentTime + when;
    const out = AC.createGain(); out.gain.value = vel;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(Math.min(9000, freq * 9), t); lp.frequency.exponentialRampToValueAtTime(Math.max(600, freq * 2), t + 1.2);
    out.connect(lp); lp.connect(master);
    const decay = 2.6 - Math.log2(freq / 130) * .35;           // low notes ring longer
    [[1, 1], [2, .42], [3, .2], [4, .1], [5.02, .05]].forEach(([h, a], i) => {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'sine'; o.frequency.value = freq * h * (1 + (i ? .0008 * i : 0));
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + .004);
      g.gain.exponentialRampToValueAtTime(a * .35, t + .08 + .02 * i);
      g.gain.exponentialRampToValueAtTime(.0001, t + decay / (1 + i * .6));
      o.connect(g); g.connect(out); o.start(t); o.stop(t + decay + .1);
    });
    // soft hammer
    const nb = AC.createBuffer(1, Math.floor(AC.sampleRate * .03), AC.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
    const ns = AC.createBufferSource(), ng = AC.createGain(), nf = AC.createBiquadFilter();
    ns.buffer = nb; nf.type = 'bandpass'; nf.frequency.value = freq * 3; ng.gain.value = .06;
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t);
  }
  // value -> note: the more valuable the piece, the lower the note (a C major chord)
  const NOTE = { p: 'E5', n: 'C5', b: 'C5', r: 'G4', q: 'C4', k: 'C3' };

  /* ---------- choreography ---------- */
  const START = ['rnbqkbnr', 'pppppppp', '', '', '', '', 'PPPPPPPP', 'RNBQKBNR'];
  const DROP = .5, CONTACT = DROP / 2.75;   // first contact of the bounce curve
  const drops = (() => {
    const all = []; START.forEach((row, r) => [...row].forEach((c, f) => all.push({ c, r, f, t: c.toLowerCase() })));
    const pick = t => all.filter(p => p.t === t);
    const pawns = pick('p').sort((a, b) => a.f - b.f || b.r - a.r);            // a2, a7, b2, b7 ...
    const minor = [...pick('n'), ...pick('b')].sort((a, b) => a.f - b.f);
    const out = []; let t = .8;
    pawns.forEach(p => { out.push({ ...p, t0: t }); t += .055; });
    t += .12; minor.forEach(p => { out.push({ ...p, t0: t }); t += .09; });
    t += .1; pick('r').forEach(p => { out.push({ ...p, t0: t }); t += .12; });
    t += .08; pick('q').forEach(p => { out.push({ ...p, t0: t }); t += .16; });
    t += .12; pick('k').forEach(p => out.push({ ...p, t0: t }));              // both kings together: the final chord
    return out;
  })();
  const LAND_END = drops[drops.length - 1].t0 + DROP;             // ~3.9s
  const LIFT = [LAND_END + .15, LAND_END + .85], WORD = [LAND_END + .35, LAND_END + 1.05], FADE = [LAND_END + 1.75, LAND_END + 2.5];

  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const easeOut = x => 1 - Math.pow(1 - x, 3);
  const easeInOut = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const bounce = x => { const n = 7.5625, d = 2.75; if (x < 1 / d) return n * x * x; if (x < 2 / d) return n * (x -= 1.5 / d) * x + .75; if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + .9375; return n * (x -= 2.625 / d) * x + .984375; };

  // Can this page make sound right now, without a click? (Chrome allows it on sites the
  // visitor has used before; Safari and Firefox usually don't.)
  function probeSound() {
    const a = audioInit(); if (!a) return Promise.resolve(false);
    if (a.state === 'running') return Promise.resolve(true);
    return Promise.race([a.resume().then(() => a.state === 'running', () => false), new Promise(r => setTimeout(() => r(false), 250))]);
  }
  function unlockFromGesture() {             // must be called inside a real click / key press
    const a = audioInit(); if (!a) return;
    try { a.resume(); const b = a.createBuffer(1, 1, 22050), s = a.createBufferSource(); s.buffer = b; s.connect(a.destination); s.start(0); } catch (e) { }
  }

  function run() {
    const ov = document.createElement('div'); ov.id = 'chai-intro';
    ov.innerHTML = '<canvas aria-hidden="true"></canvas><p class="ci-gate" hidden>Press any key or tap to begin <span>♪</span></p><div class="ci-ctrl"><button type="button" class="ci-sound" hidden>♪ Mute</button><button type="button" class="ci-skip">Skip intro</button></div>';
    const st = document.createElement('style');
    st.textContent = `#chai-intro{position:fixed;inset:0;z-index:1000;background:#151B1F;transition:opacity .75s ease;cursor:default}
#chai-intro.gated{cursor:pointer}
#chai-intro canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#chai-intro .ci-gate{position:absolute;left:0;right:0;margin:0;text-align:center;font:500 15px "IBM Plex Mono",ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#E4E9EB;animation:ciPulse 1.8s ease-in-out infinite}
#chai-intro .ci-gate span{color:#E0A845}
@keyframes ciPulse{0%,100%{opacity:.45}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){#chai-intro .ci-gate{animation:none}}
#chai-intro .ci-ctrl{position:absolute;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));display:flex;gap:8px}
#chai-intro button{font:500 13px "IBM Plex Mono",ui-monospace,Menlo,monospace;letter-spacing:.04em;color:#E4E9EB;background:rgba(255,255,255,.06);border:1px solid rgba(228,233,235,.25);border-radius:4px;padding:8px 12px;cursor:pointer}
#chai-intro button:hover{border-color:#E4E9EB}
#chai-intro button:focus-visible{outline:2px solid #E0A845;outline-offset:2px}`;
    document.head.appendChild(st); document.body.appendChild(ov);
    document.documentElement.classList.remove('intro-pending');
    const cv = ov.querySelector('canvas'), ctx = cv.getContext('2d', { alpha: false }), gateEl = ov.querySelector('.ci-gate'), sb = ov.querySelector('.ci-sound');
    let Wc = 0, Hc = 0, dpr = 1, bgGrad = null;
    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2); Wc = ov.clientWidth; Hc = ov.clientHeight; cv.width = Math.round(Wc * dpr); cv.height = Math.round(Hc * dpr);
      bgGrad = ctx.createRadialGradient(Wc / 2, Hc / 2, 50, Wc / 2, Hc / 2, Math.max(Wc, Hc) * .75); bgGrad.addColorStop(0, '#1F292E'); bgGrad.addColorStop(1, '#12171A');
    };
    size(); window.addEventListener('resize', size);
    const img = {}; for (const k in PIECES) { const i = new Image(); i.src = PIECES[k]; img[k] = i; }

    // phase: 'probe' (deciding), 'gate' (board shown, waiting for a press), 'play'
    let phase = 'probe', t0 = null, offset = 0, played = new Set(), done = false, raf = 0;
    const HOLD = .75;                        // gate freezes the clock here: board in, no pieces yet
    const cleanup = [];
    const finish = () => {
      if (done) return; done = true; cancelAnimationFrame(raf); ov.style.opacity = '0';
      try { sessionStorage.setItem(KEY, '1'); } catch (e) { }
      cleanup.forEach(f => f());
      setTimeout(() => { ov.remove(); st.remove(); window.removeEventListener('resize', size); }, 800);
    };
    const showMute = () => { sb.hidden = false; sb.textContent = soundOn ? '♪ Mute' : '♪ Sound on'; };
    ov.querySelector('.ci-skip').onclick = e => { e.stopPropagation(); finish(); };
    sb.onclick = e => { e.stopPropagation(); if (!soundOn) unlockFromGesture(); soundOn = !soundOn; showMute(); };

    const begin = () => {                    // start (or continue) the pieces with sound
      if (phase !== 'gate' || done) return;
      phase = 'starting'; unlockFromGesture(); soundOn = true;
      ov.classList.remove('gated'); gateEl.hidden = true; showMute();
      const a = AC, ready = a && a.state !== 'running' ? Promise.race([a.resume().catch(() => { }), new Promise(r => setTimeout(r, 400))]) : Promise.resolve();
      ready.then(() => { if (done) return; phase = 'play'; t0 = null; offset = HOLD; });   // carry on from the frozen board once audio is live
    };
    const onKey = e => {
      if (e.key === 'Escape') { finish(); return; }
      if (phase !== 'gate' || e.key === 'Tab' || e.target.tagName === 'BUTTON' || e.repeat) return;
      e.preventDefault(); begin();
    };
    const onPointer = e => { if (phase === 'gate' && !(e.target.closest && e.target.closest('button'))) begin(); };
    document.addEventListener('keydown', onKey); ov.addEventListener('pointerdown', onPointer);
    cleanup.push(() => document.removeEventListener('keydown', onKey));

    function wordmark(alpha, cx, y, size, tagAlpha) {
      if (alpha <= 0) return;
      ctx.save(); ctx.globalAlpha = alpha; ctx.textBaseline = 'alphabetic';
      ctx.font = `800 ${size}px "Big Shoulders Display","Arial Narrow",sans-serif`;
      const a = 'CHAI ', b = 'CHESS', wa = ctx.measureText(a).width, wb = ctx.measureText(b).width, x0 = cx - (wa + wb) / 2;
      ctx.fillStyle = '#F2F4F3'; ctx.fillText(a, x0, y); ctx.fillStyle = '#E0A845'; ctx.fillText(b, x0 + wa, y);
      ctx.globalAlpha = tagAlpha; ctx.textAlign = 'center'; ctx.fillStyle = '#A9B6BD';
      ctx.font = `400 ${Math.max(11, Math.round(size * .17))}px "IBM Plex Mono",ui-monospace,monospace`;
      ctx.fillText('FAMOUS GAMES · ANALYSIS · PUZZLES · PLAY', cx, y + size * .42);
      ctx.restore();
    }

    function frame(now) {
      if (t0 == null) t0 = now;
      let t = offset + (now - t0) / 1000;
      if (phase !== 'play') t = Math.min(t, HOLD);
      if (phase === 'starting') t = HOLD;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, Wc, Hc);

      const lift = easeInOut(seg(t, ...LIFT));
      const S0 = Math.min(Wc * .86, Hc * .66), S = S0 * (1 - .34 * lift);
      const x = (Wc - S) / 2, y = (Hc - S0) / 2 - lift * Hc * .07, q = S / 8;
      if (phase === 'gate' || phase === 'probe') gateEl.style.top = Math.round(y + S0 + Math.min(40, Hc * .05)) + 'px';
      const shA = seg(t, .5, 1.0);
      if (shA > 0) { ctx.save(); ctx.shadowColor = `rgba(0,0,0,${.55 * shA})`; ctx.shadowBlur = S * .08; ctx.shadowOffsetY = S * .03; ctx.fillStyle = '#7B93A2'; ctx.fillRect(x + 1, y + 1, S - 2, S - 2); ctx.restore(); }
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const d = (f + (7 - r)) * .025, a = easeOut(seg(t, .05 + d, .3 + d)); if (a <= 0) continue;
        ctx.globalAlpha = a; ctx.fillStyle = (r + f) % 2 ? '#7B93A2' : '#DCE3E6';
        const sc = .6 + .4 * a, cx = x + f * q + q / 2, cy = y + r * q + q / 2;
        ctx.fillRect(cx - q * sc / 2, cy - q * sc / 2, q * sc + .6, q * sc + .6);
      }
      ctx.globalAlpha = 1;
      drops.forEach((p, i) => {
        const u = seg(t, p.t0, p.t0 + DROP); if (u <= 0) return;
        if (t >= p.t0 + CONTACT && !played.has(i)) {
          played.add(i);
          if (p.t === 'k') { if (p.c === 'K') { piano(HZ.C3, .55); piano(HZ.G3, .35); piano(HZ.C4, .3); piano(HZ.E4, .2); } }
          else piano(HZ[NOTE[p.t]], p.t === 'p' ? .32 : .45);
        }
        const yy = y + p.r * q - (1 - bounce(u)) * q * .7;
        ctx.globalAlpha = clamp(u * 4); ctx.drawImage(img[p.c], x + p.f * q + q * .04, yy + q * .04, q * .92, q * .92);
      });
      ctx.globalAlpha = 1;
      const wm = easeOut(seg(t, ...WORD)), wsize = Math.min(Wc * .13, Hc * .12, 150);
      wordmark(wm, Wc / 2, y + S + wsize * 1.05 - (1 - wm) * 20, wsize, easeOut(seg(t, WORD[0] + .3, WORD[1] + .3)));
      if (t >= FADE[0]) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }
    // Get everything ready first (fonts, decoded piece images, sound check) so the
    // animation runs smoothly from its first frame; the overlay stays plain dark meanwhile.
    const within = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
    const fonts = document.fonts && document.fonts.load ? within(Promise.all([document.fonts.load('800 100px "Big Shoulders Display"'), document.fonts.load('500 15px "IBM Plex Mono"')]), 1500).catch(() => { }) : Promise.resolve();
    const decoded = within(Promise.all(Object.values(img).map(i => (i.decode ? i.decode() : Promise.resolve()).catch(() => { }))), 1500);
    Promise.all([probeSound(), fonts, decoded]).then(([ok]) => {
      if (done) return;
      if (ok) { soundOn = true; phase = 'play'; showMute(); }
      else { phase = 'gate'; ov.classList.add('gated'); gateEl.hidden = false; }
      t0 = null; raf = requestAnimationFrame(frame);
    });
  }

  const reveal = () => document.documentElement.classList.remove('intro-pending');
  window.chaiIntro = () => { try { sessionStorage.removeItem(KEY); } catch (e) { } run(); };
  if (!seen && !reduce && typeof PIECES !== 'undefined') {
    // Start once the page's own start-up work is done (this script runs last), giving the
    // browser a couple of frames to settle so the two don't compete.
    const go = () => requestAnimationFrame(() => requestAnimationFrame(() => run()));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true }); else go();
    setTimeout(reveal, 10000);             // safety net: never leave the page hidden
  } else reveal();
})();
