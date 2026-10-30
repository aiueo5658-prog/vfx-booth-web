'use strict';
const $ = s => document.querySelector(s);
const W = 1280, H = 720;
const sleep = ms => new Promise(r => setTimeout(r, ms));
VFX.hydrateIcons();

// ───────── 設定(ブラウザ内にだけ保存)
const DEF = { key: [0.1, 0.75, 0.2], sim: 0.14, smo: 0.10, spill: 0.8, pscale: 1, px: 0, py: 0, amt: null, mirror: true, anim: true, cd: 3, scene: 'boom', cam: '', spd: 6, qlt: 480, matte: [0, 0, 1, 1] };
let keyPicked = false;
let S = Object.assign({}, DEF);
try { Object.assign(S, JSON.parse(localStorage.getItem('vfx_set3') || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem('vfx_set3', JSON.stringify(S)); } catch (e) {} };

function snack(msg, ms = 3200) { const e = $('#snack'); e.textContent = msg; e.classList.add('show'); clearTimeout(snack.t); snack.t = setTimeout(() => e.classList.remove('show'), ms); }

// ───────── シーン
let scenes = [], images = {}, scene = null;
const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'assets/' + src; });
async function loadScenes() {
  scenes = await (await fetch('assets/scenes.json')).json();
  // シーンが1つも無いときは、暗い背景に人だけを出す仮シーン
  if (!scenes.length) scenes = [{ id: 'none', name: 'シーン未設定', thumb: null, grade: { tint: [1, 1, 1], amt: 0, contrast: 1, bright: 1 }, glow: { color: 'rgba(0,0,0,0)', blur: 0 }, layers: [{ person: true }] }];
  const box = $('#scenes');
  scenes.forEach(sc => {
    const b = document.createElement('button');
    b.className = 'lens'; b.dataset.id = sc.id; b.setAttribute('aria-label', sc.name);
    b.innerHTML = sc.thumb ? `<img src="assets/${sc.thumb}" alt="">` : VFX.icon('image');
    b.onclick = () => pickScene(sc.id);
    box.appendChild(b);
  });
  await Promise.all(scenes.flatMap(sc => sc.layers.filter(l => l.src).map(async l => { images[l.src] = await loadImg(l.src); })));
  pickScene(scenes.find(s => s.id === S.scene) ? S.scene : scenes[0].id);
}
function pickScene(id) {
  scene = scenes.find(s => s.id === id); S.scene = id;
  document.querySelectorAll('.lens').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id));
  $('#sceneName').textContent = scene.name;
  S.amt = null; applySlidersFromState(); save();
}

// ───────── WebGL クロマキー
const keyCanvas = document.createElement('canvas');
const gl = keyCanvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true });
const VS = 'attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}';
const FS = `precision mediump float;varying vec2 v;uniform sampler2D tex;uniform vec3 key,tint;
uniform float sim,smo,spill,amt,contrast,bright,rimAmt;uniform int dom;uniform vec3 rimCol;uniform vec2 px;uniform vec4 rect;
bool outR(vec2 q){return q.x<rect.x||q.y<rect.y||q.x>rect.z||q.y>rect.w;}   // 抜く範囲の外は全部透明
vec2 cc(vec3 c){return vec2(-.168736*c.r-.331264*c.g+.5*c.b,.5*c.r-.418688*c.g-.081312*c.b);}
// 色差キー: 緑が赤・青よりどれだけ勝っているか。くすんだ実物のGBでも、暗い服や肌は消えない
float kd(vec3 c){float d,k;if(dom==1){d=c.g-max(c.r,c.b);k=key.g-max(key.r,key.b);}else{d=c.b-max(c.r,c.g);k=key.b-max(key.r,key.g);}
 d/=max(k,.05);float T=.55-sim,W=max(smo*3.,.02);return 1.-smoothstep(T-W*.5,T+W*.5,d);}
float ka(vec2 q){if(outR(q))return 0.;return kd(texture2D(tex,q).rgb);}
void main(){vec3 c=texture2D(tex,v).rgb;
float a=outR(v)?0.:kd(c);
// 縁の光: 左右の少し外側が背景なら輪郭。シーンの光の色を乗せる
float e=0.;for(int i=1;i<=3;i++){float k=float(i)*4.;e=max(e,max(1.-ka(v+vec2(px.x*k,0.)),1.-ka(v-vec2(px.x*k,0.)))*(1.-float(i-1)*.25));}
if(dom==1){float l=max(c.r,c.b);c.g=mix(c.g,min(c.g,l),spill);}else{float l=max(c.r,c.g);c.b=mix(c.b,min(c.b,l),spill);}
c=mix(c,c*tint*1.2,amt);c=(c-.5)*contrast+.5;c*=bright;
c+=rimCol*e*rimAmt;
gl_FragColor=vec4(clamp(c,0.,1.)*a,a);}`;
let prog, U = {}, tex;
function initGL() {
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog); gl.useProgram(prog);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  ['key', 'tint', 'sim', 'smo', 'spill', 'amt', 'contrast', 'bright', 'dom', 'rimCol', 'rimAmt', 'px', 'rect'].forEach(n => U[n] = gl.getUniformLocation(prog, n));
  tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
