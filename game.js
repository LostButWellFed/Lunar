/*
  LUNAR · Lost, But Well Fed
  An Atari 1979 style lander. Land softly next to the street food.
  A soft landing refuels you ("well fed"). Run out of fuel and you are "Lost."

  Pad multipliers reward how hard the landing spot is (narrow pad = more points).
  They never rank the stand or the food.

  Everything below the CONFIG block is engine. Edit CONFIG to add worlds, stands and lines.
*/
(function () {
  "use strict";

  /* ================= CONFIG ================= */
  var LINKS = {
    arrivals: "https://lostbutwellfed.github.io/Department-of-Arrivals/",
    essays: "https://lostbutwellfed.com",
    utm: "utm_source=lunar_game&utm_medium=game"
  };

  var STANDS = {
    taco: {
      name: "Taco Stand", img: "stand-taco.png", w: 50,
      lines: [
        "Two tacos de guisado. The taquero did not ask where I had parked.",
        "Chicharrón en salsa verde, eaten standing up. Every stool was taken.",
        "The tortilla was warm before I had my helmet off."
      ]
    },
    papas: {
      name: "Papas Cart", img: "stand-papas.png", w: 21,
      lines: [
        "A bag of papas with Valentina and lime. The bag was see-through by the second step.",
        "Papas, extra chile. He had the bag open before I asked."
      ]
    },
    milktea: {
      name: "Milk Tea Stand", img: "stand-milktea.png", w: 54,
      lines: [
        "Milk tea, strong, in a heavy glass. It came without a saucer and without a smile.",
        "A pineapple bun with a slab of cold butter inside. Nobody had cut it for me."
      ]
    }
  };

  var WORLDS = [
    {
      name: "Luna Taquera", sub: "Grey dust · normal gravity",
      gravity: 9.5, sky: ["#000000", "#07070d"], nebula: [110, 130, 220],
      ground: [150, 150, 154], groundDark: [96, 96, 102], rim: "#f3ede2",
      feature: "earth", stands: ["taco", "papas", "taco"]
    },
    {
      name: "Milk Tea Nebula", sub: "Caramel dust · lighter gravity",
      gravity: 7.5, sky: ["#0b0412", "#2b0f35"], skyTint: ["rgba(45,10,70,0.55)", "rgba(110,35,100,0.45)"], groundTint: "rgb(222,176,128)", nebula: [235, 120, 185],
      ground: [201, 164, 124], groundDark: [138, 101, 70], rim: "#fff1dc",
      feature: "pearl", stands: ["milktea", "milktea", "milktea"]
    }
  ];
  // Every landing OR crash moves you to the next stop, in this order, then loops.
  var SEQUENCE = [
    { stand: "taco", world: 0 },
    { stand: "milktea", world: 1 },
    { stand: "papas", world: 0 }
  ];

  var CRASH_LINES = [
    "I arrived the way I usually arrive. Too fast.",
    "Everybody saw it. Nobody stopped cooking.",
    "The lander was a write-off. The kitchen kept working.",
    "Wrong angle. The cook looked up once and went back to the grill."
  ];
  var KITCHEN_LINE = "I landed on the kitchen. Nobody applauded.";

  var PHYS = {
    thrust: 38,          // units/s² at full thrust
    rotSpeed: 95,       // degrees per second
    maxAngle: 95,
    fuelStart: 1500,
    burn: 28,            // fuel per second of thrust
    refuelSoft: 300,     // "well fed"
    refuelHard: 180,
    crashCost: 100,
    softVy: 32, softVx: 20,
    hardVy: 50, hardVx: 30,
    maxLandAngle: 28
  };
  var PADS = [ { mult: 2, w: 210 }, { mult: 3, w: 175 }, { mult: 5, w: 140 } ];
  var WORLD_W = 2400, WORLD_H = 1000;
  var SHIP_W = 70;       // world units; height follows the image ratio
  var ASTRO_H = 30;   // lander 70 wide : astronaut 30 tall, same ratio as the reference line-up

  /* ================= SETUP ================= */
  var $ = function (id) { return document.getElementById(id); };
  var cv = $("cv"), ctx = cv.getContext("2d");
  var isTouch = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  if (isTouch) document.body.classList.add("touch");

  var IMG = {};
  function loadImg(key, src) { var i = new Image(); i.src = src; IMG[key] = i; }
  loadImg("lander", "lander.png");
  loadImg("astro", "astronaut.png");
  loadImg("space", "space.jpg");
  loadImg("floor", "moon-floor.jpg");
  Object.keys(STANDS).forEach(function (k) { loadImg(k, STANDS[k].img); });

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("lbwf_lunar_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("lbwf_lunar_" + k, JSON.stringify(v)); } catch (e) {} }
  };

  var W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    makeStars();
  }
  window.addEventListener("resize", resize);

  /* ================= AUDIO (all generated, no files) ================= */
  var Snd = (function () {
    var ac = null, master, thrustGain, on = store.get("sound", true);
    function init() {
      if (ac) return;
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.gain.value = on ? 0.9 : 0; master.connect(ac.destination);
        var len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
        var last = 0;
        for (var i = 0; i < len; i++) { var w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        var src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
        var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520;
        thrustGain = ac.createGain(); thrustGain.gain.value = 0;
        src.connect(lp); lp.connect(thrustGain); thrustGain.connect(master); src.start();
      } catch (e) { ac = null; }
    }
    function tone(freq, t0, dur, type, vol) {
      if (!ac) return;
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type || "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0, ac.currentTime + t0);
      g.gain.linearRampToValueAtTime(vol || 0.25, ac.currentTime + t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t0 + dur);
      o.connect(g); g.connect(master); o.start(ac.currentTime + t0); o.stop(ac.currentTime + t0 + dur + 0.05);
    }
    return {
      init: init,
      thrust: function (level) { if (ac && thrustGain) thrustGain.gain.setTargetAtTime(level * 0.55, ac.currentTime, 0.05); },
      land: function () { tone(659, 0, 0.25, "triangle", 0.25); tone(880, 0.12, 0.4, "triangle", 0.25); tone(1319, 0.26, 0.6, "sine", 0.15); },
      hard: function () { tone(330, 0, 0.3, "triangle", 0.3); tone(494, 0.12, 0.4, "triangle", 0.2); },
      crash: function () {
        if (!ac) return;
        var len = ac.sampleRate * 1.2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
        var s = ac.createBufferSource(); s.buffer = buf;
        var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(2400, ac.currentTime); lp.frequency.exponentialRampToValueAtTime(120, ac.currentTime + 1.1);
        var g = ac.createGain(); g.gain.value = 0.9;
        s.connect(lp); lp.connect(g); g.connect(master); s.start();
        tone(70, 0, 0.6, "sine", 0.6);
      },
      beep: function () { tone(988, 0, 0.09, "square", 0.08); },
      toggle: function () { on = !on; store.set("sound", on); if (master) master.gain.value = on ? 0.9 : 0; return on; },
      isOn: function () { return on; }
    };
  })();

  /* ================= INPUT ================= */
  var keys = { left: false, right: false, thrust: false };
  function bindHold(el, k) {
    var down = function (e) { e.preventDefault(); Snd.init(); keys[k] = true; el.classList.add("on"); };
    var up = function (e) { if (e) e.preventDefault(); keys[k] = false; el.classList.remove("on"); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("pointerleave", up);
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }
  bindHold($("bLeft"), "left"); bindHold($("bRight"), "right"); bindHold($("bThrust"), "thrust");
  var KEYMAP = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "thrust", KeyW: "thrust", Space: "thrust" };
  window.addEventListener("keydown", function (e) {
    if (state === "result" && (e.code === "Space" || e.code === "Enter")) { e.preventDefault(); $("rNext").click(); return; }
    if (state === "title" && (e.code === "Space" || e.code === "Enter")) { e.preventDefault(); $("startBtn").click(); return; }
    if (e.code === "KeyM") { toggleSound(); return; }
    var k = KEYMAP[e.code]; if (k) { e.preventDefault(); Snd.init(); keys[k] = true; }
  });
  window.addEventListener("keyup", function (e) { var k = KEYMAP[e.code]; if (k) keys[k] = false; });
  window.addEventListener("blur", function () { keys.left = keys.right = keys.thrust = false; });

  function toggleSound() { Snd.init(); var on = Snd.toggle(); $("soundBtn").textContent = on ? "SOUND ON" : "SOUND OFF"; }
  $("soundBtn").addEventListener("click", toggleSound);
  $("soundBtn").textContent = Snd.isOn() ? "SOUND ON" : "SOUND OFF";

  /* ================= GAME STATE ================= */
  var state = "title";          // title | flying | walking | crashing | result
  var run, ship, terrain, pads, world, cam, particles = [], astro = null, stars = [], bannerTimer = 0;
  var groundPattern = null, lowFuelTimer = 0, skyTile = null, roundStand = "taco";

  function newRun() {
    run = { score: 0, fuel: PHYS.fuelStart, time: 0, meals: 0, round: 0, lastWorld: -1 };
    newRound();
  }

  function stopAt(r) { return SEQUENCE[r % SEQUENCE.length]; }
  function worldIndex() { return stopAt(run.round).world; }
  function cycle() { return Math.floor(run.round / SEQUENCE.length); }

  function newRound() {
    var wi = worldIndex();
    world = WORLDS[wi];
    world.g = world.gravity * (1 + 0.05 * Math.min(cycle(), 4));
    roundStand = stopAt(run.round).stand;
    if (wi !== run.lastWorld) { groundPattern = makeGroundPattern(world); run.lastWorld = wi; }
    showBanner(STANDS[roundStand].name, world.name);
    buildTerrain();
    ship = { x: 140 + Math.random() * 200, y: 110, vx: 12 + Math.random() * 12, vy: 0, a: -90, thr: 0, dead: false };
    ship.a = 0;
    particles = []; astro = null;
    cam = { x: ship.x, y: WORLD_H / 2, z: 1 };
    state = "flying";
    showPlayUI(true);
  }

  /* ---------- terrain ---------- */
  function buildTerrain() {
    var step = 26, xs = [], ys = [];
    var p1 = Math.random() * 6, p2 = Math.random() * 6, p3 = Math.random() * 6;
    for (var x = 0; x <= WORLD_W; x += step) {
      var t = x / WORLD_W;
      var y = 760 + 110 * Math.sin(t * 6.3 + p1) + 60 * Math.sin(t * 17 + p2) + 26 * Math.sin(t * 41 + p3) + (Math.random() - 0.5) * 36;
      xs.push(x); ys.push(Math.max(540, Math.min(960, y)));
    }
    // pads with a stand beside each one
    var order = PADS.slice().sort(function () { return Math.random() - 0.5; });
    var slots = [0.2, 0.5, 0.8];
    pads = [];
    order.forEach(function (p, i) {
      var standKey = roundStand;
      var sw = STANDS[standKey].w;
      var cx = WORLD_W * slots[i] + (Math.random() - 0.5) * 160;
      var standRight = Math.random() < 0.5;
      var total = p.w + 14 + sw + 16;
      var x0 = cx - total / 2, x1 = cx + total / 2;
      var y = interp(xs, ys, cx);
      y = Math.max(640, Math.min(900, y));
      var padX0 = standRight ? x0 + 8 : x1 - 8 - p.w;
      var standX0 = standRight ? padX0 + p.w + 14 : x0 + 8;
      pads.push({ x0: padX0, x1: padX0 + p.w, y: y, mult: p.mult, flat0: x0, flat1: x1,
        stand: { key: standKey, x0: standX0, w: sw, h: 0 } });
    });
    // flatten: rebuild point list with exact flat segments
    var nx = [], ny = [];
    for (var i = 0; i < xs.length; i++) {
      var inside = pads.some(function (p) { return xs[i] >= p.flat0 && xs[i] <= p.flat1; });
      if (!inside) { nx.push(xs[i]); ny.push(ys[i]); }
    }
    pads.forEach(function (p) { nx.push(p.flat0, p.flat1); ny.push(p.y, p.y); });
    var idx = nx.map(function (_, i) { return i; }).sort(function (a, b) { return nx[a] - nx[b]; });
    terrain = { xs: idx.map(function (i) { return nx[i]; }), ys: idx.map(function (i) { return ny[i]; }) };
  }
  function interp(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    for (var i = 1; i < xs.length; i++) {
      if (x <= xs[i]) { var t = (x - xs[i - 1]) / ((xs[i] - xs[i - 1]) || 1); return ys[i - 1] + t * (ys[i] - ys[i - 1]); }
    }
    return ys[ys.length - 1];
  }
  function groundAt(x) { return interp(terrain.xs, terrain.ys, x); }

  /* ---------- procedural art ---------- */
  function makeGroundPattern(w) {
    var f = IMG.floor;
    if (f.complete && f.naturalWidth) {
      var c2 = document.createElement("canvas"); c2.width = f.naturalWidth; c2.height = f.naturalHeight;
      var g2 = c2.getContext("2d"); g2.drawImage(f, 0, 0);
      if (w.groundTint) {
        g2.globalCompositeOperation = "multiply"; g2.fillStyle = w.groundTint; g2.fillRect(0, 0, c2.width, c2.height);
        g2.globalCompositeOperation = "destination-in"; g2.drawImage(f, 0, 0);
      }
      var pat = ctx.createPattern(c2, "repeat");
      // one mirrored strip spans the world; stretched down so craters read at lander scale
      var sx = (WORLD_W * 1.3) / c2.width, sy = 580 / c2.height;
      if (pat.setTransform && window.DOMMatrix) pat.setTransform(new DOMMatrix([sx, 0, 0, sy, 0, 520]));
      return pat;
    }
    var c = document.createElement("canvas"); c.width = c.height = 256;
    var g = c.getContext("2d");
    var b = w.ground, d = w.groundDark;
    g.fillStyle = "rgb(" + b + ")"; g.fillRect(0, 0, 256, 256);
    for (var i = 0; i < 2600; i++) {
      var s = Math.random();
      var col = s < 0.5 ? d : [Math.min(255, b[0] + 30), Math.min(255, b[1] + 30), Math.min(255, b[2] + 30)];
      g.fillStyle = "rgba(" + col + "," + (0.12 + Math.random() * 0.3) + ")";
      g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    for (var k = 0; k < 14; k++) {
      var x = Math.random() * 256, y = Math.random() * 256, r = 4 + Math.random() * 20;
      for (var ox = -256; ox <= 256; ox += 256) for (var oy = -256; oy <= 256; oy += 256) {
        g.fillStyle = "rgba(" + d + ",0.55)";
        g.beginPath(); g.ellipse(x + ox, y + oy, r, r * 0.55, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineWidth = 1.5;
        g.beginPath(); g.ellipse(x + ox, y + oy + 1.5, r, r * 0.55, 0, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
      }
    }
    return ctx.createPattern(c, "repeat");
  }

  function makeStars() {
    stars = [];
    var n = Math.round((W * H) / 2600);
    for (var i = 0; i < n; i++) stars.push({ x: Math.random() * W * 1.3, y: Math.random() * H, r: Math.random() < 0.9 ? Math.random() * 1.1 + 0.3 : 1.6 + Math.random(), p: Math.random() * 6 });
  }

  /* ================= LOOP ================= */
  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.033, (now - last) / 1000); last = now;
    update(dt); draw(now / 1000);
    requestAnimationFrame(frame);
  }

  function shipH() { var i = IMG.lander; return i.naturalWidth ? SHIP_W * i.naturalHeight / i.naturalWidth : SHIP_W * 0.87; }

  // collision points in ship space (x right, y down), as fractions of width/height
  var FEET = [[-0.40, 0.49], [0.42, 0.47]];
  var BODY = [[-0.30, 0.18], [0.30, 0.18], [0, -0.46], [-0.36, -0.12], [0.36, -0.12], [0, 0.30]];
  function toWorld(pt) {
    var h = shipH(), a = ship.a * Math.PI / 180, lx = pt[0] * SHIP_W, ly = pt[1] * h;
    return { x: ship.x + lx * Math.cos(a) - ly * Math.sin(a), y: ship.y + lx * Math.sin(a) + ly * Math.cos(a) };
  }

  function update(dt) {
    if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) $("worldBanner").classList.remove("on"); }
    updateParticles(dt);

    if (state === "flying") {
      run.time += dt;
      if (keys.left) ship.a -= PHYS.rotSpeed * dt;
      if (keys.right) ship.a += PHYS.rotSpeed * dt;
      ship.a = Math.max(-PHYS.maxAngle, Math.min(PHYS.maxAngle, ship.a));
      // landing assist: with no rotate input the lander levels itself and sideways drift fades
      if (!keys.left && !keys.right) ship.a -= ship.a * Math.min(1, dt * 1.6);
      ship.vx -= ship.vx * Math.min(1, dt * 0.25);
      var thrusting = keys.thrust && run.fuel > 0;
      ship.thr += ((thrusting ? 1 : 0) - ship.thr) * Math.min(1, dt * 14);
      if (thrusting) run.fuel = Math.max(0, run.fuel - PHYS.burn * dt);
      Snd.thrust(ship.thr);
      var a = ship.a * Math.PI / 180;
      ship.vx += Math.sin(a) * PHYS.thrust * ship.thr * dt;
      ship.vy += (world.g - Math.cos(a) * PHYS.thrust * ship.thr) * dt;
      ship.x += ship.vx * dt; ship.y += ship.vy * dt;
      if (ship.x < 30) { ship.x = 30; ship.vx = Math.abs(ship.vx) * 0.3; }
      if (ship.x > WORLD_W - 30) { ship.x = WORLD_W - 30; ship.vx = -Math.abs(ship.vx) * 0.3; }
      if (ship.y < -150) { ship.y = -150; ship.vy = Math.max(0, ship.vy); }

      // exhaust dust near the ground
      if (ship.thr > 0.3) {
        var noz = toWorld([0, 0.42]);
        var gy = groundAt(noz.x);
        if (gy - noz.y < 90) for (var i = 0; i < 2; i++) particles.push({ x: noz.x + (Math.random() - 0.5) * 20, y: gy - 2, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 25, life: 0.9, max: 0.9, r: 2 + Math.random() * 3, c: world.ground, dust: true });
      }

      if (run.fuel > 0 && run.fuel < 150) { lowFuelTimer -= dt; if (lowFuelTimer <= 0) { Snd.beep(); lowFuelTimer = 0.9; } }

      checkContact();
    } else {
      Snd.thrust(0);
    }

    if (state === "walking" && astro) {
      var dir = Math.sign(astro.tx - astro.x);
      astro.x += dir * 22 * dt; astro.t += dt;
      astro.face = dir;
      if (Math.abs(astro.tx - astro.x) < 2) { astro.x = astro.tx; state = "arrived"; setTimeout(function () { showLanded(astro.result); }, 450); }
    }

    // camera, Atari style: zoom in near the ground
    if (ship) {
      var alt = groundAt(ship.x) - (ship.y + shipH() / 2);
      var zt = (state === "flying" && alt > 170) ? 1 : 1.9;
      cam.z += (zt - cam.z) * Math.min(1, dt * 2.2);
      var base = baseScale(), s = base * cam.z;
      var focusX = astro && state !== "flying" ? (ship.x + astro.x) / 2 : ship.x;
      var tx = focusX, ty = cam.z > 1.2 ? ship.y + 40 : WORLD_H / 2;
      var halfW = W / s / 2, halfH = H / s / 2;
      tx = Math.max(halfW, Math.min(WORLD_W - halfW, tx));
      ty = Math.max(halfH - 150, Math.min(WORLD_H + 40 - halfH, ty));
      cam.x += (tx - cam.x) * Math.min(1, dt * 5);
      cam.y += (ty - cam.y) * Math.min(1, dt * 3.5);
      updateHUD(alt);
    }
  }

  function baseScale() { return Math.min(H / 1040, W / 640); }

  function checkContact() {
    var feet = FEET.map(toWorld), body = BODY.map(toWorld);
    // stand collision (landing on the kitchen)
    for (var p = 0; p < pads.length; p++) {
      var st = pads[p].stand, img = IMG[st.key];
      var sh = img.naturalWidth ? st.w * img.naturalHeight / img.naturalWidth : st.w;
      var pts = feet.concat(body);
      for (var q = 0; q < pts.length; q++) {
        if (pts[q].x > st.x0 + 4 && pts[q].x < st.x0 + st.w - 4 && pts[q].y > pads[p].y - sh * 0.92 && pts[q].y < pads[p].y) { crash(KITCHEN_LINE); return; }
      }
    }
    for (var i = 0; i < body.length; i++) if (body[i].y >= groundAt(body[i].x)) { crash(); return; }
    var touching = feet.some(function (f) { return f.y >= groundAt(f.x) - 0.5; });
    if (!touching) return;

    var pad = pads.filter(function (pd) { return feet.every(function (f) { return f.x >= pd.x0 - 2 && f.x <= pd.x1 + 2; }); })[0];
    var vy = ship.vy, vx = Math.abs(ship.vx), ang = Math.abs(ship.a);
    if (!pad || ang > PHYS.maxLandAngle) { crash(); return; }
    if (vy <= PHYS.softVy && vx <= PHYS.softVx) return land(pad, "soft");
    if (vy <= PHYS.hardVy && vx <= PHYS.hardVx) return land(pad, "hard");
    crash();
  }

  function land(pad, kind) {
    var h = shipH();
    ship.y = pad.y - h * 0.48; ship.vx = ship.vy = 0; ship.a = 0; ship.thr = 0;
    var pts = (kind === "soft" ? 50 : 15) * pad.mult;
    var fuel = kind === "soft" ? PHYS.refuelSoft : PHYS.refuelHard;
    run.score += pts; run.fuel = Math.min(PHYS.fuelStart * 1.5, run.fuel + fuel); run.meals += 1;
    kind === "soft" ? Snd.land() : Snd.hard();
    var st = pad.stand, towardStand = st.x0 + st.w / 2 > ship.x ? 1 : -1;
    var lines = STANDS[st.key].lines;
    astro = {
      x: ship.x + towardStand * SHIP_W * 0.25, y: pad.y, t: 0, face: towardStand,
      tx: towardStand > 0 ? st.x0 + st.w * 0.3 : st.x0 + st.w * 0.7,
      result: { kind: kind, mult: pad.mult, pts: pts, fuel: fuel, line: lines[Math.floor(Math.random() * lines.length)] }
    };
    state = "walking";
  }

  function crash(line) {
    state = "crashing"; ship.dead = true; ship.thr = 0;
    Snd.crash();
    for (var i = 0; i < 70; i++) {
      var a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 160;
      particles.push({ x: ship.x, y: ship.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 1.6 + Math.random(), max: 2.4, r: 1.5 + Math.random() * 3.5,
        c: Math.random() < 0.5 ? [255, 170, 60] : (Math.random() < 0.5 ? [200, 160, 60] : [180, 180, 185]), g: true });
    }
    for (var j = 0; j < 30; j++) particles.push({ x: ship.x + (Math.random() - 0.5) * 30, y: ship.y, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 30, life: 2.5, max: 2.5, r: 6 + Math.random() * 10, c: [80, 80, 86], smoke: true });
    run.fuel = Math.max(0, run.fuel - PHYS.crashCost);
    var ln = line || CRASH_LINES[Math.floor(Math.random() * CRASH_LINES.length)];
    setTimeout(function () { showCrash(ln); }, 1300);
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      if (p.g) p.vy += (world ? world.g : 20) * 2 * dt;
      if (p.smoke) { p.r += dt * 8; p.vx *= 0.98; }
      if (p.dust) p.vy += 10 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.g && terrain) { var gy = groundAt(p.x); if (p.y > gy) { p.y = gy; p.vy *= -0.3; p.vx *= 0.6; } }
    }
  }

  /* ================= DRAW ================= */
  function draw(t) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var sky = world ? world.sky : WORLDS[0].sky;
    var gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, sky[0]); gr.addColorStop(1, sky[1]);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    if (!world || !terrain) return;

    var s = baseScale() * cam.z;
    var par = (cam.x * s * 0.04) % (W * 0.3);

    // star photo, mirrored and tiled, slow parallax
    var sp = IMG.space;
    if (sp.complete && sp.naturalWidth) {
      if (!skyTile) {
        skyTile = document.createElement("canvas"); skyTile.width = sp.naturalWidth * 2; skyTile.height = sp.naturalHeight;
        var sg = skyTile.getContext("2d"); sg.drawImage(sp, 0, 0);
        sg.save(); sg.translate(skyTile.width, 0); sg.scale(-1, 1); sg.drawImage(sp, 0, 0); sg.restore();
      }
      var sc = Math.max(H / skyTile.height, W / skyTile.width) * 1.02, tw = skyTile.width * sc;
      var off = -((cam.x * s * 0.05) % tw);
      for (var tx0 = off; tx0 < W; tx0 += tw) ctx.drawImage(skyTile, tx0, 0, tw, skyTile.height * sc);
    }
    if (world.skyTint) {
      var tg = ctx.createLinearGradient(0, 0, 0, H);
      tg.addColorStop(0, world.skyTint[0]); tg.addColorStop(1, world.skyTint[1]);
      ctx.fillStyle = tg; ctx.fillRect(0, 0, W, H);
    }
    drawComet(t);
    if (world.feature === "earth") drawEarth(W * 0.8 - par * 0.3, H * 0.17, Math.min(W, H) * 0.06);
    else drawPearl(W * 0.78 - par * 0.3, H * 0.2, Math.min(W, H) * 0.09);

    // world transform
    ctx.setTransform(DPR * s, 0, 0, DPR * s, DPR * (W / 2 - cam.x * s), DPR * (H / 2 - cam.y * s));

    // terrain
    var xs = terrain.xs, ys = terrain.ys;
    ctx.beginPath(); ctx.moveTo(xs[0], WORLD_H + 600);
    for (var k = 0; k < xs.length; k++) ctx.lineTo(xs[k], ys[k]);
    ctx.lineTo(xs[xs.length - 1], WORLD_H + 600); ctx.closePath();
    ctx.fillStyle = groundPattern; ctx.fill();
    // depth shading
    var sh = ctx.createLinearGradient(0, 560, 0, WORLD_H + 300);
    sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = sh; ctx.fill();
    ctx.beginPath(); ctx.moveTo(xs[0], ys[0]);
    for (k = 1; k < xs.length; k++) ctx.lineTo(xs[k], ys[k]);
    ctx.strokeStyle = world.rim; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.6 / cam.z; ctx.stroke(); ctx.globalAlpha = 1;

    // pads and stands
    pads.forEach(function (p) {
      var img = IMG[p.stand.key];
      if (img.naturalWidth) {
        var hh = p.stand.w * img.naturalHeight / img.naturalWidth;
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath(); ctx.ellipse(p.stand.x0 + p.stand.w / 2, p.y, p.stand.w * 0.55, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.drawImage(img, p.stand.x0, p.y - hh + 2, p.stand.w, hh);
      }
      ctx.fillStyle = "#e3261c"; ctx.fillRect(p.x0, p.y - 1.5, p.x1 - p.x0, 4);
      ctx.fillStyle = "#f3ede2";
      ctx.font = "700 " + Math.round(14) + "px 'Space Mono', monospace"; ctx.textAlign = "center";
      ctx.fillText("x" + p.mult, (p.x0 + p.x1) / 2, p.y + 20);
    });

    // particles behind ship
    particles.forEach(function (p) {
      var al = Math.max(0, p.life / p.max);
      ctx.fillStyle = "rgba(" + p.c + "," + (p.smoke ? al * 0.35 : p.dust ? al * 0.5 : al) + ")";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    });

    // ship
    if (!ship.dead) {
      var h = shipH();
      ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(ship.a * Math.PI / 180);
      if (ship.thr > 0.05) {
        var fl = (16 + Math.random() * 12) * ship.thr, ny = h * 0.30;
        var fg = ctx.createLinearGradient(0, ny, 0, ny + fl + 10);
        fg.addColorStop(0, "rgba(255,245,200,0.95)"); fg.addColorStop(0.35, "rgba(255,160,60,0.9)"); fg.addColorStop(1, "rgba(227,38,28,0)");
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.moveTo(-6, ny); ctx.quadraticCurveTo(0, ny + fl * 1.3, 6, ny); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(255,190,90,0.18)"; ctx.beginPath(); ctx.arc(0, ny + 6, 14 * ship.thr, 0, Math.PI * 2); ctx.fill();
      }
      if (IMG.lander.naturalWidth) ctx.drawImage(IMG.lander, -SHIP_W / 2, -h / 2, SHIP_W, h);
      ctx.restore();
    }

    // astronaut
    if (astro && IMG.astro.naturalWidth) {
      var ah = ASTRO_H, aw = ah * IMG.astro.naturalWidth / IMG.astro.naturalHeight;
      var bob = state === "walking" ? Math.abs(Math.sin(astro.t * 7)) * 1.6 : 0;
      ctx.save(); ctx.translate(astro.x, astro.y - bob);
      if (astro.face > 0) ctx.scale(-1, 1);       // the photo faces left
      ctx.rotate(state === "walking" ? Math.sin(astro.t * 7) * 0.05 : 0);
      ctx.drawImage(IMG.astro, -aw / 2, -ah, aw, ah);
      ctx.restore();
    }
  }

  function drawGlow(x, y, r, c) { var g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, c); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  function drawGalaxy(x, y, r) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.4); ctx.scale(1, 0.42);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, "rgba(255,245,230,0.9)"); g.addColorStop(0.15, "rgba(180,200,255,0.55)"); g.addColorStop(0.6, "rgba(90,110,220,0.18)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function drawComet(t) {
    var p = (t * 0.012) % 1.4, x = W * (0.25 + p * 0.5), y = H * (0.2 + p * 0.06);
    if (p > 1) return;
    var g = ctx.createLinearGradient(x - 120, y - 16, x, y);
    g.addColorStop(0, "rgba(243,237,226,0)"); g.addColorStop(1, "rgba(243,237,226,0.55)");
    ctx.strokeStyle = g; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 120, y - 16); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = "#ff8a3a"; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  function drawEarth(x, y, r) {
    var g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, "#8fc4ff"); g.addColorStop(0.5, "#2f6fc2"); g.addColorStop(1, "#0d2a55");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(90,160,90,0.7)";
    ctx.beginPath(); ctx.ellipse(x - r * 0.2, y - r * 0.1, r * 0.35, r * 0.22, 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + r * 0.35, y + r * 0.3, r * 0.2, r * 0.3, -0.3, 0, Math.PI * 2); ctx.fill();
    var sh = ctx.createLinearGradient(x - r, y, x + r, y);
    sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(0.55, "rgba(0,0,0,0.1)"); sh.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    drawGlow(x, y, r * 1.6, "rgba(120,170,255,0.12)");
  }
  function drawPearl(x, y, r) {
    drawGlow(x, y, r * 1.8, "rgba(235,120,185,0.12)");
    var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
    g.addColorStop(0, "#8a5a44"); g.addColorStop(0.4, "#3a2016"); g.addColorStop(1, "#120806");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,240,230,0.55)"; ctx.beginPath(); ctx.ellipse(x - r * 0.38, y - r * 0.42, r * 0.18, r * 0.1, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,220,200,0.35)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.7, r * 0.32, -0.25, 0, Math.PI * 2); ctx.stroke();
  }

  /* ================= UI ================= */
  function pad4(n) { n = Math.round(n); return ("0000" + n).slice(-Math.max(4, String(n).length)); }
  function updateHUD(alt) {
    if (!run) return;
    $("hScore").textContent = pad4(run.score);
    var tt = Math.floor(run.time); $("hTime").textContent = Math.floor(tt / 60) + ":" + ("0" + (tt % 60)).slice(-2);
    $("hFuel").textContent = Math.round(run.fuel);
    $("hFuel").className = run.fuel < 150 ? "low" : "";
    var bar = $("hFuelBar"); bar.style.width = Math.min(100, run.fuel / PHYS.fuelStart * 100) + "%"; bar.style.background = run.fuel < 150 ? "var(--warn)" : "var(--cream)";
    $("hAlt").textContent = Math.max(0, Math.round(alt));
    var vx = Math.round(ship.vx), vy = Math.round(ship.vy);
    $("hVx").textContent = Math.abs(vx) + (vx > 0 ? " →" : vx < 0 ? " ←" : "  ");
    $("hVy").textContent = Math.abs(vy) + (vy > 0 ? " ↓" : vy < 0 ? " ↑" : "  ");
    $("hVx").style.color = Math.abs(vx) <= PHYS.softVx ? "var(--ok)" : "";
    $("hVy").style.color = vy <= PHYS.softVy ? "var(--ok)" : "";
    $("hMeals").textContent = run.meals;
  }
  function showPlayUI(on) {
    ["hud", "padL", "padR", "keys", "soundBtn"].forEach(function (id) { $(id).classList.toggle("hidden", !on); });
  }
  function showBanner(n, s) { $("wName").textContent = n; $("wSub").textContent = s; $("worldBanner").classList.add("on"); bannerTimer = 2.6; }
  function toast(m) { var t = $("toast"); t.textContent = m; t.classList.add("on"); setTimeout(function () { t.classList.remove("on"); }, 2000); }

  function stat(v, l) { return '<div class="stat"><b>' + v + "</b><span>" + l + "</span></div>"; }
  function openResult(o) {
    state = "result"; keys.left = keys.right = keys.thrust = false;
    $("rKicker").textContent = o.kicker; $("rKicker").className = "k" + (o.good ? " good" : "");
    $("rTitle").textContent = o.title; $("rLine").textContent = o.line;
    $("rStats").innerHTML = o.stats;
    $("rNext").textContent = o.next;
    ["rShare", "rArrivals", "rEssays"].forEach(function (id) { $(id).classList.toggle("hidden", !o.over); });
    $("result").classList.remove("hidden");
    $("padL").classList.add("hidden"); $("padR").classList.add("hidden");
  }
  function showLanded(r) {
    openResult({
      kicker: (r.kind === "soft" ? "Soft landing" : "Hard landing") + "  ·  x" + r.mult, good: r.kind === "soft",
      title: r.kind === "soft" ? "Well fed." : "Fed, and a bit shaken.", line: r.line,
      stats: stat("+" + r.pts, "points") + stat("+" + r.fuel, "fuel") + stat(run.meals, "meals"),
      next: "Next stop: " + STANDS[stopAt(run.round + 1).stand].name
    });
    run.round += 1;
  }
  function showCrash(line) {
    if (run.fuel <= 0) return gameOver();
    openResult({ kicker: "Crashed", title: "Not a landing.", line: line, stats: stat("-" + PHYS.crashCost, "fuel") + stat(Math.round(run.fuel), "fuel left"), next: "Next stop: " + STANDS[stopAt(run.round + 1).stand].name });
    run.round += 1;
  }
  function gameOver() {
    var best = store.get("best", 0), isBest = run.score > best;
    if (isBest) store.set("best", run.score);
    var meals = run.meals;
    openResult({
      kicker: isBest ? "New personal best" : "Out of fuel", good: isBest, over: true,
      title: "Lost.",
      line: meals ? "But well fed: " + meals + (meals === 1 ? " meal" : " meals") + " on the way down." : "Not even a taco.",
      stats: stat(pad4(run.score), "score") + stat(meals, "meals") + stat(pad4(Math.max(best, run.score)), "best"),
      next: "Play again"
    });
    run.over = true;
  }

  $("rNext").addEventListener("click", function () {
    $("result").classList.add("hidden");
    if (run.over) { newRun(); return; }
    if (run.fuel <= 0) { gameOver(); return; }
    newRound();
  });
  $("rShare").addEventListener("click", function () {
    var url = location.href.split("?")[0].split("#")[0];
    var text = "I ate " + run.meals + (run.meals === 1 ? " meal" : " meals") + " on the moon before running out of fuel. Score " + run.score + ". Lost, But Well Fed · Lunar";
    if (navigator.share) navigator.share({ title: "Lunar · Lost, But Well Fed", text: text, url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text + " " + url).then(function () { toast("Copied. Paste it anywhere."); });
  });
  $("rArrivals").href = LINKS.arrivals + "?" + LINKS.utm + "&utm_campaign=gameover";
  $("rEssays").href = LINKS.essays + "?" + LINKS.utm + "&utm_campaign=gameover";

  $("startBtn").addEventListener("click", function () {
    Snd.init();
    $("title").classList.add("hidden");
    newRun();
  });
  var b = store.get("best", 0);
  if (b) $("bestTitle").textContent = "Personal best " + pad4(b);

  window.LUNAR_DEBUG = function () { return { state: state, ship: ship, pads: pads, run: run, ground: groundAt, shipH: shipH() }; };
  resize();
  requestAnimationFrame(frame);
})();
