// Голубь Аркадий — персонаж сайта (только по ссылке, через Extra). Отдел «Персонаж», исходники — дизайн/аркадий/.
// Вход: start({ host, events, soundMode, reduced }) → { stop(), stats() }.
//   host      — куда положить свой слой (по умолчанию document.body); в DOM страницы больше ничего не трогаем;
//   events    — window.SverkaEvents: on(имя, fn) → отписка; rects() → { avoid, targets }; sound() → { mode, muted };
//   soundMode — начальный режим звука ('on' | 'night' | 'off'), дальше — sound() и событие soundMode;
//   reduced   — «уменьшить движение»: спокойная поза, без анимации.
// Правила (ОТДЕЛЫ.md): слой с атрибутом data-arkadiy и pointer-events: none — щелчки проходят к странице; вкладка в
// фоне — 0 кадров (и часы поведения стоят); без звука до первого действия Паши и при sound().muted; любая ошибка —
// голубь тихо исчезает. Для проверок — window.SverkaArkadiy = { states, state(), go(имя) }.
const BASE = new URL('./', import.meta.url).href;
const V = new URL(import.meta.url).search;              // метка версии (?v=…) — на все свои файлы, мимо старого кэша
const LIGHT = 1.6, ENV = 0.85;                          // свет — подобран по сравнению с отрисовкой в Blender
const FPS = 30;                                         // движения сняты по 30 кадров в секунду
const WALK_FPS = 36, WALK_U = 0.165 / 14 * WALK_FPS;    // ходьба: шаг 0,165 ед. сцены за 14 кадров — ноги не скользят
const DEG = Math.PI / 180;
const YAW_LEFT = 0, YAW_FACE = 55 * DEG, YAW_RIGHT = 110 * DEG;   // смотрит влево / на вас / вправо
const PECK = { bend: [0, 8], peck: [8, 16], hit: 12, up: [16, 39] };   // кадры клевка: наклон, удар (повтор), выпрямиться
const STATES = ['idle', 'walk', 'look', 'peck', 'eat', 'coo', 'hop', 'shake', 'knock', 'sleep'];
const SOUNDS = { coo: ['coo-1', 'coo-2', 'coo-3'], flap: ['flap'], knock: ['tap-1', 'tap-2', 'tap-3'], peck: ['peck-1', 'peck-2'], snore: ['snore'] };
const VOL = { coo: .35, flap: .3, knock: .55, peck: .3, snore: .22 };