function runKey(src, sw, sh) {
  if (keyCanvas.width !== sw || keyCanvas.height !== sh) { keyCanvas.width = sw; keyCanvas.height = sh; }
  gl.viewport(0, 0, sw, sh);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
  const g = scene.grade, k = S.key;
  gl.uniform3f(U.key, k[0], k[1], k[2]);
  gl.uniform3f(U.tint, g.tint[0], g.tint[1], g.tint[2]);
  gl.uniform1f(U.sim, S.sim); gl.uniform1f(U.smo, S.smo); gl.uniform1f(U.spill, S.spill);
  gl.uniform1f(U.amt, S.amt ?? g.amt); gl.uniform1f(U.contrast, g.contrast); gl.uniform1f(U.bright, g.bright);
  gl.uniform1i(U.dom, k[2] > k[1] ? 2 : 1);
  const m = S.matte || [0, 0, 1, 1]; gl.uniform4f(U.rect, m[0], m[1], m[2], m[3]);
  const rim = scene.fx?.rim || { color: [0, 0, 0], amt: 0 };
  gl.uniform3f(U.rimCol, rim.color[0], rim.color[1], rim.color[2]); gl.uniform1f(U.rimAmt, rim.amt);
  gl.uniform2f(U.px, 1 / sw, 1 / sh);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ───────── カメラ / テスト映像
const video = document.createElement('video'); video.muted = true; video.playsInline = true;
const demo = document.createElement('canvas'); demo.width = W; demo.height = H;
let stream = null, source = demo, srcIsVideo = false;
function drawDemo(t) {
  const c = demo.getContext('2d');
  const gr = c.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#1fc03a'); gr.addColorStop(1, '#16a82e');
  c.fillStyle = gr; c.fillRect(0, 0, W, H);
  const x = W / 2 + Math.sin(t * .7) * 90, bob = Math.sin(t * 2.2) * 6;
  c.fillStyle = '#2b3f7a'; c.beginPath(); c.roundRect(x - 150, 330 + bob, 300, 420, 70); c.fill();
  c.fillStyle = '#d9a57f'; c.fillRect(x - 28, 280 + bob, 56, 70);
  c.beginPath(); c.ellipse(x, 220 + bob, 72, 88, 0, 0, 7); c.fill();
  c.fillStyle = '#2a1b14'; c.beginPath(); c.ellipse(x, 168 + bob, 76, 52, 0, Math.PI, 0); c.fill();
  c.strokeStyle = '#d9a57f'; c.lineWidth = 46; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x + 140, 380 + bob); c.lineTo(x + 230, 250 + bob + Math.sin(t * 5) * 50); c.stroke();
}
async function startCamera(id) {
  if (stream) stream.getTracks().forEach(t => t.stop()); stream = null;
  if (id === 'demo') { source = demo; srcIsVideo = false; setChip('TEST FEED', 'warn'); return true; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: Object.assign({ width: { ideal: 1280 }, height: { ideal: 720 } }, id ? { deviceId: { exact: id } } : {}), audio: false });
    video.srcObject = stream; await video.play();
    source = video; srcIsVideo = true; setChip('CAMERA OK', 'ok');
    return true;
  } catch (e) {
    source = demo; srcIsVideo = false; setChip('TEST FEED · NO CAMERA', 'warn');
    snack('カメラが使えないのでテスト映像にしました: ' + (e.name || e));
    return false;
  }
}
function setChip(t, k) { const c = $('#camChip'); c.textContent = t; c.className = 'chip ' + k; }
async function refreshDevices() {
  let list = [];
  try { list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch (e) {}
  const sel = $('#camSel'); sel.innerHTML = '';
  list.forEach((d, i) => sel.add(new Option(d.label || `カメラ${i + 1}`, d.deviceId)));
  sel.add(new Option('テスト映像(カメラなしで試す)', 'demo'));
  const cur = stream && stream.getVideoTracks()[0] && stream.getVideoTracks()[0].getSettings().deviceId;
  sel.value = cur && [...sel.options].some(o => o.value === cur) ? cur : (!stream ? 'demo' : sel.value);
  return list;
}
async function initCamera() {
  const ok = await startCamera(S.cam && S.cam !== 'demo' ? S.cam : '');
  let list = await refreshDevices();
  if (ok && !S.cam) { // 外付けカメラ(内蔵以外)を優先
    const ext = list.find(d => d.label && !/facetime|built-?in|内蔵|iphone|continuity/i.test(d.label));
    const curId = stream.getVideoTracks()[0].getSettings().deviceId;
    if (ext && ext.deviceId !== curId) { await startCamera(ext.deviceId); await refreshDevices(); $('#camSel').value = ext.deviceId; }
  }
}
$('#camSel').onchange = async e => { S.cam = e.target.value; save(); await startCamera(S.cam); await refreshDevices(); $('#camSel').value = S.cam; };
if (navigator.mediaDevices) navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices);

