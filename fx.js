// 動く演出。scenes.json の layers に {"fx": "名前", ...} と書くと、その順番(奥→手前)で描かれる。
// 位置と大きさは画面に対する割合(0〜1)。t は秒、burst はシャッターからの秒(押していなければ null)。
const FX = (() => {
  const W = 1280, H = 720;
  let burstAt = -1, now = 0;
  const rnd = s => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  // シャッターからの時間は実時間で測る(「背景を動かす」をオフにしても弾けるように)
  const burst = () => (burstAt < 0 ? null : performance.now() / 1000 - burstAt);

  // ふわっとした丸(火・煙の粒)。半径 r、中心の色 c0 から外へ透明に
  function puff(ctx, x, y, r, c0, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c0.replace('A', a)); g.addColorStop(0.5, c0.replace('A', a * 0.5)); g.addColorStop(1, c0.replace('A', 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }

  // ───── 火球は「こぶ」の集まり。こぶ1個の絵を温度別に起動時に作っておき、毎フレーム並べ直す
  // 参考(本物の火球): 表面はほぼ白いクリーム色に、細かく渦巻く橙のくぼみ。縁の小さなこぶほど橙〜赤。黒煙は上に少しだけ
  const hashN = (x, y, z) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hashN(xi, yi, z), b = hashN(xi + 1, yi, z), c = hashN(xi, yi + 1, z), d = hashN(xi + 1, yi + 1, z);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, z, oct) { let s = 0, amp = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f, z); f *= 2.03; amp *= 0.5; } return s; }
  // 温度ごとの色(くぼみ → 盛り上がり)
  const TEMPS = {
    hot:   [[0, [232, 132, 48]], [0.28, [250, 186, 92]], [0.5, [255, 222, 156]], [0.7, [255, 240, 200]], [1, [255, 252, 240]]],
    mid:   [[0, [200, 82, 20]], [0.35, [238, 136, 50]], [0.65, [252, 190, 104]], [1, [255, 228, 170]]],
    cool:  [[0, [150, 44, 10]], [0.4, [214, 92, 26]], [0.75, [240, 140, 52]], [1, [252, 188, 100]]],
    smoke: [[0, [40, 26, 18]], [0.5, [78, 50, 34]], [1, [130, 84, 52]]],
  };
  function pal(P, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < P.length; i++) if (t <= P[i][0]) { const [t0, c0] = P[i - 1], [t1, c1] = P[i], k = (t - t0) / (t1 - t0); return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k]; }
    return P[P.length - 1][1];
  }
  function makeLobe(temp, seed, S = 256) {
    const cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d'), img = c.createImageData(S, S), d = img.data, P = TEMPS[temp];
    const R = []; for (let i = 0; i < 128; i++) { const a = i / 128 * Math.PI * 2; R.push(0.86 + 0.14 * (fbm(Math.cos(a) * 2 + 3, Math.sin(a) * 2 + 3, seed, 3) - 0.5) * 2); }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const px = x / S * 2 - 1, py = y / S * 2 - 1, r = Math.hypot(px, py), ang = (Math.atan2(py, px) + Math.PI * 2) % (Math.PI * 2);
      const edge = R[Math.floor(ang / (Math.PI * 2) * 128) % 128] - r; if (edge < 0) continue;
      // 渦を巻く細かい模様(座標を2段で揺らしてから、山型ノイズを重ねる)
      const q1 = fbm(px * 1.4 + seed, py * 1.4, seed + 1, 3) - 0.5, q2 = fbm(px * 1.4, py * 1.4 + seed, seed + 2, 3) - 0.5;
      const wx = px * 2.4 + 2.2 * q1, wy = py * 2.4 + 2.2 * q2;
      let tur = 0, amp = 0.55, f = 1.0; for (let o = 0; o < 5; o++) { tur += amp * Math.pow(1 - Math.abs(2 * vnoise(wx * f, wy * f, seed + 5 + o) - 1), 1.25); f *= 2.15; amp *= 0.5; }
      // こぶの丸み: 中心ほど明るく、縁(と下側の影)はくぼみの色
      const dome = Math.sqrt(Math.max(0, 1 - (r / 0.95) ** 2));
      // 細かいくぼみの線(高い周波数の山型ノイズを細く)
      const cre = Math.pow(1 - Math.abs(2 * fbm(wx * 4.5, wy * 4.5, seed + 23, 3) - 1), 4);
      let t = 0.2 + 0.8 * tur + 0.12 * dome - 0.3 * cre - 0.08 * Math.max(0, py) - Math.max(0, 0.16 - edge) * 2.0;
      if (temp === 'smoke') t = 0.2 + 0.6 * tur * dome;
      const [cr, cg, cb] = pal(P, t), i4 = (y * S + x) * 4;
      d[i4] = cr; d[i4 + 1] = cg; d[i4 + 2] = cb; d[i4 + 3] = 255 * Math.min(1, edge / 0.03) * (temp === 'smoke' ? 0.92 : 1);
    }
    c.putImageData(img, 0, 0); return cv;
  }
  let LOBES = null;
  const lobes = () => LOBES || (LOBES = Object.fromEntries(Object.keys(TEMPS).map(k => [k, [0, 1, 2].map(i => makeLobe(k, i * 13 + 7 + k.length))])));

  // ───── 爆発ひとつ分。age は爆発してからの秒、R は広がりきった時の半径(px)
  // 0〜0.3秒: 白熱の芯が一気に膨らむ → 〜2秒: 上へ昇りながら外側から冷えて赤くなる → 上の縁に黒煙
  function blast(ctx, cx, cy, R, age, t, seed, ground) {
    const L = lobes();
    const grow = 1 - Math.exp(-age * 5.5), rad = R * (0.12 + 0.88 * grow) * (1 + age * 0.04), rise = R * 0.22 * Math.min(1, age / 2.5);
    // 親のこぶ: 大きさも位置もばらばら(上に多い)。これが外形のでこぼこになる
    const parents = [];
    for (let i = 0; i < 11; i++) {
      const j = i * 17 + seed * 211, a = -Math.PI / 2 + (rnd(j) - 0.5) * Math.PI * 1.9, u = i === 0 ? 0 : 0.25 + 0.5 * rnd(j + 1);
      parents.push({ x: Math.cos(a) * u, y: Math.sin(a) * u * 0.9, r: (i === 0 ? 0.6 : 0.28 + 0.3 * rnd(j + 2)) });
    }
    const list = [];
    for (let i = 0; i < 300; i++) {
      const j = i + seed * 131, P = parents[i % parents.length];
      // 親のまわりに群がる(外側ほど小さい)
      const ga = rnd(j) * Math.PI * 2, gd = Math.sqrt(rnd(j + 1)) * P.r * 0.85;
      let nx = P.x + Math.cos(ga) * gd, ny = P.y + Math.sin(ga) * gd;
      nx += Math.sin(t * 0.3 + j) * 0.012; ny += Math.cos(t * 0.27 + j) * 0.012;
      const dist = Math.hypot(nx, ny), x = cx + nx * rad, yRaw = cy - rise + ny * rad;
      const s = Math.min(rad * 0.24, rad * P.r * (0.32 + 0.4 * rnd(j + 2)) * (1.1 - Math.min(1, gd / P.r) * 0.5));
      const y = ground && yRaw + s * 0.5 > ground ? ground - s * 0.5 : yRaw;
      // 明暗は大きなまとまり(火球全体にかかるノイズ)+ 中心からの距離 + 時間で冷える
      const big = fbm(nx * 1.6 + seed * 3.1, ny * 1.6 + t * 0.05, seed + 41, 3);
      const heat = 0.85 + (big - 0.5) * 1.4 - dist * 0.5 - Math.max(0, age - 0.4) * 0.15 + (1 - grow) * 0.7 + (ny > 0.15 ? 0.1 : 0);
      list.push({ x, y, s, d: dist + (1 - big) * 0.2, heat, rot: rnd(j + 3) * 6.28 + t * 0.12 * (rnd(j + 4) - 0.5), k: j % 3, top: ny < -0.5 && dist > 0.6 });
    }
    // 外側 → 内側の順に重ねる
    list.sort((p, q) => q.d - p.d);
    for (const p of list) {
      let temp = p.heat > 0.55 ? 'hot' : p.heat > 0.3 ? 'mid' : 'cool';
      if (p.top && age > 0.9 && rnd(p.k * 7 + p.x) > 0.75) { temp = 'smoke'; p.s *= 0.6; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.drawImage(L[temp][p.k], -p.s, -p.s, p.s * 2, p.s * 2); ctx.restore();
    }
  }

  // ───── 大爆発(人物の後ろ)。待機中もゆっくり燃え、シャッターで新しい爆発が始まり extra が連鎖する
  // extra: [[x, y, 大きさ, 遅れ秒], ...]  ground: 地面の高さ(0〜1)。こぶはこれより下に出ない
  function explosion(ctx, L, t) {
    const b = burst(), R = (L.size ?? 0.5) * H, gy = (L.ground ?? 1) * H;
    // 待機中は「燃え続けている途中」を見せる(年齢を 1.2〜1.8 秒でゆっくり往復)
    const age = b === null ? 1.5 + 0.3 * Math.sin(t * 0.4) : b;
    (L.extra || []).forEach(([x, y, s, delay], i) => {
      const a2 = b === null ? 1.4 + 0.3 * Math.sin(t * 0.5 + i) : b - delay;
      if (a2 > 0) blast(ctx, x * W, y * H, s * H, a2, t, i + 1, gy);
    });
    blast(ctx, L.x * W, L.y * H, R * (b === null ? (L.idle ?? 0.8) : 1), age, t, 0, gy);
  }

  // ───── 飛び散る破片(火の尾を引く岩)。シャッターで爆心から放射状に
  function shrapnel(ctx, L, t) {
    const b = burst(); if (b === null || b > 2.5) return;
    ctx.save();
    for (let i = 0; i < (L.count ?? 40); i++) {
      const a = -Math.PI * (0.05 + 0.9 * rnd(i)) + (rnd(i + 1) - 0.5) * 0.6, v = (0.5 + rnd(i + 2) * 1.2) * H, g = 0.9 * H;
      const x = L.x * W + Math.cos(a) * v * b * 1.4, y = L.y * H + Math.sin(a) * v * b + 0.5 * g * b * b;
      const s = (L.size ?? 8) * (0.4 + rnd(i + 3) * 1.4) * (rnd(i + 7) > 0.85 ? 2.2 : 1);
      // 尾
      const px = x - Math.cos(a) * v * 0.06, py = y - (Math.sin(a) * v + g * b) * 0.06;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.max(0, 1 - b / 2.5);
      const gr = ctx.createLinearGradient(px, py, x, y); gr.addColorStop(0, 'rgba(255,120,30,0)'); gr.addColorStop(1, 'rgba(255,190,90,0.9)');
      ctx.strokeStyle = gr; ctx.lineWidth = s * 0.6; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#2a211c';
      ctx.save(); ctx.translate(x, y); ctx.rotate(b * 8 * (rnd(i + 4) - 0.5) + i); ctx.beginPath();
      for (let v2 = 0; v2 < 5; v2++) { const aa = v2 / 5 * Math.PI * 2, rr = s * (0.6 + 0.5 * rnd(i * 5 + v2)); ctx.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr); }
      ctx.fill(); ctx.restore();
    }
    ctx.restore();
  }

  // ───── 色つきの煙の柱(戦隊)。colors の数だけ左右に並ぶ
  function smokeColumns(ctx, L, t) {
    const cols = L.colors, b = burst(), k = b === null ? 0.75 : Math.min(1.25, 0.75 + b * 0.8);
    ctx.save();
    cols.forEach((c, i) => {
      const x = (L.x0 + (L.x1 - L.x0) * i / (cols.length - 1)) * W, base = L.y * H;
      for (let j = 0; j < 18; j++) {
        const u = j / 17, rise = ((t * 0.12 + rnd(i * 31 + j)) % 1), y = base - (u * 0.55 + rise * 0.1) * H * k;
        puff(ctx, x + Math.sin(t * 0.8 + j + i) * 18 * u, y, (40 + 90 * u) * (0.6 + 0.4 * k), c, 0.35 * (1 - u * 0.6));
      }
    });
    ctx.restore();
  }

  // ───── 火の粉・光の粒。dir: 'up'(舞い上がる)| 'out'(爆心から飛ぶ)
  function sparks(ctx, L, t) {
    const n = L.count ?? 80, b = burst(), boost = b === null ? 1 : 1 + Math.max(0, 2 - b) * 1.5;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n * (b === null ? 1 : 1.6); i++) {
      const life = 2 + rnd(i) * 3, p = ((t + rnd(i + 7) * life) % life) / life;
      let x, y;
      if (L.dir === 'out') {
        const a = rnd(i + 2) * Math.PI * 2, v = (0.25 + rnd(i + 3) * 0.6) * boost;
        x = (L.x + Math.cos(a) * v * p) * W; y = (L.y + Math.sin(a) * v * p * 0.8 + p * p * 0.3) * H;
      } else {
        x = (L.x0 + (L.x1 - L.x0) * rnd(i + 4)) * W + Math.sin(t * 2 + i) * 20; y = (L.y + (rnd(i + 5) - 0.5) * 0.1 - p * (L.rise ?? 0.6)) * H;
      }
      const s = (L.size ?? 2.5) * (0.5 + rnd(i + 6)) * (1 - p * 0.5);
      ctx.globalAlpha = Math.sin(p * Math.PI) * (L.alpha ?? 1);
      ctx.fillStyle = L.color ?? '#ffb45a'; ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  // ───── 床を流れる霧。y は霧の中心の高さ、color は rgba の A を使う
  const fogCv = document.createElement('canvas'); fogCv.width = 640; fogCv.height = 180; let fogReady = false;
  function makeFog() {
    const c = fogCv.getContext('2d');
    for (let i = 0; i < 140; i++) {
      const x = rnd(i) * 640, y = 90 + (rnd(i + 1) - 0.5) * 70, r = 30 + rnd(i + 2) * 70;
      for (const dx of [-640, 0, 640]) { const g = c.createRadialGradient(x + dx, y, 0, x + dx, y, r); g.addColorStop(0, 'rgba(255,255,255,.10)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(x + dx - r, y - r, r * 2, r * 2); }
    }
    fogReady = true;
  }
  const tintCv = document.createElement('canvas'); tintCv.width = 640; tintCv.height = 180;
  function fog(ctx, L, t) {
    if (!fogReady) makeFog();
    const tc = tintCv.getContext('2d'); tc.globalCompositeOperation = 'source-over'; tc.clearRect(0, 0, 640, 180); tc.drawImage(fogCv, 0, 0);
    tc.globalCompositeOperation = 'source-in'; tc.fillStyle = L.color ?? '#ffffff'; tc.fillRect(0, 0, 640, 180);
    const h = (L.h ?? 0.3) * H, y = L.y * H - h / 2, off = ((t * (L.speed ?? 0.02)) % 1) * W;
    ctx.save(); ctx.globalAlpha = L.alpha ?? 0.8;
    for (const dx of [-W, 0]) ctx.drawImage(tintCv, dx + off, y, W, h);
    ctx.restore();
  }

  // ───── 魔法陣(床の楕円)。part: 'back'(人物の後ろの半分)| 'front'(手前の半分)。文字は円に沿って回る
  const RUNE = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
  function magicCircle(ctx, L, t) {
    const cx = L.x * W, cy = L.y * H, R = L.r * W, sq = L.squash ?? 0.28, b = burst(), k = b === null ? 0 : Math.max(0, 1 - b / 1.2);
    const pulse = 0.85 + 0.15 * Math.sin(t * 3) + k * 0.8;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(cx, cy); ctx.scale(1, sq);
    ctx.beginPath(); L.part === 'front' ? ctx.rect(-W, 0, W * 2, W) : ctx.rect(-W, -W, W * 2, W); ctx.clip();
    ctx.shadowColor = L.color; ctx.shadowBlur = 24; ctx.strokeStyle = L.color; ctx.fillStyle = L.color; ctx.globalAlpha = Math.min(1, pulse);
    const ring = (r, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke(); };
    ring(R, 4); ring(R * 0.92, 2); ring(R * 0.62, 3); ring(R * 0.55, 1.5);
    // 六芒星(ゆっくり回る)
    ctx.save(); ctx.rotate(t * 0.15); ctx.lineWidth = 2.5;
    for (const o of [0, Math.PI / 3]) { ctx.beginPath(); for (let i = 0; i <= 3; i++) { const a = o + i * Math.PI * 2 / 3 - Math.PI / 2; ctx.lineTo(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88); } ctx.stroke(); }
    ctx.restore();
    // 円に沿ったルーン(逆回り)
    ctx.font = `${Math.round(R * 0.07)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2 - t * 0.25; ctx.save(); ctx.rotate(a); ctx.translate(0, -R * 0.77); ctx.fillText(RUNE[i % RUNE.length], 0, 0); ctx.restore();
    }
    ctx.restore();
  }

  // ───── 体のまわりを回る光の輪(縦に並ぶ)。part で前後を分ける
  function spellRings(ctx, L, t) {
    const b = burst(), k = b === null ? 0 : Math.max(0, 1 - b / 1.2);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = L.color; ctx.fillStyle = L.color; ctx.shadowColor = L.color; ctx.shadowBlur = 16;
    L.rings.forEach((rg, i) => {
      const cx = L.x * W, cy = rg.y * H, R = rg.r * W, sq = 0.18, rot = t * (0.6 + i * 0.25) * (i % 2 ? -1 : 1);
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, sq); ctx.beginPath();
      L.part === 'front' ? ctx.rect(-W, 0, W * 2, W) : ctx.rect(-W, -W, W * 2, W); ctx.clip();
      ctx.globalAlpha = 0.7 + 0.3 * k; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
      ctx.font = `${Math.round(R * 0.12)}px serif`; ctx.textAlign = 'center';
      for (let j = 0; j < 36; j++) { const a = j / 36 * Math.PI * 2 + rot; ctx.save(); ctx.translate(Math.cos(a) * R * 1.08, Math.sin(a) * R * 1.08); ctx.fillText(RUNE[(j * 7 + i) % RUNE.length], 0, 0); ctx.restore(); }
      ctx.restore();
    });
    ctx.restore();
  }

  // ───── 中二病の詠唱文。漢字にカタカナのルビ。撮影ごとに文が変わる
  let spellPick = 0;
  function incantation(ctx, L, t) {
    const lines = L.lines, line = lines[spellPick % lines.length];
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    line.forEach((seg, i) => {
      const x = L.x * W, y = (L.y + i * 0.09) * H, a = Math.min(1, Math.max(0, (t * 1.2 % 8) * 1.5 - i * 0.6));
      ctx.globalAlpha = 0.25 + 0.75 * a; ctx.shadowColor = L.color; ctx.shadowBlur = 14; ctx.fillStyle = '#fff';
      ctx.font = `600 ${L.size ?? 30}px "Hiragino Mincho ProN", "Yu Mincho", serif`; ctx.fillText(seg[0], x, y);
      const w = ctx.measureText(seg[0]).width; ctx.fillStyle = L.color;
      ctx.font = `600 ${Math.round((L.size ?? 30) * 0.42)}px "Hiragino Sans", sans-serif`; ctx.textAlign = 'center'; ctx.fillText(seg[1], x + w / 2, y - (L.size ?? 30) * 0.95); ctx.textAlign = 'left';
    });
    ctx.restore();
  }

  // ───── 瓦礫と砂ぼこりが落ちてくる
  function debris(ctx, L, t) {
    const n = L.count ?? 40, b = burst(), extra = b === null ? 0 : 25;
    ctx.save();
    for (let i = 0; i < n + extra; i++) {
      const life = 1.4 + rnd(i) * 1.8, p = ((t + rnd(i + 3) * life) % life) / life, x = (rnd(i + 1) * 1.1 - 0.05) * W + Math.sin(i) * 30 * p, y = (-0.1 + p * 1.2) * H;
      const s = (L.size ?? 10) * (0.3 + rnd(i + 2) * (rnd(i + 8) > 0.85 ? 3 : 1));
      ctx.globalAlpha = 0.85; ctx.fillStyle = rnd(i + 5) > 0.5 ? '#3a332d' : '#5b5047';
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 3 * (rnd(i + 6) - 0.5) + i); ctx.beginPath();
      for (let v = 0; v < 5; v++) { const a = v / 5 * Math.PI * 2, rr = s * (0.6 + 0.5 * rnd(i * 5 + v)); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.fill(); ctx.restore();
    }
    ctx.restore();
  }

  // ───── 炎(蝋燭・松明)。points: [[x,y,大きさ], ...]
  function flames(ctx, L, t) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    L.points.forEach(([x, y, s], i) => {
      const fx = x * W, fy = y * H, h = s * H * (0.9 + 0.15 * Math.sin(t * 11 + i * 3) + 0.08 * Math.sin(t * 23 + i)), sway = Math.sin(t * 5 + i) * h * 0.08;
      puff(ctx, fx, fy - h * 0.3, h * 2.2, 'rgba(255,140,40,A)', 0.18);
      ctx.fillStyle = 'rgba(255,170,60,0.85)'; ctx.beginPath(); ctx.moveTo(fx - h * 0.22, fy); ctx.quadraticCurveTo(fx - h * 0.25, fy - h * 0.6, fx + sway, fy - h); ctx.quadraticCurveTo(fx + h * 0.25, fy - h * 0.6, fx + h * 0.22, fy); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,200,0.9)'; ctx.beginPath(); ctx.ellipse(fx, fy - h * 0.25, h * 0.09, h * 0.22, 0, 0, 7); ctx.fill();
    });
    ctx.restore();
  }

  // ───── 画面全体の光のゆらぎ・閃光(color を加算、または暗く)
  function flicker(ctx, L, t) {
    const b = burst(), flash = b === null ? 0 : Math.max(0, 1 - b / 0.5) * (L.flash ?? 0);
    const v = (L.amt ?? 0.06) * (0.5 + 0.5 * Math.sin(t * 13) * Math.sin(t * 7.3)) + flash;
    if (v <= 0) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, v); ctx.fillStyle = L.color; ctx.fillRect(0, 0, W, H); ctx.restore();
  }

  // ───── 斜めの光の筋(窓・ステンドグラス)
  function godRays(ctx, L, t) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < (L.count ?? 4); i++) {
      const x = (L.x + i * (L.gap ?? 0.03)) * W, a = (L.alpha ?? 0.12) * (0.7 + 0.3 * Math.sin(t * 0.7 + i * 2));
      const g = ctx.createLinearGradient(x, L.y * H, x + L.dx * W, H); g.addColorStop(0, L.color.replace('A', a)); g.addColorStop(1, L.color.replace('A', 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, L.y * H); ctx.lineTo(x + (L.w ?? 0.02) * W, L.y * H);
      ctx.lineTo(x + L.dx * W + (L.w ?? 0.02) * W * 4, H); ctx.lineTo(x + L.dx * W, H); ctx.fill();
    }
    ctx.restore();
  }

  const KINDS = { explosion, shrapnel, smokeColumns, sparks, fog, magicCircle, spellRings, incantation, debris, flames, flicker, godRays };
  return {
    draw(ctx, L, t) { now = t; const f = KINDS[L.fx]; if (f) f(ctx, L, t); },
    trigger() { burstAt = performance.now() / 1000; spellPick++; },
    clear() { burstAt = -1; },
    // 画面の揺れ(シャッター直後に強く、すぐ収まる)。amt は最大のずれ(px)
    shake(amt) { const b = burst(); if (b === null || b > 1.2) return [0, 0]; const k = amt * Math.pow(1 - b / 1.2, 2); return [(Math.random() - 0.5) * 2 * k, (Math.random() - 0.5) * 2 * k]; },
  };
})();
