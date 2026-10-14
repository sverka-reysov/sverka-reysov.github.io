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
const PECK = { bend: [0, 8], peck: [8, 16], hit: 11, up: [16, 39], dx: 63 };   // клевок: наклон, удар (повтор), выпрямиться; клюв на ударе — 63 px перед лапами, на их уровне
// зёрна, семечки, крошки — одна полоса props.webp (13 клеток); размер на экране при голубе 250
const PROPS = { grain: [0, 5, 16], seed: [5, 4, 17], crumb: [9, 4, 12] }, PROP_CELLS = 13, GRAV = 1500;
// кнопка под кромкой окна: «перегнулся» (reach) — удары на кадрах 20, 30, 40, кончик клюва на ударе — 44 px вперёд и
// 26 px ниже лап (при размере 250); «тянет» (yank) — схватил на 12, рывки 26/44/62, отпустил на 76
const REACH = { hits: [20, 30, 40], dx: 44, dy: 26 }, YANK = { grab: 12, pulls: [26, 44, 62], let: 76 };
const STATES = ['idle', 'walk', 'look', 'peck', 'eat', 'coo', 'hop', 'shake', 'knock', 'sleep', 'button', 'fly', 'poop', 'stretch'];
// жизнь в покое: сцены по очереди, без повтора подряд; между ними отдых (кадров нет)
const LIFE = ['fly', 'button', 'poop', 'knock', 'walk', 'shake', 'stretch', 'peck', 'look', 'eat', 'walk', 'fly'];
const FLY = { up: [0, 16], air: [16, 100], down: 100, flap: 10 };   // кадры перелёта: присел-взлёт, полёт, посадка
const SOUNDS = { coo: ['coo-1', 'coo-2', 'coo-3'], flap: ['flap'], knock: ['tap-1', 'tap-2', 'tap-3'], peck: ['peck-1', 'peck-2'], btn: ['tap-1', 'tap-2', 'tap-3'] };
const VOL = { coo: .35, flap: .3, knock: .55, peck: .3, btn: .3 };

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
    try { document.documentElement.classList.remove('has-arkadiy'); } catch (e) { /* ничего */ }
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
    cv.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;will-change:transform;transform-origin:0 0';
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
    const tipLocal = new THREE.Vector3();
    if (beakObj) {
      beakObj.geometry.computeBoundingBox(); beakObj.geometry.boundingBox.getCenter(beakLocal);
      gltf.scene.updateMatrixWorld(true);                      // кончик — самая передняя точка клюва в покое (вперёд — +z)
      const pos = beakObj.geometry.attributes.position, v = new THREE.Vector3(); let best = -1e9;
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(beakObj.matrixWorld); if (v.z > best) { best = v.z; tipLocal.fromBufferAttribute(pos, i); } }
    }
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const ACT = {};
    for (const clip of gltf.animations) {
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity); a.enabled = true; a.setEffectiveWeight(0); a.play(); a.paused = true;
      ACT[clip.name] = { a, frames: Math.round(clip.duration * FPS) + 1 };
    }
    for (const n of ['idle', 'walk', 'peck', 'look', 'nibble', 'coo', 'hop', 'shake', 'knock', 'sleep', 'stretch', 'reach', 'yank'])
      if (!ACT[n]) throw new Error('в модели нет движения ' + n);
    // клюв на ударе: насколько (в долях размера) он впереди лап — влево и вправо; по этому встаёт к зерну
    const PDX = { [YAW_LEFT]: -PECK.dx / 250, [YAW_RIGHT]: PECK.dx / 250 };
    if (beakObj) {
      for (const n in ACT) ACT[n].a.setEffectiveWeight(0);
      ACT.peck.a.setEffectiveWeight(1); ACT.peck.a.time = PECK.hit / FPS; mixer.update(0);
      for (const yaw of [YAW_LEFT, YAW_RIGHT]) {
        root.rotation.y = yaw; root.updateMatrixWorld(true);
        PDX[yaw] = (tipLocal.clone().applyMatrix4(beakObj.matrixWorld).project(cam).x + 1) / 2 - AX;
      }
      root.rotation.y = 0;
    }
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
      try { document.documentElement.classList.toggle('has-arkadiy', !!S); } catch (e) { /* ничего */ }
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
      const list = [{ y: innerHeight - 6, l: 0, r: innerWidth, fixed: true }];   // низ окна — неподвижная опора
      for (const r of RECTS) if (r.top > S * .7 + 8 && r.top < innerHeight - 8 && r.right - r.left > S * .8) list.push({ y: r.top + 1, l: r.left, r: r.right });
      return list;
    }
    const onSurf = (x, g) => x > Math.max(g.l, 0) + S * .32 && x < Math.min(g.r, innerWidth) - S * .32;
    const free = (x, g) => !!g && (g.corner ? Math.abs(x - g.x) < 2 : onSurf(x, g) && !RECTS.some(r => hits(bodyBox(x, g.y), r)));
    // Насест (решение основной 14.10.2026): места по avoid нет нигде — неподвижный угол справа внизу, поверх края таблицы;
    // на узком окне голубь там чуть меньше (×0,72 → 180 при 250). Курсор рядом — притухает; странице — html.has-arkadiy.
    const CORNER_K = () => innerWidth < 1600 ? .72 : 1;
    function cornerG() {
      const k = CORNER_K(), x = document.documentElement.clientWidth - 12 - S * .3 * k;
      return { y: innerHeight - 6, l: x - 1, r: x + 1, x, fixed: true, corner: true };
    }
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
    // та же опора после прокрутки или сдвига страницы: та же ширина, ближайшая по высоте; нет — ушла с экрана (null)
    function trackG(g) {
      if (!g) return null;
      if (g.corner) return cornerG();
      const list = surfaces();
      if (g.fixed) return list[0];
      let best = null;
      for (const c of list) if (!c.fixed && Math.abs(c.l - g.l) < 3 && Math.abs(c.r - g.r) < 3 && (!best || Math.abs(c.y - g.y) < Math.abs(best.y - g.y))) best = c;
      return best;
    }
    function perchSpot(prefX, fixedFirst, notG) {             // куда сесть: свободное место на опоре, ближе к prefX
      for (const pass of fixedFirst ? [true, false] : [false]) {
        let best = null, bd = 1e9;
        for (const g of surfaces()) {
          if (pass && !g.fixed) continue;
          if (notG && Math.abs(g.y - notG.y) < 24) continue;
          for (let d = 0; d < innerWidth; d += 18) {
            const x = [prefX + d, prefX - d].find(x => free(x, g));
            if (x != null) { const c = d + Math.abs(g.y - (notG ? notG.y : innerHeight)) * .5; if (c < bd) { bd = c; best = { x, g }; } break; }
          }
        }
        if (best) return best;
      }
      return null;
    }
    function pickPerch() {                                     // перелёт в покое: другая кромка, не слишком близко и не на край света
      const out = [];
      for (const g of surfaces()) {
        if (B.g && Math.abs(g.y - B.g.y) < 24) continue;
        for (let x = Math.max(g.l, 0) + S * .35; x < Math.min(g.r, innerWidth) - S * .35; x += 30) {
          if (!free(x, g)) continue;
          const d = Math.hypot(x - B.x, g.y - (B.g ? B.g.y : innerHeight));
          if (d > 120) out.push({ x, g, w: d < 900 ? 1 : .3 });
        }
      }
      if (!out.length) return null;
      let k = Math.random() * out.reduce((a, o) => a + o.w, 0);
      for (const o of out) if ((k -= o.w) <= 0) return o;
      return out[out.length - 1];
    }

    // ---------- положение на экране ----------
    const B = { x: innerWidth - Math.max(160, innerWidth * .12), g: null, side: YAW_LEFT, yaw: YAW_LEFT, yawTo: YAW_LEFT, shown: false, reseat: 0, walk: null,
      fly: null, moving: false, lost: false, k: 1 };          // fly — в воздухе: { x, y, gy, x0, y0, x1, g1, t0, T, arc, go, k0, k1 }; k — масштаб (насест)
    function show(v) { if (B.shown === v) return; B.shown = v; cv.style.transition = shadow.style.transition = 'opacity .35s'; cv.style.opacity = shadow.style.opacity = v ? 1 : 0; }
    function place() {
      if (!S) return;
      const f = B.fly, x = f ? f.x : B.x, gy = f ? f.y : B.g ? B.g.y : innerHeight - 6, k = B.k;
      cv.style.transform = `translate3d(${x - AX * S * k}px,${gy - AY * S * k}px,0)` + (k !== 1 ? ` scale(${k.toFixed(3)})` : '');
      const sw = S * .5 * k, sh = S * .08 * k, sy = f ? f.gy : gy;   // в полёте тень тает: земли под ним нет
      const ks = f && f.go ? Math.max(0, 1 - 2 * Math.sin(Math.PI * Math.min(1, (clock - f.t0) / f.T))) : 1;
      shadow.style.width = sw + 'px'; shadow.style.height = sh + 'px';
      shadow.style.transform = `translate3d(${x - sw / 2}px,${sy - sh / 2}px,0) scale(${ks.toFixed(3)})`;
    }
    const tmp = new THREE.Vector3();
    function beak(tip) {                                       // середина клюва (или кончик) на экране
      const gy = B.g ? B.g.y : innerHeight - 6;
      if (!beakObj) return { x: B.x, y: gy - S * .6 };
      tmp.copy(tip ? tipLocal : beakLocal).applyMatrix4(beakObj.matrixWorld); tmp.project(cam);
      const k = B.k;
      return { x: B.x + ((tmp.x + 1) / 2 - AX) * S * k, y: gy + ((1 - tmp.y) / 2 - AY) * S * k };
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
      if (!S) return true;
      if (moved || B.fly) return false;                        // прокрутка (едет с кромкой) или в воздухе
      if (!B.shown) return clock < B.reseat;                   // ждёт пересадки — проснётся к сроку
      if (B.walk || fade.length || snoreEl || Math.abs(B.yawTo - B.yaw) > .01 || !free(B.x, B.g) || bits.some(b => !b.rest)) return false;
      return P.loop ? P.name === 'idle' && clock - P.since > REST() : P.f === P.b;
    }
    offs.push(() => { if (doze) clearTimeout(doze.t); });

    // ---------- звук: только после первого действия Паши и если страница не велит молчать ----------
    let acted = false, AC = null, sndLoading = null; const BUF = {};
    const touched = () => { acted = true; poked = nowClock(); preload(); if (asleep) rouse(); };   // первое действие — звуки грузятся заранее
    on(window, 'pointerdown', touched, { passive: true, capture: true });
    on(window, 'keydown', touched, { passive: true, capture: true });
    let modeNow = opts.soundMode || 'night';
    const muted = () => {
      try { if (events && events.sound) return !!events.sound().muted; } catch (e) { /* ниже — по режиму */ }
      const h = new Date().getHours(); return modeNow === 'off' || (modeNow === 'night' && (h >= 22 || h < 7));
    };
    // Звук — только прямой отклик на действие Паши: 2,5 с после вставил / скопировал / сверил / вписал. Всё, что голубь
    // делает сам (простой, стук в стекло и по кнопке, сон, клёв, еда и воркование по своей воле), — только движения.
    const HEARD = 2500, HEARD_ON = { pasted: 1, copied: 1, reconciled: 1, numbersSent: 1 };
    let heardUntil = -1e9;
    function preload() {
      try {
        if (muted()) return;                                   // «выкл» и ночью — ничего не грузит
        if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
        if (!sndLoading) sndLoading = Promise.all([...new Set(Object.values(SOUNDS).flat())].map(n =>
          fetch(BASE + 'sounds/' + n + '.mp3' + V).then(r => r.arrayBuffer()).then(b => AC.decodeAudioData(b)).then(d => { BUF[n] = d; }).catch(() => {})));
      } catch (e) { /* без звука — не беда */ }
    }
    function sfx(kind) {
      if (!acted || muted() || document.hidden || !B.shown || !SOUNDS[kind] || nowClock() > heardUntil) return;   // спрятан — молчит
      try {
        preload();
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
    function dent(x, y, strong) {                              // клюнул кнопку: блик-вмятинка тает за 3 с, пара пылинок
      if (!B.shown) return;
      const R = (strong ? 9 : 7) * S / 250, m = document.createElement('div');
      m.style.cssText = `position:absolute;left:${x - R}px;top:${y - R * .6}px;width:${R * 2}px;height:${R * 1.2}px;border-radius:50%;pointer-events:none;` +
        'background:radial-gradient(closest-side,rgba(255,255,255,.55),rgba(255,255,255,.16) 55%,transparent);box-shadow:inset 0 -1px 1px rgba(0,0,0,.18)';
      layer.appendChild(m);
      m.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)', offset: .05 }, { opacity: 0, transform: 'scale(1.3)' }],
        { duration: 3000, easing: 'ease-out', fill: 'forwards' }).onfinish = () => m.remove();
      for (let i = 0; i < (strong ? 4 : 2); i++) {
        const d = document.createElement('div'), r = 1.2 + Math.random() * 1.4, a = -Math.PI * (.15 + Math.random() * .7), v = 10 + Math.random() * 18;
        d.style.cssText = `position:absolute;left:${x - r}px;top:${y - r}px;width:${r * 2}px;height:${r * 2}px;border-radius:50%;pointer-events:none;background:rgba(240,232,214,.8)`;
        layer.appendChild(d);
        d.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * v}px,${Math.sin(a) * v + 14}px)`, opacity: 0 }],
          { duration: 520 + Math.random() * 300, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' }).onfinish = () => d.remove();
      }
    }
    // ---------- зёрна и крошки на кромке, где стоит голубь ----------
    const bits = [];                                           // { el, sh, x, y, vx, vy, r, vr, size, rest, gy, g }
    function drop(kind, x0, y0, tx, vy) {                      // летит из (x0, y0) и ложится на кромку голубя около tx
      const g = B.g; if (!g || g.corner || !B.shown || reduced || bits.length > 40) return;   // на насесте — не сыплет поверх таблицы
      const [i0, n, px] = PROPS[kind], size = px * S / 250 * (.85 + Math.random() * .3), idx = i0 + (Math.random() * n | 0);
      const el = document.createElement('div'), sh = document.createElement('div');
      el.style.cssText = `position:absolute;left:0;top:0;width:${size}px;height:${size}px;pointer-events:none;will-change:transform;` +
        `background:url("${BASE}props.webp${V}") ${-idx * size}px 0/${PROP_CELLS * size}px ${size}px no-repeat;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))`;
      sh.style.cssText = `position:absolute;left:0;top:0;width:${size}px;height:${size * .32}px;border-radius:50%;pointer-events:none;` +
        'background:radial-gradient(closest-side,rgba(0,0,0,.38),transparent);opacity:0';
      layer.append(sh, el);
      const gy = g.y - 1 - Math.random() * 2;
      tx = Math.max(Math.max(g.l, 0) + 8, Math.min(Math.min(g.r, innerWidth) - 8, tx));
      const [lo, hi] = reachSpan(), dx = Math.min(-PDX[YAW_LEFT], PDX[YAW_RIGHT]) * S;   // ложится только туда, куда он дотянется клювом
      tx = Math.max(lo - dx + 14, Math.min(hi + dx - 14, tx));
      if (vy == null) vy = -(160 + Math.random() * 120);
      if (y0 > gy - 30) vy = Math.min(vy, -Math.sqrt(2 * GRAV * (y0 - gy + 40)));   // снизу — подбрасывает выше кромки
      const T = (-vy + Math.sqrt(Math.max(0, vy * vy + 2 * GRAV * (gy - y0)))) / GRAV;
      bits.push({ tries: 0, el, sh, x: x0, y: y0, vx: (tx - x0) / Math.max(.15, T), vy, r: Math.random() * 360, vr: (Math.random() - .5) * 900, size, rest: false, gy, g });
      wake();
    }
    const onMine = b => !!B.g && Math.abs(b.g.y - B.g.y) < 3 && b.x > B.g.l - 4 && b.x < B.g.r + 4;   // на той же кромке (объект кромки пересоздаётся)
    function reachSpan() {                                     // где он может стоять на своей кромке, не обходя помех
      let lo = B.x, hi = B.x;
      if (!free(B.x, B.g)) return [lo, hi];
      while (free(lo - 6, B.g)) lo -= 6;
      while (free(hi + 6, B.g)) hi += 6;
      return [lo, hi];
    }
    function stepBits(dt) {
      for (const b of bits) {
        if (!b.rest) {
          b.vy += GRAV * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.r += b.vr * dt;
          if (b.y >= b.gy && b.vy > 0) {
            b.y = b.gy;
            if (b.vy > 140) { b.vy *= -.3; b.vx *= .5; b.vr *= .6; }   // отскок
            else { b.vy = 0; b.vx *= Math.pow(.02, dt); b.vr = b.vx * 3; if (Math.abs(b.vx) < 6) settleBit(b); }
          }
          const lo = Math.max(b.g.l, 0) + 4, hi = Math.min(b.g.r, innerWidth) - 4;
          if (b.y >= b.gy - 2 && (b.x < lo || b.x > hi)) { b.x = Math.max(lo, Math.min(hi, b.x)); b.vx = 0; }   // с кромки не скатывается
        }
        const lift = Math.max(0, b.gy - b.y);
        b.el.style.transform = `translate3d(${b.x - b.size / 2}px,${b.y - b.size * .75}px,0) rotate(${b.r.toFixed(1)}deg)`;
        b.sh.style.transform = `translate3d(${b.x - b.size / 2}px,${b.gy - b.size * .16}px,0) scale(${Math.max(.3, 1 - lift / 220).toFixed(3)})`;
        b.sh.style.opacity = Math.max(.1, .9 - lift / 150).toFixed(3);
      }
    }
    function settleBit(b) {                                    // легло; не склевал за 90 с — тает
      b.rest = true; b.vx = b.vy = b.vr = 0;
      b.el.animate([{ opacity: 1 }, { opacity: 0 }], { delay: 90000, duration: 1500, fill: 'forwards' }).onfinish = () => removeBit(b);
    }
    function removeBit(b, fast) {
      const i = bits.indexOf(b); if (i >= 0) bits.splice(i, 1);
      if (!fast) { b.el.remove(); b.sh.remove(); return; }
      for (const e of [b.el, b.sh]) e.animate([{ opacity: getComputedStyle(e).opacity }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).onfinish = () => e.remove();
    }
    const clearBits = () => bits.slice().forEach(b => removeBit(b, true));   // страница сдвинулась — зёрна не на своих местах
    function spark(x, y) {                                     // склевал: искорка
      const sp = document.createElement('div'), R = 9 * S / 250;
      sp.style.cssText = `position:absolute;left:${x - R}px;top:${y - R}px;width:${R * 2}px;height:${R * 2}px;pointer-events:none`;
      for (let i = 0; i < 6; i++) {
        const r = document.createElement('i');
        r.style.cssText = `position:absolute;left:${R - 1}px;top:0;width:2px;height:${R * .6}px;border-radius:2px;background:#fff6d8;` +
          `transform-origin:1px ${R}px;transform:rotate(${i * 60}deg);box-shadow:0 0 5px rgba(255,230,160,.9)`;
        sp.appendChild(r);
      }
      layer.appendChild(sp);
      sp.animate([{ transform: 'scale(.3) rotate(0deg)', opacity: 1 }, { transform: 'scale(1.3) rotate(30deg)', opacity: 0 }], { duration: 480, easing: 'ease-out', fill: 'forwards' }).onfinish = () => sp.remove();
    }
    function gulp() {                                          // удар клювом: зёрнышко под клювом исчезает
      const p = { x: B.x + PDX[B.side] * S }, r = 14 * S / 250;   // кончик клюва на ударе — по замеру модели
      const b = bits.filter(b => b.rest && onMine(b) && Math.abs(b.x - p.x) < r).sort((a, c) => Math.abs(a.x - p.x) - Math.abs(c.x - p.x))[0];
      if (!b) return;
      spark(b.x, b.y - b.size * .3);
      const i = bits.indexOf(b); if (i >= 0) bits.splice(i, 1);
      b.el.getAnimations().forEach(a => a.cancel());
      b.el.animate([{ opacity: 1 }, { opacity: 0, transform: b.el.style.transform + ' scale(.1)' }], { duration: 160, fill: 'forwards' }).onfinish = () => b.el.remove();
      b.sh.remove();
    }
    offs.push(() => bits.length = 0);

    // ---------- помёт: только на кромке, не на таблицах и кнопках; тает через 20 с ----------
    const poops = [];                                          // { w, g, x }
    const POOP_URL = `url("${BASE}poop.webp${V}")`;
    function poopBox(x, g) { const k = S / 250; return { left: x - 18 * k, right: x + 18 * k, top: g.y - 22 * k, bottom: g.y - 2 }; }
    const tailX = () => B.x - (B.side === YAW_RIGHT ? 1 : -1) * 34 * S / 250;   // под хвостом
    const poopOk = () => !!B.g && B.shown && !RECTS.some(r => hits(poopBox(tailX(), B.g), r)) && onSurf(tailX(), { l: B.g.l - S * .3, r: B.g.r + S * .3 });
    function placePoop(o) { o.w.style.transform = `translate3d(${o.x - o.size / 2}px,${o.g.y - o.size + 2}px,0)`; }
    function poopDrop() {
      if (!poopOk()) return;
      const k = S / 250, x = tailX(), g = B.g, y0 = g.y - 58 * k, dsz = 12 * k, size = 40 * k;
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;left:${x - dsz / 2}px;top:${y0}px;width:${dsz}px;height:${dsz}px;pointer-events:none;` +
        `background:${POOP_URL} ${-2 * dsz}px 0/${3 * dsz}px ${dsz}px no-repeat`;
      layer.appendChild(d);
      d.animate([{ transform: 'translateY(0) scale(.6,.9)' }, { transform: `translateY(${g.y - y0 - dsz * .8}px) scale(.8,1.25)` }],
        { duration: 240, easing: 'cubic-bezier(.55,0,1,.6)', fill: 'forwards' }).onfinish = () => {
        d.remove();
        const w = document.createElement('div'), im = document.createElement('div');
        w.style.cssText = `position:absolute;left:0;top:0;width:${size}px;height:${size}px;pointer-events:none`;
        im.style.cssText = `width:100%;height:100%;transform-origin:50% 92%;background:${POOP_URL} ${-(Math.random() < .5 ? 0 : 1) * size}px 0/${3 * size}px ${size}px no-repeat;` +
          'filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))';
        w.appendChild(im); layer.appendChild(w);
        const o = { w, g, x, size }; poops.push(o); placePoop(o);
        im.animate([{ transform: 'scale(.4,.2)' }, { transform: 'scale(1.25,.7)', offset: .35 }, { transform: 'scale(.95,1.06)', offset: .7 }, { transform: 'scale(1)' }],
          { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1)' });
        for (let i = 0; i < 5; i++) {                          // брызги
          const s2 = document.createElement('div'), r = (2 + Math.random() * 2.5) * k, a = Math.PI * (1.1 + Math.random() * .8), v = (16 + Math.random() * 16) * k;
          s2.style.cssText = `position:absolute;left:${x - r / 2}px;top:${g.y - 6 * k}px;width:${r}px;height:${r}px;border-radius:50%;pointer-events:none;background:#f4f1ea`;
          layer.appendChild(s2);
          s2.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * v}px,${Math.sin(a) * v * .6}px)`, opacity: 1, offset: .6 },
            { transform: `translate(${Math.cos(a) * v * 1.2}px,${4 * k}px)`, opacity: 0 }], { duration: 520, easing: 'ease-out', fill: 'forwards' }).onfinish = () => s2.remove();
        }
        w.animate([{ opacity: 1, filter: 'blur(0)' }, { opacity: 0, filter: 'blur(3px)' }], { delay: 20000, duration: 1800, fill: 'forwards' }).onfinish = () => removePoop(o);
      };
    }
    function removePoop(o, fast) {
      const i = poops.indexOf(o); if (i >= 0) poops.splice(i, 1);
      if (!fast) return o.w.remove();
      o.w.animate([{ opacity: getComputedStyle(o.w).opacity }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).onfinish = () => o.w.remove();
    }
    offs.push(() => poops.length = 0);

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
      snoreHalf = half;                                        // храп — только пузырь, без звука
    }

    // ---------- поведение: сцены (одна за раз; новая прерывает старую) ----------
    let gen = 0, now_ = 'idle', asleep = false, snoring = false, rouseR = null;
    const nap = ms => Promise.race([wait(ms), new Promise(r => { rouseR = r; })]);   // спит, пока не разбудят или не выйдет срок
    function rouse() { asleep = false; if (rouseR) { const r = rouseR; rouseR = null; r(); } }
    const busy = my => my !== gen;
    let stateAt = 0;                                           // с какого момента — текущее состояние
    const IDLE_MAX = 24000;                                    // «стоит» подряд — не дольше 24 с, потом обязательно движение
    const setState = s => {
      if (s === now_) return;
      now_ = s; const at = stateAt = nowClock();
      // сторож: «стоит» дольше IDLE_MAX + 2 с — что бы ни случилось, клюнет (таймер ничем не сбрасывается)
      if (s === 'idle') wait(IDLE_MAX + 2000).then(() => { if (alive && !reduced && now_ === 'idle' && stateAt === at) interrupt('peck'); });
    };
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
      for (let i = 0; i < n; i++) if (!await play('peck', PECK.peck[0], PECK.peck[1], { blend: false, ev: { [PECK.hit]: () => { sfx('peck'); gulp(); } } }) || busy(my)) return false;
      return await play('peck', PECK.up[0], PECK.up[1], { blend: false }) && !busy(my);
    }
    function pathFree(x) {                                     // по своей кромке до x — без помех
      for (let xx = B.x; Math.abs(xx - x) > 6; xx += Math.sign(x - xx) * 6) if (!free(xx, B.g)) return false;
      return free(x, B.g);
    }
    async function pickBits(my, max = 14) {                    // подбирает зёрна со своей кромки: ближние и те, что по ходу, — первыми
      for (let w = 0; w < 20 && bits.some(b => !b.rest); w++) await wait(150);   // ждёт, пока долетят
      const r = 14 * S / 250;
      for (let n = 0; n < max && !busy(my); n++) {
        const ahead = b => (B.side === YAW_RIGHT ? b.x > B.x : b.x < B.x);
        const list = bits.filter(b => b.rest && onMine(b) && !b.skip)
          .sort((a, c) => (Math.abs(a.x - B.x) + (ahead(a) ? 0 : 120)) - (Math.abs(c.x - B.x) + (ahead(c) ? 0 : 120)));
        const t = list[0]; if (!t) return true;
        const opts = [YAW_LEFT, YAW_RIGHT].map(y => [y, t.x - PDX[y] * S]).filter(o => pathFree(o[1])).sort((a, c) => Math.abs(a[1] - B.x) - Math.abs(c[1] - B.x));
        if (!opts.length) { t.skip = true; continue; }           // не подойти — оставит
        if (!await walkTo(opts[0][1], my)) return false;
        B.side = opts[0][0];
        if (!await turnTo(B.side, my)) return false;
        const near = list.filter(b => Math.abs(b.x - t.x) < r).length;
        if (!await pecks(Math.min(3, near), my)) return false;
        if (bits.includes(t) && ++t.tries >= 2) t.skip = true;  // дважды мимо — оставит
        if (Math.random() < .4 && !await idleFor(250 + Math.random() * 400, my)) return false;
      }
      return !busy(my);
    }
    function grainSource() {                                   // откуда сыплется: из строки, вписанной последней, или сверху
      let r = null; try { const t = events && events.rects && events.rects().targets; r = t && t.lastRow; } catch (e) { r = null; }
      const gy = B.g ? B.g.y : innerHeight;
      if (r && r.bottom > 0 && r.top < innerHeight && Math.abs(r.bottom - gy) < innerHeight * .7)
        return () => ({ x: r.left + 30 + Math.random() * Math.max(10, r.right - r.left - 60), y: r.bottom - 4, vy: undefined });
      return () => ({ x: B.x + (Math.random() - .5) * 120, y: gy - 240 - Math.random() * 60, vy: -Math.random() * 40 });
    }
    function buttonSpot() {                                    // кнопка, до которой клюв достаёт с этой же кромки
      if (!B.g) return null;
      let list = [];
      try { const t = events && events.rects && events.rects().targets; list = (t && (t.buttons || (t.verify ? [t.verify] : []))) || []; } catch (e) { list = []; }
      const k = S / 250, ty = B.g.y + REACH.dy * k, best = [];
      for (const b of list) {
        if (!(ty > b.top + 2 && ty < b.bottom - 2) || b.right - b.left < 30) continue;
        const cx = b.left + (b.right - b.left) * (.3 + Math.random() * .4);
        for (const [side, x] of [[YAW_LEFT, cx + REACH.dx * k], [YAW_RIGHT, cx - REACH.dx * k]]) {
          if (!free(x, B.g)) continue;
          if (pathFree(x)) best.push({ x, side, d: Math.abs(x - B.x) + (side === (x > B.x ? YAW_RIGHT : YAW_LEFT) ? 0 : 40) });
        }
      }
      best.sort((a, b) => a.d - b.d);
      return best[0] || null;
    }
    async function flyTo(p, my) {                              // перелёт на другую кромку по дуге: присел — взлёт — полёт — посадка
      B.moving = true;
      try {
        if (B.walk) { const w = B.walk; B.walk = null; w.r(false); }
        const x0 = B.x, y0 = B.g && !B.lost ? B.g.y : B.g ? B.g.y : innerHeight - 6;
        B.side = B.yawTo = p.x >= x0 ? YAW_RIGHT : YAW_LEFT;     // разворачивается на взлёте
        setState('fly');
        B.fly = { x: x0, y: y0, gy: y0, x0, y0, x1: p.x, g1: p.g, t0: 0, T: 1, arc: 0, go: false, k0: B.k, k1: p.g.corner ? CORNER_K() : 1 };
        if (!await play('fly', FLY.up[0], FLY.up[1], { ev: { [FLY.flap]: () => sfx('flap') } }) || busy(my)) return false;
        const dist = Math.hypot(p.x - x0, p.g.y - y0), T = Math.max(.7, Math.min(2.4, dist / 520));
        Object.assign(B.fly, { t0: clock, T: T * 1000, arc: Math.min(140, 30 + dist * .2), go: true });
        if (!await play('fly', FLY.air[0], FLY.air[1], { fps: (FLY.air[1] - FLY.air[0]) / T, blend: false }) || busy(my)) return false;
        B.x = B.fly.x1; B.g = B.fly.g1; B.k = B.fly.k1; B.lost = false; B.fly = null;
        return await play('fly', FLY.down, ACT.fly.frames - 1, { blend: false }) && !busy(my);
      } finally {
        if (B.fly) { B.x = B.fly.x1; B.g = B.fly.g1; B.k = B.fly.k1; B.lost = false; B.fly = null; }   // прервали в воздухе — уже сел
        B.moving = false;
      }
    }
    function flyStep() {
      const f = B.fly; if (!f.go) return;
      const t = Math.min(1, (clock - f.t0) / f.T), e = t * t * (3 - 2 * t);
      if (f.g1.corner) f.x1 = f.g1.x;
      f.x = f.x0 + (f.x1 - f.x0) * e; f.gy = f.y0 + (f.g1.y - f.y0) * e; f.y = f.gy - f.arc * Math.sin(Math.PI * t);
      B.k = f.k0 + (f.k1 - f.k0) * e;
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
      eat: async my => {                                       // откусывает свой хлеб — крошки падают, потом подбирает
        const crumb = () => { const b = beak(true); drop('crumb', b.x, b.y + 4, b.x + (B.side === YAW_RIGHT ? 1 : -1) * (10 + Math.random() * 40), -40 - Math.random() * 60); };
        if (!await once('nibble', 'eat', { 16: () => { sfx('peck'); crumb(); }, 26: () => { sfx('peck'); crumb(); }, 36: () => { crumb(); crumb(); } }) || busy(my)) return;
        await pickBits(my);
      },
      feed: async (my, d) => {                                 // вписали в Numbers: из строки сыплется зерно — радуется и подбирает
        const src = grainSource(), n = Math.min(12, 5 + ((d && d.n) || 0));
        for (let i = 0; i < n; i++) {
          const o = src(), kind = Math.random() < .7 ? 'grain' : Math.random() < .6 ? 'seed' : 'crumb';
          drop(kind, o.x, o.y, B.x + (Math.random() - .5) * 260, o.vy);
          if (i % 3 === 2) await wait(60);
        }
        if (!await once('hop', 'hop', { 8: () => sfx('flap') }) || busy(my)) return;
        setState('peck'); await pickBits(my);
      },
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
      button: async (my, tug) => {                             // клюёт кнопку под кромкой; от скуки — пытается оторвать
        const t = buttonSpot();
        if (t) {
          if (!await walkTo(t.x, my)) return;
          B.side = t.side;
          if (!await turnTo(t.side, my)) return;
        }
        setState('button'); B.yawTo = B.side;
        const hit = () => { const p = beak(true); dent(p.x, p.y); sfx('btn'); };
        // тянуть будет — не выпрямляется после ударов, сразу хватает
        const end = tug ? REACH.hits[REACH.hits.length - 1] + 3 : ACT.reach.frames - 1;
        if (!await play('reach', 0, end, { ev: Object.fromEntries(REACH.hits.map(f => [f, hit])) }) || busy(my)) return;
        if (!tug) return;
        const pull = () => { const p = beak(true); dent(p.x, p.y, true); sfx('peck'); };
        const ev = { [YANK.grab]: () => { const p = beak(true); dent(p.x, p.y); sfx('btn'); }, [YANK.let]: () => sfx('flap') };
        YANK.pulls.forEach(f => { ev[f] = pull; });
        if (!await play('yank', YANK.grab - 4, ACT.yank.frames - 1, { ev, blendS: .3 }) || busy(my)) return;
        await once('shake', 'button');                         // не поддалась — отряхнулся
      },
      fly: my => flyTo(pickPerch() || { x: B.x, g: B.g || surfaces()[0] }, my),   // некуда — подлетает на месте
      perch: (my, p) => flyTo(p, my),                          // кромка ушла (прокрутка) — перелетает
      poop: async my => {                                      // хвост вверх, присел — плюх (не на таблицы и кнопки)
        setState('poop'); B.yawTo = B.side;
        await play('poop', 0, ACT.poop.frames - 1, { ev: { 44: poopDrop } });
      },
      stretch: () => once('stretch', 'stretch'),
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
    async function run(name, my, arg) { try { await SCENES[name](my, arg); } catch (e) { fail(e); } }
    function calm() { rouse(); snoring = false; snore(false); if (B.walk) { B.walk.r(false); B.walk = null; } B.yawTo = B.side; }   // прервали — снова боком
    function interrupt(name, arg) {                            // прервать текущее, сыграть сцену, потом — обычная жизнь
      const my = ++gen; calm();
      return run(name, my, arg).then(() => { if (my === gen && alive) life(); });
    }
    let lastScene = '';
    const onCorner = () => !!(B.g && B.g.corner);
    const canScene = n => onCorner() ? !['walk', 'button', 'poop', 'eat'].includes(n) : n === 'button' ? !!buttonSpot() : n === 'poop' ? poopOk() : true;
    let bag = [];                                              // сцены по кругу в случайном порядке: каждая — раз за круг
    async function life() {                                    // обычная жизнь: сцены по очереди, между ними отдых без кадров
      const my = ++gen;
      while (alive && !busy(my)) {
        if (nowClock() - poked > 120000 && !asleep) {          // 2 мин без действий — засыпает до первого действия
          await run('sleep', my);
          if (busy(my)) return;
        } else {
          let name = 'peck';
          const legal = onCorner() && perchSpot(B.x, false, null);   // с насеста — на свободное место, как только оно есть
          if (legal) name = 'perch';
          else {
            if (!bag.length) { bag = [...new Set(LIFE)].sort(() => Math.random() - .5); if (bag[0] === lastScene) bag.push(bag.shift()); }
            for (let k = 0; k < bag.length; k++) if (canScene(bag[k])) { name = bag.splice(k, 1)[0]; break; }
          }
          lastScene = name;
          if (name === 'perch') { await run('perch', my, legal); if (busy(my)) return; continue; }
          await run(name, my, name === 'button' ? Math.random() < .5 : undefined);
          if (busy(my)) return;
        }
        if (P.name !== 'idle') play('idle', 0, ACT.idle.frames - 1, { loop: true });
        setState('idle');
        const rest = lite ? 8000 + Math.random() * 12000 : 4000 + Math.random() * 6000;   // ≤ 20 с — меньше сторожа idle
        if (!await idleFor(rest, my)) return;
      }
    }

    // ---------- кадр ----------
    let last = performance.now(), moved = false;
    function follow() {                                        // страница сдвинулась: голубь, зёрна и помёт едут со своими кромками
      refreshRects();
      if (B.fly) { const n = trackG(B.fly.g1); if (n) B.fly.g1 = n; else { const q = perchSpot(B.fly.x, true); if (q) { B.fly.x1 = q.x; B.fly.g1 = q.g; } } }
      else if (B.g) { const n = trackG(B.g); if (n) { B.g = n; B.lost = false; } else B.lost = true; }
      for (const b of bits.slice()) { const n = trackG(b.g); if (!n) { removeBit(b, true); continue; } const dy = n.y - b.g.y; b.y += dy; b.gy += dy; b.g = n; }
      for (const o of poops.slice()) { const n = trackG(o.g); if (!n) { removePoop(o, true); continue; } o.g = n; placePoop(o); }
    }
    function step(dt) {
      if (moved || clock - rectsAt > 1500) { moved = false; follow(); }
      if (B.fly) {                                             // в воздухе
        flyStep();
        if (Math.abs(B.yawTo - B.yaw) > .01) B.yaw += Math.sign(B.yawTo - B.yaw) * Math.min(Math.abs(B.yawTo - B.yaw), dt * 4.2);
        root.rotation.y = B.yaw; show(true); return;
      }
      // кромка ушла с экрана или место заняли — виден: перелетает (при прокрутке — на низ окна); не виден — пересаживается
      if (B.shown && !B.moving && B.g && (B.lost || !free(B.x, B.g))) {
        const q = perchSpot(B.x, B.lost, null) || (B.g.corner ? null : { x: cornerG().x, g: cornerG() });
        if (q) { interrupt('perch', q); return; }
      }
      if (B.moving) { root.rotation.y = B.yaw; return; }
      if (!B.g || B.lost || !free(B.x, B.g)) {                 // не виден (старт, размер окна) — пересаживается; места нет — насест
        if (B.shown) { show(false); B.reseat = clock + 380; return; }
        if (clock < B.reseat) return;
        const p = spot(B.x, B.g ? B.g.y : innerHeight) || { x: cornerG().x, g: cornerG() };
        B.k = p.g.corner ? CORNER_K() : 1;
        if (!p) { B.reseat = clock + 1200; return; }
        B.x = p.x; B.g = p.g; B.lost = false; if (B.walk) { const w = B.walk; B.walk = null; w.r(false); }
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
      if ((lite || nowClock() - poked > 15000) && now - last < 30) { if (!reduced && !document.hidden) raf = requestAnimationFrame(frame); return; }   // лёгкий режим и покой: ~30 кадров/с
      try {
        const dt = Math.min(.05, (now - last) / 1000); last = now;
        const t1 = performance.now();
        clock += dt * 1000;
        if (S) {
          step(dt);
          stepPlayer(dt);
          stepBits(dt);
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
    const settle = () => { refreshRects(); clearBits(); B.g = null; if (B.walk) { const w = B.walk; B.walk = null; w.r(false); } if (reduced) still(); else wake(); };
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
      } else { freeze(false); moved = true; wake(); resume(); }
    });
    on(window, 'resize', () => { try { fit(); settle(); } catch (e) { fail(e); } });
    on(window, 'scroll', () => {                               // прокрутка — голубь едет со своей кромкой, ушла — перелетает
      poked = nowClock();
      if (reduced) { try { follow(); if (B.lost || !free(B.x, B.g)) still(); else place(); } catch (e) { fail(e); } return; }
      moved = true; wake();
    }, { passive: true, capture: true });
    offs.push(() => clearTimeout(scrollT));
    let dimT = 0, dimmed = false;
    on(document, 'mousemove', e => {
      if (!B.g || !B.g.corner || B.fly || !B.shown) { if (dimmed) { dimmed = false; layer.style.opacity = ''; } return; }
      const k = B.k, gy = B.g.y, pad = 24;
      const inside = e.clientX > B.x - S * .36 * k - pad && e.clientX < B.x + S * .36 * k + pad && e.clientY > gy - S * .72 * k - pad && e.clientY < gy + pad;
      if (inside) { clearTimeout(dimT); dimT = 0; if (!dimmed) { dimmed = true; layer.style.transition = 'opacity .18s'; layer.style.opacity = .25; } }
      else if (dimmed && !dimT) dimT = setTimeout(() => { dimT = 0; dimmed = false; layer.style.transition = 'opacity .4s'; layer.style.opacity = ''; }, 1000);
    }, { passive: true });
    offs.push(() => clearTimeout(dimT));
    on(document, 'fx-lite', () => { try { lite = true; fit(); wake(); } catch (e) { fail(e); } });   // лёгкий режим включился позже

    // ---------- события страницы ----------
    // простой 60 с — стучит в стекло; ещё 45 с без действий — засыпает; первое действие — просыпается
    let idleGen = 0;
    const react = {
      pasted: () => interrupt('look'),
      reconciled: d => interrupt(d && d.allOk ? 'coo' : 'look'),
      numbersSent: d => interrupt(d && d.undo ? 'hop' : 'feed', d),   // отмена — просто подскок
      copied: () => interrupt('eat'),
      tab: () => refreshRects(),
      cleared: () => interrupt('shake'),
      idle: () => {},                                          // простой: сцены идут своим чередом, сон — после 2 мин без действий
      active: () => { idleGen++; if (asleep) rouse(); },
      soundMode: d => { if (d && d.mode) modeNow = d.mode; },
    };
    if (events && events.on) {
      for (const [name, fn] of Object.entries(react)) {
        try {
          const off = events.on(name, d => { setTimeout(() => { if (alive && !reduced) { try { if (name !== 'idle') poked = nowClock(); if (HEARD_ON[name]) heardUntil = nowClock() + HEARD; refreshRects(); fn(d); wake(); } catch (e) { fail(e); } } else if (alive && reduced && name === 'soundMode') fn(d); }, 60); });
          if (typeof off === 'function') offs.push(off);
        } catch (e) { /* ничего */ }
      }
    }

    // ---------- для проверок (отдел «Качество») ----------
    window.SverkaArkadiy = {
      states: STATES.slice(),
      state: () => now_,
      feed: n => { if (reduced || !alive) return false; interrupt('feed', { n: n || 6 }); return true; },   // как после «Вписать»
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
        if (name === 'fly') { interrupt('fly'); return true; }
        interrupt(name, name === 'button' ? true : undefined); return true;
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