// ───────── 色とり
const raw = $('#raw'), rawCtx = raw.getContext('2d', { willReadFrequently: true });
const prev = $('#prev'), prevCtx = prev.getContext('2d');
function srcSize() { return srcIsVideo ? [video.videoWidth || W, video.videoHeight || H] : [W, H]; }
function sample(nx, ny, r = 6) {
  const [sw, sh] = srcSize(); const cv = document.createElement('canvas'); cv.width = 160; cv.height = Math.round(160 * sh / sw);
  const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(source, 0, 0, cv.width, cv.height);
  const x = Math.round(nx * cv.width), y = Math.round(ny * cv.height);
  const d = c.getImageData(Math.max(0, x - r), Math.max(0, y - r), r * 2, r * 2).data; let R = 0, G = 0, B = 0, n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
  return [R / n / 255, G / n / 255, B / n / 255];
}
function setKey(c, picked) { if (picked) keyPicked = true; S.key = c; save(); updateGuide(); $('#swatch').style.background = `rgb(${c.map(v => Math.round(v * 255))})`; }
raw.onclick = e => { if (matteEdit) return; const r = raw.getBoundingClientRect(); setKey(sample((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height), true); snack('緑の色を取りました'); };
$('#autoKey').onclick = () => {
  const pts = [[.05, .08], [.95, .08], [.05, .5], [.95, .5]].map(p => sample(p[0], p[1], 8));
  setKey([0, 1, 2].map(i => pts.reduce((a, p) => a + p[i], 0) / pts.length), true); snack('四隅の色を取りました');
};

// ───────── スライダー等
const SL = { sim: 'sim', smo: 'smo', spill: 'spill', pscale: 'pscale', px: 'px', py: 'py', amt: 'amt' };
function paintSlider(el) { el.style.setProperty('--pct', ((el.value - el.min) / (el.max - el.min) * 100) + '%'); $('#' + el.id + 'O').textContent = (+el.value).toFixed(2); }
function applySlidersFromState() {
  for (const k in SL) { const el = $('#' + k); el.value = k === 'amt' ? (S.amt ?? scene?.grade.amt ?? 0) : S[k]; paintSlider(el); }
  $('#mirror').checked = S.mirror; $('#anim').checked = S.anim;
  setKey(S.key);
  $('#cdBtn').textContent = S.cd ? S.cd + 's' : '0s';
}
for (const k in SL) $('#' + k).oninput = e => { S[k] = +e.target.value; paintSlider(e.target); save(); };
$('#mirror').onchange = e => { S.mirror = e.target.checked; save(); };
$('#anim').onchange = e => { S.anim = e.target.checked; save(); };
$('#cdBtn').onclick = () => { S.cd = S.cd === 3 ? 5 : S.cd === 5 ? 0 : 3; $('#cdBtn').textContent = S.cd ? S.cd + 's' : '0s'; save(); };
$('#tuneBtn').onclick = () => $('#tuneDlg').showModal();

// ───────── 抜く範囲(クロップ): ドラッグで囲んだ長方形の中だけ緑を抜き、外は全部背景にする
let matteEdit = false, drag = null;
const clamp01 = n => Math.min(1, Math.max(0, n));
function paintMatte() {
  const m = S.matte || [0, 0, 1, 1], b = $('#matteBox');
  Object.assign(b.style, { left: m[0] * 100 + '%', top: m[1] * 100 + '%', width: (m[2] - m[0]) * 100 + '%', height: (m[3] - m[1]) * 100 + '%' });
  const full = m[0] <= 0 && m[1] <= 0 && m[2] >= 1 && m[3] >= 1;
  b.classList.toggle('full', full && !matteEdit); b.classList.toggle('edit', matteEdit);
  $('#matteBtn').setAttribute('aria-pressed', matteEdit); $('#matteReset').hidden = !matteEdit;
  if (matteEdit) { $('#setTitle').textContent = '範囲をドラッグ'; $('#setSub').textContent = 'GBの内側を囲む。外は全部消える'; }
}
function setMatteEdit(on) { matteEdit = on; raw.style.cursor = on ? 'crosshair' : ''; $('#ring').classList.toggle('off', on || keyPicked); paintMatte(); if (!on) updateGuide(); }
$('#matteBtn').onclick = () => setMatteEdit(!matteEdit);
$('#matteReset').onclick = () => { S.matte = [0, 0, 1, 1]; save(); paintMatte(); };
const rawPt = e => { const r = raw.getBoundingClientRect(); return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)]; };
raw.addEventListener('pointerdown', e => { if (!matteEdit) return; drag = rawPt(e); raw.setPointerCapture(e.pointerId); });
raw.addEventListener('pointermove', e => {
  if (!drag) return; const [x, y] = rawPt(e);
  S.matte = [Math.min(drag[0], x), Math.min(drag[1], y), Math.max(drag[0], x), Math.max(drag[1], y)]; paintMatte();
});
raw.addEventListener('pointerup', () => {
  if (!drag) return; drag = null;
  const m = S.matte; if (m[2] - m[0] < .05 || m[3] - m[1] < .05) S.matte = [0, 0, 1, 1];   // 小さすぎたら全体に戻す
  save(); setMatteEdit(false); snack('抜く範囲を決めました');
});
$('#resetSet').onclick = () => { const keep = { scene: S.scene, cam: S.cam }; S = Object.assign({}, DEF, keep); applySlidersFromState(); save(); snack('リセットしました'); };