export async function start(opts = {}) {
  const host = opts.host || document.body;
  const events = opts.events || window.SverkaEvents || null;
  const MQ = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = opts.reduced ?? MQ.matches;               // может смениться на лету — см. ниже
  let alive = true, raf = 0, layer = null, renderer = null, THREE = null;
  const offs = [];
  const st = { frames: 0, ms: 0, maxMs: 0, loadMs: 0, errors: 0, dozes: 0 };

  function stop() {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf);
    offs.forEach(f => { try { f(); } catch (e) { /* ничего */ } });
    try { renderer && renderer.dispose(); renderer && renderer.forceContextLoss(); } catch (e) { /* ничего */ }
    try { layer && layer.remove(); } catch (e) { /* ничего */ }
    try { if (window.SverkaArkadiy && window.SverkaArkadiy.__own === stop) delete window.SverkaArkadiy; } catch (e) { /* ничего */ }
  }
  const fail = e => { st.errors++; try { console.warn('Аркадий: сбой, голубь скрыт —', e); } catch (x) { /* ничего */ } stop(); };
  const on = (target, type, fn, o) => { target.addEventListener(type, fn, o); offs.push(() => target.removeEventListener(type, fn, o)); };

  try {
    const t0 = performance.now();
    THREE = await import('./three.min.js' + V);
    if (!alive) return { stop, stats: () => st };

    // ---------- свой слой ----------
    layer = document.createElement('div');
    layer.setAttribute('data-arkadiy', '');
    layer.setAttribute('aria-hidden', 'true');
    // корень нулевого размера в левом верхнем углу: всё своё — внутри (absolute от него), страницу собой не накрывает;
    // z 38 — над шапкой (30), под окнами (39–40): открыли окно — голубь под затемнением, как всё остальное
    layer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:visible;z-index:38;pointer-events:none';
    const shadow = document.createElement('div');
    shadow.style.cssText = 'position:absolute;left:0;top:0;border-radius:50%;pointer-events:none;' +
      'background:radial-gradient(closest-side,rgba(0,0,0,.42),rgba(0,0,0,.14) 60%,transparent);will-change:transform';
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;will-change:transform';
    layer.append(shadow, cv);

    // ---------- 3D ----------
    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const bl = (x, y, z) => new THREE.Vector3(x, z, -y);       // координаты Blender → glTF
    for (const [p, e, c] of [[bl(-1.4, -2.6, 2.9), 3.2, 0xffe6c7], [bl(2.4, -1.4, 1.2), 0.9, 0xb3ebff], [bl(0.8, 2.6, 2.2), 3.0, 0xb3ebff]]) {
      const l = new THREE.DirectionalLight(c, e * LIGHT); l.position.copy(p); scene.add(l);
    }
    scene.add(new THREE.HemisphereLight(0x8fc1c6, 0x1a3a3f, 0.45 * ENV * 2));
    const az = 55 * DEG, el = 10 * DEG;                        // камера как у отрисовок: орто 2,0 ед., азимут 55°, наклон 10°
    const dir = bl(Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el));
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    const tgt = bl(0, 0, 0.82);
    cam.position.copy(tgt).addScaledVector(dir, 6); cam.lookAt(tgt); cam.updateMatrixWorld();
    const feet = new THREE.Vector3(0, 0, 0).project(cam);
    const AX = (feet.x + 1) / 2, AY = (1 - feet.y) / 2;        // где в кадре точка между лап

    const loader = new THREE.GLTFLoader();
    const draco = new THREE.DRACOLoader().setDecoderPath(BASE + 'draco/');
    loader.setDRACOLoader(draco);
    const gltf = await loader.loadAsync(BASE + 'arkadiy.glb' + V);
    draco.dispose();
    if (!alive) return { stop, stats: () => st };
    const root = new THREE.Group(); root.add(gltf.scene); scene.add(root);
    // клюв: точка — середина самого клюва (у объекта клюва начало координат лежит у земли)
    let beakObj = null; gltf.scene.traverse(o => { if (!beakObj && o.isMesh && /^Beak/.test(o.name)) beakObj = o; });
    const beakLocal = new THREE.Vector3();
    if (beakObj) { beakObj.geometry.computeBoundingBox(); beakObj.geometry.boundingBox.getCenter(beakLocal); }
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const ACT = {};
    for (const clip of gltf.animations) {
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity); a.enabled = true; a.setEffectiveWeight(0); a.play(); a.paused = true;
      ACT[clip.name] = { a, frames: Math.round(clip.duration * FPS) + 1 };
    }
    for (const n of ['idle', 'walk', 'peck', 'look', 'nibble', 'coo', 'hop', 'shake', 'knock', 'sleep', 'stretch'])
      if (!ACT[n]) throw new Error('в модели нет движения ' + n);
    st.loadMs = Math.round(performance.now() - t0);
    host.appendChild(layer);

    // ---------- проигрыватель: кусок движения по кадрам + плавный переход ----------
    // Своё управление временем (а не play/stop смесителя): можно сыграть один удар клювом и стыковать куски.
    const P = { name: 'idle', f: 0, a: 0, b: 179, fps: FPS, loop: true, done: null, ev: {}, fired: new Set() };
    const fade = [];                                           // уходящие движения: { name, f, w, k }
    function play(name, a = 0, b = ACT[name].frames - 1, o = {}) {
      if (P.done) { const d = P.done; P.done = null; d(false); }
      if (o.blend !== false && (name !== P.name || Math.abs(P.f - a) > 1.5)) fade.push({ name: P.name, f: P.f, w: 1, k: 1 / (o.blendS || .2) });
      Object.assign(P, { name, f: a, a, b, fps: o.fps || FPS, loop: !!o.loop, ev: o.ev || {}, fired: new Set(), since: clock });
      wake();
      return new Promise(r => { P.done = r; });
    }
    function stepPlayer(dt) {
      const d = P.b >= P.a ? 1 : -1;
      P.f += d * dt * P.fps;
      for (const k in P.ev) if (!P.fired.has(k) && (d > 0 ? P.f >= +k : P.f <= +k)) { P.fired.add(k); try { P.ev[k](); } catch (e) { /* реакция — не причина падать */ } }
      if (d > 0 ? P.f > P.b : P.f < P.b) {
        if (P.loop) { const len = Math.abs(P.b - P.a) || 1; P.f = P.a + d * (Math.abs(P.f - P.a) % len); P.fired.clear(); }
        else { P.f = P.b; if (P.done) { const r = P.done; P.done = null; r(true); } }
      }
      for (const n in ACT) ACT[n].a.setEffectiveWeight(0);
      let rest = 1;
      for (let i = fade.length - 1; i >= 0; i--) {
        const x = fade[i]; x.w -= dt * x.k;
        if (x.w <= 0 || x.name === P.name) { fade.splice(i, 1); continue; }
        const w = Math.min(rest, x.w); rest -= w;
        ACT[x.name].a.time = x.f / FPS; ACT[x.name].a.setEffectiveWeight(w);
      }
      ACT[P.name].a.time = Math.max(0, P.f) / FPS; ACT[P.name].a.setEffectiveWeight(Math.max(.001, rest));
      mixer.update(0);
    }

    // ---------- размер и место ----------
    let S = 0, px = 0, clock = 0;                              // clock — часы голубя: идут только в кадрах (в фоне стоят)
    function fit() {
      const w = innerWidth;
      S = w < 380 ? 0 : w < 640 ? 170 : 250;                    // на телефоне меньше, на совсем узком — прячется
      px = S / 2.0;
      layer.style.display = S ? '' : 'none';
      if (!S) return;
      renderer.setPixelRatio(Math.min(lite ? 1.5 : 2, devicePixelRatio || 1));
      renderer.setSize(S, S, false);
      cv.style.width = cv.style.height = S + 'px';
    }
    // Где стоять: «опора» — низ окна или верхняя кромка карточки (как голубь на подоконнике); тело не задевает rects().avoid.
    let RECTS = [], rectsAt = -1e9;
    function refreshRects() {
      try { RECTS = ((events && events.rects && events.rects().avoid) || []).map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })); }
      catch (e) { RECTS = []; }
      rectsAt = clock;
    }
    const hits = (b, r) => !(b.right < r.left || b.left > r.right || b.bottom < r.top || b.top > r.bottom);
    const bodyBox = (x, y) => ({ left: x - S * .3, right: x + S * .3, top: y - S * .64, bottom: y - 6 });
    function surfaces() {
      const list = [{ y: innerHeight - 6, l: 0, r: innerWidth }];
      for (const r of RECTS) if (r.top > S * .7 + 8 && r.top < innerHeight - 8 && r.right - r.left > S * .8) list.push({ y: r.top + 1, l: r.left, r: r.right });
      return list;
    }
    const onSurf = (x, g) => x > Math.max(g.l, 0) + S * .32 && x < Math.min(g.r, innerWidth) - S * .32;
    const free = (x, g) => !!g && onSurf(x, g) && !RECTS.some(r => hits(bodyBox(x, g.y), r));
    function spot(prefX, prefY) {
      let best = null, bd = 1e9;
      for (const g of surfaces()) for (let d = 0; d < innerWidth; d += 14) {
        for (const x of [prefX + d, prefX - d]) {
          if (!free(x, g)) continue;
          const cost = d + Math.abs(g.y - prefY) * 1.5 + (g.y < innerHeight - 10 ? 40 : 0);
          if (cost < bd) { bd = cost; best = { x, g }; }
          break;
        }
        if (best && best.g === g) break;
      }
      return best;
    }

    // ---------- положение на экране ----------
    const B = { x: innerWidth - Math.max(160, innerWidth * .12), g: null, side: YAW_LEFT, yaw: YAW_LEFT, yawTo: YAW_LEFT, shown: false, reseat: 0, walk: null };
    function show(v) { if (B.shown === v) return; B.shown = v; cv.style.transition = shadow.style.transition = 'opacity .35s'; cv.style.opacity = shadow.style.opacity = v ? 1 : 0; }
    function place() {
      if (!S) return;
      const gy = B.g ? B.g.y : innerHeight - 6;
      cv.style.transform = `translate3d(${B.x - AX * S}px,${gy - AY * S}px,0)`;
      const sw = S * .5, sh = S * .08;
      shadow.style.width = sw + 'px'; shadow.style.height = sh + 'px';
      shadow.style.transform = `translate3d(${B.x - sw / 2}px,${gy - sh / 2}px,0)`;
    }
    const tmp = new THREE.Vector3();
    function beak() {                                          // кончик клюва на экране
      const gy = B.g ? B.g.y : innerHeight - 6;
      if (!beakObj) return { x: B.x, y: gy - S * .6 };
      tmp.copy(beakLocal).applyMatrix4(beakObj.matrixWorld); tmp.project(cam);
      return { x: B.x - AX * S + (tmp.x + 1) / 2 * S, y: gy - AY * S + (1 - tmp.y) / 2 * S };
    }

    // ---------- ожидания по часам голубя (в фоне не идут) ----------
    const timers = [];
    const wait = ms => new Promise(r => { timers.push({ at: nowClock() + ms, r }); armDoze(); });
    function tickTimers() { for (let i = timers.length - 1; i >= 0; i--) if (clock >= timers[i].at) { const t = timers[i]; timers.splice(i, 1); t.r(); } }

    // ---------- сон в покое (правило дизайна С3): в кадре ничего не меняется — кадры не рисуются ----------
    // Стоит и дышит — не дольше 10 с (в лёгком режиме и после 15 с без действий — 1,5 с), потом замирает. Пока «дремлет», часы голубя идут по
    // настоящему времени, а ближайшее ожидание будит его таймером; новое движение (play) будит сразу.
    const isLite = () => { try { return !!(window.SverkaFx && window.SverkaFx.lite) || document.documentElement.classList.contains('fx-lite'); } catch (e) { return false; } };
    let lite = isLite(), doze = null, poked = 0;               // doze: { at — с какого момента дремлет (null — в фоне), t — таймер }
    const REST = () => lite || nowClock() - poked > 15000 ? 1500 : 10000;   // давно не трогали — замирает быстрее
    const nowClock = () => clock + (doze && doze.at != null ? performance.now() - doze.at : 0);
    function armDoze() {
      if (!doze || doze.at == null) return;
      clearTimeout(doze.t);
      const c = nowClock(); let next = 60000;
      for (const t of timers) next = Math.min(next, t.at - c);
      if (!B.shown && B.reseat > c) next = Math.min(next, B.reseat - c);
      doze.t = setTimeout(wake, Math.max(0, next) + 4);
    }
    function wake() {
      if (!doze) return;
      clearTimeout(doze.t);
      clock = nowClock(); doze = null;
      resume();
    }
    function restful() {                                       // следующий кадр был бы таким же — можно не рисовать
      if (!S || scrolling) return true;
      if (!B.shown) return clock < B.reseat;                   // ждёт пересадки — проснётся к сроку
      if (B.walk || fade.length || snoreEl || Math.abs(B.yawTo - B.yaw) > .01 || !free(B.x, B.g)) return false;
      return P.loop ? P.name === 'idle' && clock - P.since > REST() : P.f === P.b;
    }
    offs.push(() => { if (doze) clearTimeout(doze.t); });

    // ---------- звук: только после первого действия Паши и если страница не велит молчать ----------
    let acted = false, AC = null, sndLoading = null; const BUF = {};
    on(window, 'pointerdown', () => { acted = true; poked = nowClock(); }, { passive: true, capture: true });
    on(window, 'keydown', () => { acted = true; poked = nowClock(); }, { passive: true, capture: true });
    let modeNow = opts.soundMode || 'night';
    const muted = () => {
      try { if (events && events.sound) return !!events.sound().muted; } catch (e) { /* ниже — по режиму */ }
      const h = new Date().getHours(); return modeNow === 'off' || (modeNow === 'night' && (h >= 22 || h < 7));
    };
    function sfx(kind) {
      if (!acted || muted() || document.hidden || !B.shown || !SOUNDS[kind]) return;   // спрятан — молчит
      try {
        if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
        if (!sndLoading) sndLoading = Promise.all([...new Set(Object.values(SOUNDS).flat())].map(n =>
          fetch(BASE + 'sounds/' + n + '.mp3' + V).then(r => r.arrayBuffer()).then(b => AC.decodeAudioData(b)).then(d => { BUF[n] = d; }).catch(() => {})));
        const list = SOUNDS[kind], buf = BUF[list[Math.random() * list.length | 0]];
        if (!buf) return;                                      // первый раз — только загрузка, звук со следующего
        if (AC.state === 'suspended') AC.resume();
        const s = AC.createBufferSource(), g = AC.createGain();
        s.buffer = buf; s.playbackRate.value = .95 + Math.random() * .1; g.gain.value = VOL[kind];
        s.connect(g); g.connect(AC.destination); s.start();
      } catch (e) { /* без звука — не беда */ }
    }

    // ---------- мелочи на своём слое: следы на стекле, пузырь храпа ----------
    function glassMark(x, y, n) {
      if (!B.shown) return;                                    // спрятан — следов нет
      const m = document.createElement('div'), R = 26 + n * 8;
      m.style.cssText = `position:absolute;left:${x - R}px;top:${y - R}px;width:${R * 2}px;height:${R * 2}px;border-radius:50%;pointer-events:none;` +
        'background:radial-gradient(circle at 46% 44%,rgba(255,255,255,.75) 0 2px,transparent 3px),' +
        'radial-gradient(closest-side,rgba(225,236,248,.24),rgba(225,236,248,.08) 60%,transparent)';
      layer.appendChild(m);
      if (n >= 3) {                                            // третий удар — тонкие трещинки
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', R * 2); svg.setAttribute('height', R * 2); svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
        let d = '';
        for (let i = 0; i < 6; i++) { let a = i / 6 * Math.PI * 2 + Math.random() * .5, cx = R, cy = R; d += `M${cx} ${cy}`; for (let k = 0; k < 4; k++) { a += (Math.random() - .5) * .7; cx += Math.cos(a) * R * .22; cy += Math.sin(a) * R * .22; d += ` L${cx.toFixed(1)} ${cy.toFixed(1)}`; } }
        svg.innerHTML = `<path d="${d}" fill="none" stroke="rgba(10,14,20,.45)" stroke-width="1"/><path d="${d}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".6" transform="translate(.8 .8)"/>`;
        m.appendChild(svg);
      }
      m.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)', offset: .04 }, { opacity: 1, offset: .55 }, { opacity: 0, transform: 'scale(1.15)' }],
        { duration: 8000, easing: 'ease-out', fill: 'forwards' }).onfinish = () => m.remove();
    }
    let snoreEl = null, snoreHalf = -1;
    function snore(v) {
      if (v && !snoreEl && B.shown) {
        snoreEl = document.createElement('div');
        snoreEl.style.cssText = 'position:absolute;left:0;top:0;border-radius:50%;pointer-events:none;will-change:transform;' +
          'background:radial-gradient(circle at 32% 28%,rgba(255,255,255,.95) 0 5%,rgba(255,255,255,0) 13%),' +
          'radial-gradient(circle at 50% 50%,rgba(180,230,255,.05) 0 52%,rgba(140,210,255,.18) 70%,rgba(255,150,230,.30) 86%,rgba(255,255,255,.55) 100%);' +
          'box-shadow:inset 0 0 6px rgba(255,255,255,.35)';
        layer.appendChild(snoreEl);
      } else if (!v && snoreEl) {
        const e = snoreEl; snoreEl = null;
        e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).onfinish = () => e.remove();
      }
    }
    function snoreStep() {
      if (snoreEl && !B.shown) snore(false);
      if (!snoreEl) { if (B.shown && asleep && snoring && P.name === 'sleep' && P.f >= 30) snore(true); return; }
      const ph = P.name === 'sleep' && P.f >= 30 ? ((P.f - 30) / 40) % 1 : 0;
      const R = (5 + (.5 - .5 * Math.cos(ph * Math.PI * 2)) * 18) * S / 250, b = beak();
      snoreEl.style.width = snoreEl.style.height = R * 2 + 'px';
      snoreEl.style.transform = `translate3d(${b.x - R * 1.7}px,${b.y - R * 1.2}px,0)`;
      const half = ph < .5 ? 0 : 1;
      if (half !== snoreHalf) { snoreHalf = half; if (!half && P.name === 'sleep' && P.f >= 30) sfx('snore'); }
    }

    // ---------- поведение: сцены (одна за раз; новая прерывает старую) ----------
    let gen = 0, now_ = 'idle', asleep = false, snoring = false, rouseR = null;
    const nap = ms => Promise.race([wait(ms), new Promise(r => { rouseR = r; })]);   // спит, пока не разбудят или не выйдет срок
    function rouse() { asleep = false; if (rouseR) { const r = rouseR; rouseR = null; r(); } }
    const busy = my => my !== gen;
    const setState = s => { now_ = s; };
    async function turnTo(yaw, my) {                           // разворот на месте — через взгляд на вас
      B.yawTo = yaw;
      if (Math.abs(B.yaw - yaw) < .02) return true;
      wake();
      await wait(Math.abs(B.yaw - yaw) / 4.2 * 1000 + 60);
      return !busy(my);
    }
    async function walkTo(x, my) {
      if (Math.abs(x - B.x) < 8) return true;
      B.side = x > B.x ? YAW_RIGHT : YAW_LEFT;               // боком — в сторону, куда идёт
      if (!await turnTo(B.side, my)) return false;
      setState('walk');
      play('walk', 0, ACT.walk.frames - 1, { loop: true, fps: WALK_FPS });
      const ok = await new Promise(r => { B.walk = { x, r }; });
      return ok && !busy(my);
    }
    async function idleFor(ms, my) {
      setState('idle');
      if (P.name !== 'idle' || !P.loop) play('idle', 0, ACT.idle.frames - 1, { loop: true });
      await wait(ms);
      return !busy(my);
    }
    async function pecks(n, my) {
      setState('peck'); B.yawTo = B.side;
      if (!await play('peck', PECK.bend[0], PECK.bend[1]) || busy(my)) return false;
      for (let i = 0; i < n; i++) if (!await play('peck', PECK.peck[0], PECK.peck[1], { blend: false, ev: { [PECK.hit]: () => sfx('peck') } }) || busy(my)) return false;
      return await play('peck', PECK.up[0], PECK.up[1], { blend: false }) && !busy(my);
    }
    async function once(name, s, ev) { setState(s); B.yawTo = B.side; return play(name, 0, ACT[name].frames - 1, { ev }); }
    const SCENES = {
      idle: my => idleFor(3000 + Math.random() * 5000, my),
      walk: async my => {                                      // по своей опоре, пока путь свободен
        if (!B.g) return idleFor(1500, my);
        const span = 90 + Math.random() * 230, sgn = Math.random() < .5 ? -1 : 1; let to = null;
        for (let x = B.x; Math.abs(x - B.x) < span; x += sgn * 6) { if (!free(x + sgn * 6, B.g)) break; to = x + sgn * 6; }
        if (to == null || Math.abs(to - B.x) < 30) return idleFor(1500, my);
        return walkTo(to, my);
      },
      look: async my => {                                      // повернулся и смотрит на вас, потом обратно
        const back = B.side;
        if (!await turnTo(YAW_FACE, my)) return;
        setState('look'); await play('look', 0, ACT.look.frames - 1);
        if (busy(my)) return; await wait(1200);
        if (busy(my)) return; await play('look', ACT.look.frames - 1, 0, { blend: false, fps: 40 });
        if (!busy(my)) await turnTo(back, my);
      },
      peck: my => pecks(1 + (Math.random() * 3 | 0), my),
      eat: () => once('nibble', 'eat', { 16: () => sfx('peck'), 26: () => sfx('peck') }),
      coo: () => once('coo', 'coo', { 18: () => sfx('coo'), 62: () => sfx('coo') }),
      hop: () => once('hop', 'hop', { 8: () => sfx('flap') }),
      shake: () => once('shake', 'shake'),
      knock: async my => {                                     // повернулся к вам и стучит клювом в «стекло»
        const back = B.side;
        if (!await turnTo(YAW_FACE, my)) return;
        let n = 0; const hit = () => { const b = beak(); glassMark(b.x, b.y + 4, ++n); sfx('knock'); };
        setState('knock');
        await play('knock', 0, ACT.knock.frames - 1, { ev: { 16: hit, 27: hit, 38: hit } });
        if (!busy(my)) await turnTo(back, my);
      },
      sleep: async my => {                                     // засыпает; просыпается от действия Паши
        asleep = true; setState('sleep');
        if (!await play('sleep', 0, 30, { fps: 18 }) || busy(my)) { asleep = false; snore(false); return; }
        let first = true;
        while (asleep && !busy(my)) {                          // храпит сериями, между ними спит тихо — кадры не рисуются
          snoring = true; play('sleep', 30, ACT.sleep.frames - 1, { loop: true, fps: 16 });
          await nap(first ? (lite ? 4000 : 10000) : 5000); first = false;
          snoring = false; snore(false);
          if (!asleep || busy(my)) break;
          play('sleep', 30, 30, { fps: 16 });
          await nap((lite ? 90000 : 45000) + Math.random() * 45000);
        }
        snoring = false; snore(false);
        if (busy(my)) { asleep = false; return; }
        await play('sleep', 30, 0, { fps: 30 });
        if (!busy(my)) await once('stretch', 'sleep');          // проснулся — потянулся: крыло и лапа назад
      },
    };
    async function run(name, my) { try { await SCENES[name](my); } catch (e) { fail(e); } }
    function calm() { rouse(); snoring = false; snore(false); if (B.walk) { B.walk.r(false); B.walk = null; } B.yawTo = B.side; }   // прервали — снова боком
    function interrupt(name) {                                 // прервать текущее, сыграть сцену, потом — обычная жизнь
      const my = ++gen; calm();
      return run(name, my).then(() => { if (my === gen && alive) life(); });
    }
    async function life() {                                    // обычная жизнь: стоит, ходит, клюёт, смотрит, ест
      const my = ++gen;
      while (alive && !busy(my)) {
        const r = Math.random();
        const name = r < .38 ? 'idle' : r < .7 ? 'walk' : r < .8 ? 'peck' : r < .87 ? 'look' : r < .93 ? 'eat' : r < .97 ? 'shake' : 'coo';
        await run(name, my);
        if (busy(my)) return;
        if (P.name !== 'idle') play('idle', 0, ACT.idle.frames - 1, { loop: true });
        setState('idle');
        if (nowClock() - poked > 15000 && !await idleFor((lite ? 40000 : 20000) + Math.random() * 30000, my)) return;   // тишина — отдыхает
      }
    }

    // ---------- кадр ----------
    let last = performance.now(), scrolling = false;
    function step(dt) {
      if (clock - rectsAt > 1500) refreshRects();
      if (scrolling) { show(false); return; }
      if (!B.g || !free(B.x, B.g)) {                           // место заняли — пересаживается (незаметно); места нет — прячется
        if (B.shown) { show(false); B.reseat = clock + 380; return; }
        if (clock < B.reseat) return;
        const p = spot(B.x, B.g ? B.g.y : innerHeight);
        if (!p) { B.reseat = clock + 1200; return; }
        B.x = p.x; B.g = p.g; if (B.walk) { const w = B.walk; B.walk = null; w.r(false); }
      }
      show(true);
      if (Math.abs(B.yawTo - B.yaw) > .01) {
        B.yaw += Math.sign(B.yawTo - B.yaw) * Math.min(Math.abs(B.yawTo - B.yaw), dt * 4.2);
      } else if (B.walk) {
        const d = B.walk.x - B.x, v = WALK_U * px * dt;
        if (Math.abs(d) <= v || !free(B.x + Math.sign(d) * v, B.g)) {
          if (Math.abs(d) <= v) B.x = B.walk.x;
          const w = B.walk; B.walk = null; play('idle', 0, ACT.idle.frames - 1, { loop: true }); w.r(true);
        } else B.x += Math.sign(d) * v;
      }
      root.rotation.y = B.yaw;
    }
    function frame(now) {
      raf = 0;
      if (!alive) return;
      if (lite && now - last < 30) { if (!reduced && !document.hidden) raf = requestAnimationFrame(frame); return; }   // лёгкий режим: ~30 кадров/с
      try {
        const dt = Math.min(.05, (now - last) / 1000); last = now;
        const t1 = performance.now();
        clock += dt * 1000;
        if (S) {
          step(dt);
          stepPlayer(dt);
          tickTimers();
          place(); snoreStep();
          renderer.render(scene, cam);
        } else tickTimers();
        const ms = performance.now() - t1;
        st.frames++; st.ms += ms; st.maxMs = Math.max(st.maxMs, ms);
      } catch (e) { return fail(e); }
      if (reduced || document.hidden) return;
      if (restful()) { doze = { at: performance.now(), t: 0 }; armDoze(); st.dozes++; }
      else raf = requestAnimationFrame(frame);
    }
    function still() {                                         // спокойная поза: один кадр, без анимации
      try {
        refreshRects();
        if (!B.g || !free(B.x, B.g)) { const p = spot(B.x, innerHeight); if (!p) { cv.style.opacity = shadow.style.opacity = 0; return; } B.x = p.x; B.g = p.g; }
        cv.style.transition = shadow.style.transition = 'none'; B.shown = true; cv.style.opacity = shadow.style.opacity = 1;
        P.name = 'idle'; P.f = 0; P.a = 0; P.b = 0; P.loop = false; fade.length = 0; stepPlayer(0);
        root.rotation.y = B.yaw = YAW_LEFT; place(); renderer.render(scene, cam);
      } catch (e) { fail(e); }
    }
    const resume = () => { if (alive && !raf && !reduced && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    let scrollT = 0;
    const settle = () => { refreshRects(); B.g = null; if (B.walk) { const w = B.walk; B.walk = null; w.r(false); } if (reduced) still(); else wake(); };
    function freeze(v) {                                       // фон и «уменьшить движение»: слой не меняется ни на пиксель
      try {
        const cs = [cv, shadow];
        if (v) cs.forEach(e => { const o = getComputedStyle(e).opacity; e.style.transition = 'none'; e.style.opacity = o; });
        layer.getAnimations({ subtree: true }).forEach(a => { try { v ? a.pause() : a.play(); } catch (e) { /* ничего */ } });
      } catch (e) { /* ничего */ }
    }
    on(document, 'visibilitychange', () => {                   // фон — 0 кадров и ни одного изменения слоя
      if (document.hidden) {
        cancelAnimationFrame(raf); raf = 0; clearTimeout(scrollT); freeze(true);
        if (doze && doze.at != null) { clearTimeout(doze.t); clock = nowClock(); doze.at = null; }   // в фоне часы стоят
      } else { freeze(false); if (scrolling) { scrolling = false; settle(); } wake(); resume(); }
    });
    on(window, 'resize', () => { try { fit(); settle(); } catch (e) { fail(e); } });
    on(window, 'scroll', () => {                               // при прокрутке тихо исчезает, после — на свободном месте
      if (!scrolling) { scrolling = true; show(false); }
      clearTimeout(scrollT); scrollT = setTimeout(() => { if (!document.hidden) { scrolling = false; settle(); } }, 420);
    }, { passive: true, capture: true });
    offs.push(() => clearTimeout(scrollT));
    on(document, 'fx-lite', () => { try { lite = true; fit(); wake(); } catch (e) { fail(e); } });   // лёгкий режим включился позже

    // ---------- события страницы ----------
    // простой 60 с — стучит в стекло; ещё 45 с без действий — засыпает; первое действие — просыпается
    let idleGen = 0;
    const react = {
      pasted: () => interrupt('look'),
      reconciled: d => interrupt(d && d.allOk ? 'coo' : 'look'),
      numbersSent: () => interrupt('hop'),
      copied: () => interrupt('eat'),
      tab: () => refreshRects(),
      cleared: () => interrupt('shake'),
      idle: () => {                                            // ещё 45 с без действий после стука — засыпает
        const k = ++idleGen; interrupt('knock');
        wait(45000).then(() => { if (k === idleGen && alive && !reduced && !asleep) interrupt('sleep'); });
      },
      active: () => { idleGen++; if (asleep) rouse(); },
      soundMode: d => { if (d && d.mode) modeNow = d.mode; },
    };
    if (events && events.on) {
      for (const [name, fn] of Object.entries(react)) {
        try {
          const off = events.on(name, d => { setTimeout(() => { if (alive && !reduced) { try { if (name !== 'idle') poked = nowClock(); refreshRects(); fn(d); wake(); } catch (e) { fail(e); } } else if (alive && reduced && name === 'soundMode') fn(d); }, 60); });
          if (typeof off === 'function') offs.push(off);
        } catch (e) { /* ничего */ }
      }
    }

    // ---------- для проверок (отдел «Качество») ----------
    window.SverkaArkadiy = {
      states: STATES.slice(),
      state: () => now_,
      rest: () => ({ frames: st.frames, dozes: st.dozes, dozing: !!doze, lite }),   // покой: сколько кадров нарисовано, дремлет ли
      go: name => {                                            // перевести в состояние; выход — сам, потом обычная жизнь
        if (!STATES.includes(name) || reduced || !alive) return false;
        if (name === 'sleep') { interrupt('sleep'); wait(6000).then(() => { if (asleep) rouse(); }); return true; }
        if (name === 'idle') { const my = ++gen; calm(); idleFor(2500, my).then(() => { if (my === gen && alive) life(); }); return true; }
        if (name === 'walk') {
          const my = ++gen; calm();
          (async () => {
            for (let i = 0; i < 20 && !B.g; i++) await wait(100);
            let to = null;
            for (const sgn of [-1, 1]) { for (let x = B.x; Math.abs(x - B.x) < 200; x += sgn * 6) { if (!free(x + sgn * 6, B.g)) break; to = x + sgn * 6; } if (to != null && Math.abs(to - B.x) > 40) break; }
            if (to != null && Math.abs(to - B.x) > 12) await walkTo(to, my);
            else {                                             // места для шагов нет — топчется на месте
              setState('walk'); play('walk', 0, ACT.walk.frames - 1, { loop: true, fps: WALK_FPS });
              await wait(1600); if (my === gen) play('idle', 0, ACT.idle.frames - 1, { loop: true });
            }
            if (my === gen && alive) { setState('idle'); life(); }
          })();
          return true;
        }
        interrupt(name); return true;
      },
      __own: stop,
    };

    on(MQ, 'change', () => {
      try {
        reduced = MQ.matches;
        if (reduced) { ++gen; calm(); cancelAnimationFrame(raf); raf = 0; if (doze) { clearTimeout(doze.t); clock = nowClock(); doze = null; } freeze(true); still(); }
        else { freeze(false); resume(); life(); }
      } catch (e) { fail(e); }
    });

    fit();
    refreshRects();
    cv.style.opacity = shadow.style.opacity = 0;
    play('idle', 0, ACT.idle.frames - 1, { loop: true, blend: false });
    if (reduced) still(); else { resume(); life(); }
  } catch (e) {
    fail(e);
  }
  return {
    stop,
    stats: () => ({ ...st, avgMs: st.frames ? +(st.ms / st.frames).toFixed(2) : 0 }),
  };
}
