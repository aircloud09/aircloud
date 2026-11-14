// 3D 엔진: 렌더러, 품질 단계, 에셋, 캐릭터, 파티클, 효과음
import * as T from '../vendor/three.bundle.js';
import { store } from './core.js';

export { T };

const TIERS = {
  high: { dpr: 2, shadow: 2048, bloom: true },
  mid: { dpr: 1.5, shadow: 1024, bloom: false },
  low: { dpr: 1, shadow: 0, bloom: false },
};
const TIER_ORDER = ['high', 'mid', 'low'];

export const COLORS = ['#ff5d6c', '#35d07f', '#4aa8ff', '#ffc93c'];
export const ease = {
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t) => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  lin: (t) => t,
};

// 캐릭터별 장비: 전체 목록 중 show만 보이게 한다
const GEAR = {
  knight: { all: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword'], show: ['1H_Sword', 'Round_Shield'] },
  mage: { all: ['Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff'], show: ['1H_Wand', 'Spellbook_open'] },
  barbarian: { all: ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', '2H_Axe', 'Mug'], show: ['1H_Axe', 'Barbarian_Round_Shield'] },
  rogue: { all: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'], show: ['Knife'] },
  rogue_hooded: { all: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'], show: ['Knife', 'Knife_Offhand'] },
};
export const CHAR_NAMES = { knight: '기사', mage: '마법사', barbarian: '전사', rogue: '도적', rogue_hooded: '그림자 도적' };

function detectTier() {
  const forced = new URLSearchParams(location.search).get('q');
  if (TIERS[forced]) return { name: forced, auto: false };
  const q = store.d.opts.quality;
  if (TIERS[q]) return { name: q, auto: false };
  const ua = navigator.userAgent;
  const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
  let name = 'high';
  if (/Android/i.test(ua)) name = mem >= 6 && cores >= 8 ? 'high' : mem >= 4 ? 'mid' : 'low';
  return { name, auto: true };
}

export const engine = {
  renderer: null, composer: null, canvas: null,
  tierName: 'high', tier: TIERS.high, autoTier: true,
  stage: null, tweens: [], time: 0, shakeAmt: 0,
  assets: { chars: {}, clips: {}, env: {} },
  particles: null,
  _fps: { t: 0, n: 0 },

  init(canvas) {
    this.canvas = canvas;
    const r = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = T.SRGBColorSpace;
    r.toneMapping = T.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.type = T.PCFShadowMap;
    this.renderer = r;
    const t = detectTier();
    this.autoTier = t.auto;
    this.particles = new Particles(360);
    this.setTier(t.name);
    addEventListener('resize', () => this.resize());
    let last = performance.now();
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  },

  setTier(name) {
    this.tierName = name;
    this.tier = TIERS[name];
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio || 1, this.tier.dpr));
    r.shadowMap.enabled = this.tier.shadow > 0;
    this.buildComposer();
    if (this.stage) this.applyStageQuality(this.stage);
    this.resize();
  },

  applyStageQuality(stage) {
    if (stage.sun) {
      stage.sun.castShadow = this.tier.shadow > 0;
      if (this.tier.shadow) {
        stage.sun.shadow.mapSize.set(this.tier.shadow, this.tier.shadow);
        if (stage.sun.shadow.map) { stage.sun.shadow.map.dispose(); stage.sun.shadow.map = null; }
      }
    }
    stage.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  },

  buildComposer() {
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    if (!this.tier.bloom || !this.stage) return;
    const size = this.renderer.getDrawingBufferSize(new T.Vector2());
    const rt = new T.WebGLRenderTarget(size.x, size.y, { type: T.HalfFloatType, samples: 4 });
    const c = new T.EffectComposer(this.renderer, rt);
    c.addPass(new T.RenderPass(this.stage.scene, this.stage.camera));
    const b = this.stage.bloom || {};
    c.addPass(new T.UnrealBloomPass(new T.Vector2(size.x / 2, size.y / 2), b.strength ?? 0.35, b.radius ?? 0.7, b.threshold ?? 0.9));
    c.addPass(new T.OutputPass());
    this.composer = c;
  },

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.setSize(w, h);
    if (this.stage) {
      const cam = this.stage.camera;
      cam.aspect = w / h;
      if (this.stage.onResize) this.stage.onResize(w, h);
      cam.updateProjectionMatrix();
    }
  },

  // stage: { scene, camera, update(dt), sun?, bloom?, onResize?, dispose? }
  use(stage) {
    if (this.stage && this.stage.dispose) this.stage.dispose();
    this.tweens.length = 0;
    this.shakeAmt = 0;
    this.stage = stage;
    if (stage) {
      this.particles.reset();
      stage.scene.add(this.particles.mesh);
      this.applyStageQuality(stage);
    }
    this.buildComposer();
    this.resize();
    this._fps = { t: 0, n: 0 };
  },

  frame(dt) {
    this.time += dt;
    const st = this.stage;
    if (!st) return;
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      if (tw.t < 0) continue;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(tw.ease(k));
      if (k >= 1) { this.tweens.splice(i, 1); if (tw.done) tw.done(); }
    }
    st.update(dt);
    this.particles.update(dt);
    const cam = st.camera;
    let sx = 0, sy = 0;
    if (this.shakeAmt > 0.001) {
      sx = (Math.random() - 0.5) * this.shakeAmt; sy = (Math.random() - 0.5) * this.shakeAmt;
      cam.position.x += sx; cam.position.y += sy;
      this.shakeAmt *= Math.exp(-dt * 9);
    }
    if (this.composer) this.composer.render(dt); else this.renderer.render(st.scene, cam);
    cam.position.x -= sx; cam.position.y -= sy;
    // 자동 품질 조절: 느리면 한 단계 낮춘다
    if (this.autoTier && !st.noAutoTier) {
      const f = this._fps; f.t += dt; f.n++;
      if (f.t >= 3) {
        const fps = f.n / f.t; f.t = 0; f.n = 0;
        const i = TIER_ORDER.indexOf(this.tierName);
        if (fps < 34 && i < TIER_ORDER.length - 1) this.setTier(TIER_ORDER[i + 1]);
      }
    }
  },

  tween(dur, fn, { ease: e = ease.out, delay = 0, done } = {}) {
    const tw = { t: -delay, dur, fn, ease: e, done };
    this.tweens.push(tw);
    return tw;
  },
  wait(sec, done) { return this.tween(sec, () => {}, { done }); },
  shake(a = 0.3) { this.shakeAmt = Math.max(this.shakeAmt, a); },

  project(v, out = {}) {
    const p = _v.copy(v).project(this.stage.camera);
    out.x = (p.x * 0.5 + 0.5) * innerWidth;
    out.y = (-p.y * 0.5 + 0.5) * innerHeight;
    out.visible = p.z < 1;
    return out;
  },

  async load(onProgress) {
    const loader = new T.GLTFLoader();
    loader.setMeshoptDecoder(T.MeshoptDecoder);
    const files = ['knight', 'mage', 'barbarian', 'rogue', 'rogue_hooded', 'env'];
    let done = 0;
    const toon = toonGradient();
    const toonMats = new Map();
    const convert = (root) => root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = !o.isSkinnedMesh;
      if (o.isSkinnedMesh) o.frustumCulled = false;
      const m = o.material;
      if (!toonMats.has(m)) toonMats.set(m, new T.MeshToonMaterial({ map: m.map, color: m.color, gradientMap: toon }));
      o.material = toonMats.get(m);
    });
    await Promise.all(files.map(async (f) => {
      const g = await loader.loadAsync(`assets/models/${f}.glb`);
      convert(g.scene);
      if (f === 'env') {
        for (const c of g.scene.children) this.assets.env[c.name] = c;
      } else {
        this.assets.chars[f] = g.scene;
        for (const clip of g.animations) this.assets.clips[clip.name] = clip;
      }
      done++;
      if (onProgress) onProgress(done / files.length);
    }));
  },

  prop(name, scale = 1) {
    const src = this.assets.env[name];
    const o = src.clone(true);
    o.position.set(0, 0, 0);
    o.scale.setScalar(scale);
    return o;
  },
};