// ───────── 画面(01 準備 / 02 撮影 / 03 送信)
let view = 1;
function updateGuide() {
  const t = $('#setTitle'); if (!t) return;
  t.textContent = keyPicked ? 'OK！ 撮影へ' : '緑をクリック';
  t.style.color = keyPicked ? '#fff' : '';
  $('#setSub').textContent = keyPicked ? '色を取りました' : (srcIsVideo ? '画面の緑の背景' : 'テスト映像で試せます');
  $('#ring').classList.toggle('off', keyPicked);
  const go2 = $('#toLive'); go2.classList.toggle('pulse', keyPicked);
}
function go(n) {
  if (n === 3 && !cur) { snack('先に写真を撮ってください'); return; }
  if (view === 3 && n !== 3) stopStream();
  view = n;
  [1, 2, 3].forEach(i => { $('#v' + i).hidden = i !== n; });
  document.querySelectorAll('#phases button').forEach(b => b.classList.toggle('on', +b.dataset.v === n));
  if (n === 3) startSend();
}
$('#phases').onclick = e => { const b = e.target.closest('button'); if (b) go(+b.dataset.v); };
$('#toLive').onclick = () => go(2);

// ───────── 描画ループ
const stage = $('#stage'), ctx = stage.getContext('2d');
let animT = 0, lastTs = 0;
function drawLayer(L, t) {
  if (L.fx) { FX.draw(ctx, L, t); return; }
  const img = images[L.src]; if (!img) return;
  ctx.save();
  ctx.globalCompositeOperation = L.blend === 'lighter' ? 'lighter' : 'source-over';
  let a = L.opacity ?? 1;
  if (L.flicker) a *= 1 - L.flicker * (.5 + .5 * Math.sin(t * 23) * Math.sin(t * 7.3));
  ctx.globalAlpha = Math.max(0, Math.min(1, a));
  if (L.tile) {
    const ox = (((L.scroll[0] * t) % W) + W) % W, oy = (((L.scroll[1] * t) % H) + H) % H;
    for (const x of [ox - W, ox]) for (const y of [oy - H, oy]) ctx.drawImage(img, x, y, W, H);
  } else if (L.sway) {
    ctx.drawImage(img, -24 + Math.sin(t * L.speed * 2) * L.sway, -14 + Math.cos(t * L.speed * 1.7) * L.sway * .4, W + 48, H + 28);
  } else if (L.flicker) {
    const s = 1 + .02 * Math.sin(t * 17) + .01 * Math.sin(t * 29);
    ctx.drawImage(img, 0, H - H * s, W, H * s);
  } else ctx.drawImage(img, 0, 0, W, H);
  ctx.restore();
}
function drawPerson() {
  const [sw, sh] = srcSize(); if (!sw) return;
  runKey(source, sw, sh);
  const { x: x0, y, dw, dh } = personRect(); let x = S.mirror ? W - x0 - dw : x0;
  ctx.save();
  ctx.shadowColor = scene.glow.color; ctx.shadowBlur = scene.glow.blur;
  if (S.mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); x = W - x - dw; }
  ctx.drawImage(keyCanvas, x, y, dw, dh);
  ctx.restore();
}
// ───────── 人物まわりの演出(scenes.json の fx)
const sil = document.createElement('canvas'); sil.width = 160; sil.height = 90;
const silCtx = sil.getContext('2d', { willReadFrequently: true });
function personRect() {
  // シーンごとに人の大きさと足の位置を変えられる(scenes.json の person: { scale, x, feet })
  const P = scene.person || {}, [sw, sh] = srcSize(); const s = (H / sh) * S.pscale * (P.scale ?? 1), dw = sw * s, dh = sh * s;
  let x = (W - dw) / 2 + (S.px + (P.x ?? 0)) * W; const y = (P.feet ?? 1) * H - dh + S.py * H;
  if (S.mirror) x = W - x - dw;
  return { x, y, dw, dh };
}
// 足元の接地影: 切り抜きを小さく黒く描き、縦につぶして床に落とす
function drawShadow(fx) {
  const r = personRect();
  silCtx.globalCompositeOperation = 'source-over'; silCtx.clearRect(0, 0, 160, 90);
  silCtx.save(); if (S.mirror) { silCtx.translate(160, 0); silCtx.scale(-1, 1); } silCtx.drawImage(keyCanvas, 0, 0, 160, 90); silCtx.restore();
  const d = silCtx.getImageData(0, 0, 160, 90).data; let bottom = -1;
  for (let y = 89; y >= 0 && bottom < 0; y--) for (let x = 0; x < 160; x += 2) if (d[(y * 160 + x) * 4 + 3] > 80) { bottom = y; break; }
  if (bottom < 0) return;
  silCtx.globalCompositeOperation = 'source-in'; silCtx.fillStyle = '#000'; silCtx.fillRect(0, 0, 160, 90);
  const feet = r.y + (bottom + 1) / 90 * r.dh, h = r.dh * (fx.shadow.squash ?? 0.06);
  ctx.save(); ctx.globalAlpha = fx.shadow.opacity ?? 0.55; ctx.imageSmoothingQuality = 'high';
  // 下半分(脚)だけを平たくつぶして足元に置く
  ctx.drawImage(sil, 0, 45, 160, 45, r.x - r.dw * 0.04, feet - h * 0.75, r.dw * 1.08, h);
  ctx.restore();
}
// 体に落ちる影の縞(牢屋の格子など)。人物の形の中だけ暗くする
const shadeCv = document.createElement('canvas'); shadeCv.width = W; shadeCv.height = H; const shadeCtx = shadeCv.getContext('2d');
function drawShade(sh) {
  const r = personRect();
  shadeCtx.globalCompositeOperation = 'source-over'; shadeCtx.clearRect(0, 0, W, H);
  shadeCtx.save(); if (S.mirror) { shadeCtx.translate(W, 0); shadeCtx.scale(-1, 1); }
  shadeCtx.drawImage(keyCanvas, S.mirror ? W - r.x - r.dw : r.x, r.y, r.dw, r.dh); shadeCtx.restore();
  shadeCtx.globalCompositeOperation = 'source-in';
  shadeCtx.save(); shadeCtx.translate(sh.x * W, 0); shadeCtx.transform(1, 0, sh.skew ?? 0, 1, 0, 0);
  shadeCtx.fillStyle = sh.color ?? '#000';
  for (let x = -W; x < W * 2; x += sh.gap * W) shadeCtx.fillRect(x, 0, sh.w * W, H);
  shadeCtx.restore();
  // 縞の縁をぼかす
  ctx.save(); ctx.globalAlpha = sh.opacity ?? 0.5; ctx.filter = `blur(${sh.blur ?? 6}px)`; ctx.drawImage(shadeCv, 0, 0); ctx.restore();
}
function renderStage(t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const fx = scene.fx;
  // 爆発の揺れ: 少し拡大してから全体をずらす(端が見えないように)
  const [dx, dy] = FX.shake(scene.shake ?? 0);
  ctx.save();
  if (dx || dy) { ctx.translate(W / 2 + dx, H / 2 + dy); ctx.scale(1.04, 1.04); ctx.translate(-W / 2, -H / 2); }
  for (const L of scene.layers) {
    if (!L.person) { drawLayer(L, t); continue; }
    if (fx?.shadow) { const [sw, sh] = srcSize(); if (sw) { runKey(source, sw, sh); drawShadow(fx); } }
    drawPerson();
    if (fx?.shade) drawShade(fx.shade);
  }
  ctx.restore();
}
let rawTick = 0;
function frame(ts) {
  const dt = Math.min(.1, (ts - lastTs) / 1000 || 0); lastTs = ts;
  if (S.anim) animT += dt;
  if (!srcIsVideo) drawDemo(ts / 1000);
  if (scene && (!scenes.some(sc => sc.layers.some(l => l.src)) || Object.keys(images).length) && (!srcIsVideo || video.readyState >= 2)) renderStage(animT);
  if (view === 1 && (rawTick++ & 1) === 0) { rawCtx.drawImage(source, 0, 0, W, H); prevCtx.drawImage(stage, 0, 0, prev.width, prev.height); }
  requestAnimationFrame(frame);
}

// ───────── 撮影
const shots = []; let busy = false, cur = null, shotNo = 0;
async function shoot() {
  if (busy) return; busy = true; $('#shoot').disabled = true;
  const c = $('#count');
  for (let n = S.cd; n > 0; n--) { c.innerHTML = `<span>${n}</span>`; c.className = 'count pop'; void c.offsetWidth; await sleep(1000); }
  c.innerHTML = ''; c.className = 'count';
  // シャッターで演出を弾けさせ、いちばん派手な瞬間を撮る
  FX.trigger(); await sleep(scene.burstDelay ?? 250);
  renderStage(animT);
  setTimeout(FX.clear, 2500);
  const fl = $('#flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
  const blob = await new Promise(r => stage.toBlob(r, 'image/png'));
  const shot = { blob, url: URL.createObjectURL(blob), name: `vfx_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png` };
  shots.unshift(shot); if (shots.length > 12) URL.revokeObjectURL(shots.pop().url);
  shotNo++; showResult(shot);
  busy = false; $('#shoot').disabled = false;
}
function updateLast() {
  const b = $('#lastThumb'); b.disabled = !cur; $('#sendNav').disabled = !cur;
  b.innerHTML = cur ? `<img src="${cur.url}" alt="">` : '<span class="empty">NO SHOT</span>';
  $('#lastLabel').textContent = 'Last shot · #' + String(shotNo).padStart(2, '0');
}
function showResult(s) { cur = s; $('#resImg').src = s.url; updateLast(); if (!$('#resDlg').open) $('#resDlg').showModal(); }
$('#shoot').onclick = shoot;
$('#retake').onclick = () => { $('#resDlg').close(); shoot(); };
$('#lastThumb').onclick = () => cur && showResult(cur);
$('#sendNav').onclick = () => go(3);
$('#sendBtn').onclick = () => { $('#resDlg').close(); go(3); };
$('#saveBtn').onclick = () => { const a = document.createElement('a'); a.href = cur.url; a.download = cur.name; a.click(); };
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
addEventListener('keydown', e => { if (e.code === 'Space' && view === 2 && !document.querySelector('dialog[open]') && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); shoot(); } });