const _v = new T.Vector3();
const _m = new T.Matrix4();
const _q = new T.Quaternion();
const _s = new T.Vector3();
const _c = new T.Color();

export function toonGradient() {
  const data = new Uint8Array([120, 120, 120, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
  const tex = new T.DataTexture(data, 3, 1, T.RGBAFormat);
  tex.minFilter = tex.magFilter = T.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
let _toon;
export function toonMat(color, extra = {}) {
  _toon = _toon || toonGradient();
  return new T.MeshToonMaterial({ color, gradientMap: _toon, ...extra });
}
export function glowMat(color, intensity = 1.6, extra = {}) {
  const c = new T.Color(color).multiplyScalar(intensity);
  return new T.MeshBasicMaterial({ color: c, toneMapped: false, ...extra });
}

// 캐릭터(스킨 메시 + 공유 애니메이션)
export class Actor {
  constructor(name) {
    this.name = name;
    this.root = T.SkeletonUtils.clone(engine.assets.chars[name]);
    const gear = GEAR[name];
    this.root.traverse((o) => { if (gear.all.includes(o.name)) o.visible = gear.show.includes(o.name); });
    this.mixer = new T.AnimationMixer(this.root);
    this.actions = {};
    this.cur = null; this.curName = '';
    this.onceLeft = 0; this.onceNext = null;
  }
  play(name, { loop = true, fade = 0.12, speed = 1 } = {}) {
    if (loop && this.curName === name && this.onceLeft <= 0) { this.cur.timeScale = speed; return; }
    const clip = engine.assets.clips[name];
    const a = this.actions[name] || (this.actions[name] = this.mixer.clipAction(clip));
    a.reset();
    a.setLoop(loop ? T.LoopRepeat : T.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    a.timeScale = speed;
    if (this.cur && this.cur !== a) a.crossFadeFrom(this.cur, fade, false);
    a.play();
    this.cur = a; this.curName = name;
    this.onceLeft = 0; this.onceNext = null;
    return clip.duration / speed;
  }
  // 한 번 재생하고 next로 돌아간다(next가 null이면 마지막 자세 유지)
  once(name, next = 'Idle', opts = {}) {
    const dur = this.play(name, { ...opts, loop: false });
    this.onceLeft = dur - 0.12; this.onceNext = next;
    return dur;
  }
  update(dt) {
    this.mixer.update(dt);
    if (this.onceLeft > 0) {
      this.onceLeft -= dt;
      if (this.onceLeft <= 0 && this.onceNext) { const n = this.onceNext; this.onceNext = null; this.play(n); }
    }
  }
  // 실루엣(정체를 숨긴 상태) 전환
  setSilhouette(on) {
    this.sil = on;
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if (on) { o.userData.mat = o.userData.mat || o.material; o.material = SIL; } else if (o.userData.mat) o.material = o.userData.mat;
    });
  }
  flash(color = 0xff4455, dur = 0.35) {
    if (this.sil) return;
    // 재질을 공유하므로 캐릭터 전용 복제본에 적용
    if (!this._own) {
      this._own = new Map();
      this.root.traverse((o) => {
        if (!o.isMesh) return;
        if (!this._own.has(o.material)) this._own.set(o.material, o.material.clone());
        o.material = this._own.get(o.material);
      });
    }
    const list = [...this._own.values()];
    list.forEach((m) => m.emissive && m.emissive.set(color));
    engine.tween(dur, (k) => list.forEach((m) => { if (m.emissive) m.emissiveIntensity = 1 - k; }), { ease: ease.lin });
  }
}
const SIL = new T.MeshBasicMaterial({ color: 0x1b1630 });

// 파티클(인스턴스 메시 풀)
class Particles {
  constructor(max) {
    this.max = max;
    const geo = new T.OctahedronGeometry(0.09, 0);
    const mat = new T.MeshBasicMaterial({ toneMapped: false });
    this.mesh = new T.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.p = [];
    for (let i = 0; i < max; i++) {
      this.p.push({ life: 0, max: 1, pos: new T.Vector3(), vel: new T.Vector3(), g: 9, size: 1, spin: 0 });
      this.mesh.setColorAt(i, _c.set(0xffffff));
    }
    this.next = 0;
    this.reset();
  }
  reset() {
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < this.max; i++) { this.p[i].life = 0; this.mesh.setMatrixAt(i, _m); }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  emit(pos, n, { colors = ['#fff'], speed = 4, up = 3, gravity = 10, life = 0.8, size = 1, spread = 0.2 } = {}) {
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      const p = this.p[i];
      p.life = p.max = life * (0.6 + Math.random() * 0.6);
      p.pos.set(pos.x + (Math.random() - 0.5) * spread, pos.y + (Math.random() - 0.5) * spread, pos.z + (Math.random() - 0.5) * spread);
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
      p.vel.set(Math.cos(a) * s, up * (0.3 + Math.random()), Math.sin(a) * s);
      p.g = gravity; p.size = size * (0.6 + Math.random() * 0.8); p.spin = Math.random() * 6;
      _c.set(colors[Math.floor(Math.random() * colors.length)]).multiplyScalar(1.5);
      this.mesh.setColorAt(i, _c);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      any = true;
      p.life -= dt;
      if (p.life <= 0) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); continue; }
      p.vel.y -= p.g * dt;
      p.pos.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      _s.setScalar(p.size * Math.min(1, k * 2.2));
      _q.setFromAxisAngle(_v.set(0.5, 1, 0.3).normalize(), p.spin + p.life * 8);
      _m.compose(p.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export const CONFETTI = ['#ff5d6c', '#35d07f', '#4aa8ff', '#ffc93c', '#c77dff', '#ffffff'];

// 하늘(그라데이션 돔)
export function makeSky(scene, top, horizon, bottom = horizon) {
  const mat = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new T.Color(top) }, mid: { value: new T.Color(horizon) }, bot: { value: new T.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
      void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.42)) : mix(mid, bot, pow(-h, 0.5));
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const sky = new T.Mesh(new T.SphereGeometry(600, 24, 12), mat);
  sky.renderOrder = -10;
  scene.add(sky);
  return sky;
}

export function addLights(scene, { sun = 0xfff4dc, sunI = 2.1, sky = 0xd6eeff, ground = 0x8fbf6a, hemiI = 1.35, pos = [8, 16, 6], area = 16, far = 60 } = {}) {
  const hemi = new T.HemisphereLight(sky, ground, hemiI);
  scene.add(hemi);
  const d = new T.DirectionalLight(sun, sunI);
  d.position.set(...pos);
  d.castShadow = true;
  const c = d.shadow.camera;
  c.left = -area; c.right = area; c.top = area; c.bottom = -area; c.near = 1; c.far = far;
  d.shadow.bias = -0.0006; d.shadow.normalBias = 0.03;
  scene.add(d, d.target);
  return d;
}

// 글자 줄바꿈(한글은 글자 단위, 공백 우선)
export function wrapLines(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    const words = para.split(' ');
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width <= maxW) { line = test; continue; }
      if (line) lines.push(line);
      line = '';
      // 단어 하나가 너무 길면 글자 단위로 자른다
      let chunk = '';
      for (const ch of w) {
        if (ctx.measureText(chunk + ch).width > maxW) { lines.push(chunk); chunk = ch; } else chunk += ch;
      }
      line = chunk;
    }
    if (line) lines.push(line);
  }
  return lines;
}