// ───────── スマホへ送る(QRパラパラ)
let enc = null, tick = null, seq = 0, paused = false, imgBytes = 0;
async function guessRecvUrl() {
  try { const ov = localStorage.getItem('vfx_recv'); if (ov) return ov; } catch (e) {}
  if (window.VFX_RECV_URL) return window.VFX_RECV_URL;
  try {
    const i = await (await fetch('/info.json', { cache: 'no-store' })).json();
    return `https://${i.ip}:${i.https}/receive.html`;
  } catch (e) { return new URL('receive.html', location.href).href; }
}
const qrPx = el => Math.max(120, el.parentElement.clientWidth - 12);
function drawQR1() { try { VFX.drawQR($('#qr1'), $('#recvUrl').value.trim(), qrPx($('#qr1')), 'M'); } catch (e) { snack('アドレスが長すぎます'); } }
$('#recvUrl').oninput = () => { try { localStorage.setItem('vfx_recv', $('#recvUrl').value.trim()); } catch (e) {} drawQR1(); };
async function startSend() {
  $('#sendImg').src = cur.url; $('#photoLabel').textContent = 'Photo · #' + String(shotNo).padStart(2, '0');
  $('#recvUrl').value = await guessRecvUrl(); drawQR1();
  await buildChunks(); startStream();
}
$('#backLive').onclick = () => go(2);
$('#showBig').onclick = () => cur && showResult(cur);
$('#optBtn').onclick = () => $('#optDlg').showModal();
$('#sPause').onclick = () => { paused = !paused; $('#sPause').innerHTML = VFX.icon(paused ? 'play' : 'pause'); $('#sPause').setAttribute('aria-label', paused ? '再開' : '一時停止'); };
function seg(id, key, cb) {
  const el = $(id); el.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.v === S[key]));
  el.onclick = e => { const b = e.target.closest('button'); if (!b) return; S[key] = +b.dataset.v; save(); el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); cb(); };
}
seg('#spdSeg', 'spd', () => { if (tick) { updateInfo(); startStream(); } });
seg('#qltSeg', 'qlt', async () => { if (view === 3) { await buildChunks(); startStream(); } });
async function buildChunks() {
  const bmp = await createImageBitmap(cur.blob), w = S.qlt, h = Math.round(w * bmp.height / bmp.width);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const q = w >= 960 ? .66 : w >= 640 ? .6 : .55;
  let blob = await new Promise(r => cv.toBlob(r, 'image/webp', q));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q + .1)); // Safari等はJPEG
  const bytes = new Uint8Array(await blob.arrayBuffer()); imgBytes = bytes.length;
  enc = new VFX.Encoder(bytes, 200);
  updateInfo();
}
function updateInfo() { if (enc) $('#sendInfo').textContent = `${(imgBytes / 1024).toFixed(1)} KB · QR ${enc.K}+ · 約${Math.ceil(enc.K * 1.3 / S.spd)}s`; }
function startStream() {
  stopStream(); seq = 0; paused = false; $('#sPause').innerHTML = VFX.icon('pause');
  const show = () => {
    if (paused || !enc) return;
    VFX.drawQR($('#qr2'), enc.frame(seq), qrPx($('#qr2')));
    $('#qrBadge').textContent = `#${seq + 1}`;
    $('#progBar').style.width = (((seq % enc.K) + 1) / enc.K * 100) + '%';
    seq++;
  };
  show(); tick = setInterval(show, 1000 / S.spd);
}
function stopStream() { clearInterval(tick); tick = null; }

// ───────── 使い方
$('#helpBtn').onclick = () => $('#helpDlg').showModal();
$('#helpDlg').addEventListener('close', () => { try { localStorage.setItem('vfx_help', '1'); } catch (e) {} });

// ───────── 起動
(async () => {
  initGL();
  applySlidersFromState();
  await loadScenes();
  requestAnimationFrame(frame);
  go(1); updateLast(); updateGuide(); paintMatte();
  await initCamera(); updateGuide();
  let seen = false; try { seen = !!localStorage.getItem('vfx_help'); } catch (e) {}
  if (!seen) $('#helpDlg').showModal();
})();