// 구형 브라우저용: 둥근 사각형 경로
function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const FONT = '"Jua", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';

// 글자 텍스처. 내용에 맞게 글자 크기를 자동으로 줄인다.
export function textTexture(text, { w = 512, h = 256, size = 72, min = 28, color = '#fff', bg = null, border = null, radius = 36, pad = 28, stroke = null, sub = null } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  if (bg) {
    ctx.fillStyle = bg;
    ctx.beginPath(); roundRect(ctx, 4, 4, w - 8, h - 8, radius); ctx.fill();
    if (border) { ctx.lineWidth = 8; ctx.strokeStyle = border; ctx.stroke(); }
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let lines, fs = size;
  const availH = h - pad * 2 - (sub ? 44 : 0);
  for (; fs >= min; fs -= 4) {
    ctx.font = `${fs}px ${FONT}`;
    lines = wrapLines(ctx, text, w - pad * 2);
    if (lines.length * fs * 1.22 <= availH) break;
  }
  const lh = fs * 1.22;
  let y = (h - (sub ? 40 : 0)) / 2 - ((lines.length - 1) * lh) / 2;
  for (const ln of lines) {
    if (stroke) { ctx.lineWidth = fs * 0.18; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(ln, w / 2, y); }
    ctx.fillStyle = color; ctx.fillText(ln, w / 2, y);
    y += lh;
  }
  if (sub) {
    ctx.font = `32px ${FONT}`; ctx.fillStyle = sub.color || 'rgba(0,0,0,.45)';
    ctx.fillText(sub.text, w / 2, h - pad - 12);
  }
  const tex = new T.CanvasTexture(cv);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function textSprite(text, opts = {}) {
  const { w = 512, h = 256, scale = 2 } = opts;
  const mat = new T.SpriteMaterial({ map: textTexture(text, opts), transparent: true, depthWrite: false, toneMapped: false, fog: false });
  const s = new T.Sprite(mat);
  s.scale.set(scale, scale * h / w, 1);
  return s;
}

export function disposeScene(scene) {
  scene.traverse((o) => {
    if (o.isSprite && o.material.map) { o.material.map.dispose(); o.material.dispose(); }
    if (o.userData.ownGeo && o.geometry) o.geometry.dispose();
    if (o.userData.ownTex && o.material && o.material.map) o.material.map.dispose();
  });
}

// ---------- 효과음(합성) ----------
export const sfx = {
  ctx: null, master: null, musicTimer: null, musicGain: null, step: 0,
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, { type = 'sine', vol = 0.12, at = 0, to = null, dest = null } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.03);
  },
  noise(dur, { vol = 0.1, at = 0, freq = 1800, q = 0.8, type = 'bandpass', to = null } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + at;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  },
  play(name) {
    if (!store.d.opts.sound || !this.ctx) return;
    switch (name) {
      case 'coin': this.tone(988, 0.07, { type: 'square', vol: 0.05 }); this.tone(1319, 0.2, { type: 'square', vol: 0.05, at: 0.06 }); break;
      case 'correct': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.13, at: i * 0.07 })); break;
      case 'wrong': this.tone(220, 0.38, { type: 'sawtooth', vol: 0.09, to: 98 }); this.tone(233, 0.38, { type: 'sawtooth', vol: 0.06, to: 104 }); break;
      case 'jump': this.tone(320, 0.18, { type: 'sine', vol: 0.1, to: 680 }); break;
      case 'slide': this.noise(0.25, { vol: 0.08, freq: 900, to: 300 }); break;
      case 'swipe': this.noise(0.16, { vol: 0.07, freq: 1200, to: 4200, q: 1.2 }); break;
      case 'hit': this.noise(0.22, { vol: 0.16, freq: 500, to: 120, type: 'lowpass' }); this.tone(110, 0.2, { type: 'square', vol: 0.08, to: 55 }); break;
      case 'attack': this.noise(0.14, { vol: 0.1, freq: 2600, to: 700, q: 2 }); break;
      case 'magic': this.tone(660, 0.3, { type: 'sine', vol: 0.08, to: 1500 }); this.tone(990, 0.3, { type: 'triangle', vol: 0.05, to: 2200, at: 0.05 }); break;
      case 'click': this.tone(700, 0.05, { type: 'triangle', vol: 0.08 }); break;
      case 'tick': this.tone(880, 0.06, { type: 'square', vol: 0.05 }); break;
      case 'go': this.tone(1320, 0.3, { type: 'square', vol: 0.06 }); break;
      case 'gate': this.tone(440, 0.25, { type: 'triangle', vol: 0.05, to: 660 }); break;
      case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.12, at: i * 0.1 })); this.tone(1568, 0.6, { type: 'triangle', vol: 0.1, at: 0.55 }); break;
      case 'lose': [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.32, { type: 'triangle', vol: 0.11, at: i * 0.16 })); break;
      default: break;
    }
  },
  // 가벼운 배경음(아르페지오 + 베이스)
  music(on) {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    if (!on || !store.d.opts.music || !this.ctx) return;
    const c = this.ctx;
    if (!this.musicGain) { this.musicGain = c.createGain(); this.musicGain.gain.value = 0.5; this.musicGain.connect(this.master); }
    const chords = [[262, 330, 392, 494], [220, 262, 330, 392], [175, 220, 262, 330], [196, 247, 294, 392]];
    const pat = [0, 2, 1, 3, 2, 1, 3, 2];
    const beat = 0.22;
    let nextT = c.currentTime + 0.1;
    this.step = 0;
    const tick = () => {
      while (nextT < c.currentTime + 0.3) {
        const s = this.step++;
        const ch = chords[Math.floor(s / 16) % chords.length];
        const at = nextT - c.currentTime;
        this.tone(ch[pat[s % 8]] * 2, 0.26, { type: 'triangle', vol: 0.035, at, dest: this.musicGain });
        if (s % 8 === 0) this.tone(ch[0] / 2, 0.8, { type: 'sine', vol: 0.07, at, dest: this.musicGain });
        if (s % 4 === 2) this.noise(0.04, { vol: 0.012, at, freq: 6000, q: 0.5 });
        nextT += beat;
      }
    };
    tick();
    this.musicTimer = setInterval(tick, 100);
  },
};
