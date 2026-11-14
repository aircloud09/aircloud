// 홈 화면 배경: 떠 있는 섬 위의 내 캐릭터
import { T, engine, Actor, makeSky, addLights, CONFETTI, sfx } from './engine.js';
import { hexIsland, makeClouds, place } from './scenery.js';
import { store } from './core.js';

export function createLobby() {
  const scene = new T.Scene();
  scene.fog = new T.Fog(0xbfe9ff, 40, 160);
  makeSky(scene, 0x1f7bff, 0xbfe9ff, 0xe9fbff);
  const sun = addLights(scene, { pos: [6, 12, 8], area: 9, far: 40 });
  const camera = new T.PerspectiveCamera(42, 1, 0.1, 800);

  const island = new T.Group();
  island.add(hexIsland(1, 2));
  place(island, 'trees_A_medium', 2.1, -3.4, 0, -2.2, 0.4);
  place(island, 'tree_single_A', 2.6, 3.3, 0, -2.6);
  place(island, 'tree_single_B', 2.2, 4.2, 0, 0.4);
  place(island, 'building_home_A_blue', 2.3, -1.2, 0, -3.3, 0.25);
  place(island, 'building_well_blue', 1.5, 2.2, 0, -3.6, -0.5);
  place(island, 'rock_single_C', 3.5, -3.9, 0, 1.2);
  place(island, 'rock_single_E', 3, 3.6, 0, 2.6, 1);
  place(island, 'flag_yellow', 3.5, -2.6, 0, 2.6, 0.6);
  place(island, 'barrel', 3.2, -3.1, 0, -0.3);
  place(island, 'crate_A_big', 3.2, 1.6, 0, 3.4, 0.4);
  scene.add(island);
  const clouds = makeClouds(scene, 8, { x: 40, yMin: -9, yMax: 6, zMin: -40, zMax: -12, scale: [2, 4] });

  let actor = null;
  async function setChar(name) {
    if (!engine.hasChar(name)) await engine.ensureChar(name);
    if (store.d.opts.char !== name) return; // 받는 사이에 다른 캐릭터를 골랐다
    if (actor) island.remove(actor.root);
    actor = new Actor(name);
    actor.root.scale.setScalar(1.0);
    actor.root.position.set(0, 0, 0.6);
    actor.play('Idle');
    island.add(actor.root);
  }
  actor = new Actor(store.d.opts.char);
  actor.root.position.set(0, 0, 0.6);
  actor.play('Idle');
  island.add(actor.root);

  let t = 0;
  const stage = {
    scene, camera, sun, noAutoTier: false,
    bloom: { strength: 0.25, threshold: 0.92 },
    onResize(w, h) {
      // 세로 화면에서는 섬이 화면 가운데(통계와 게임 카드 사이)에 오도록
      camera.fov = w / h < 0.8 ? 50 : 38;
    },
    update(dt) {
      t += dt;
      const a = Math.sin(t * 0.25) * 0.5;
      const dist = 17;
      camera.position.set(Math.sin(a) * dist, 7.5, Math.cos(a) * dist);
      camera.lookAt(0, -1.2, 0);
      island.position.y = Math.sin(t * 0.9) * 0.12;
      clouds.update(dt);
      actor.update(dt);
    },
    setChar,
    cheer() {
      actor.once('Cheer', 'Idle');
      engine.particles.emit(new T.Vector3(0, 3, 0.6), 40, { colors: CONFETTI, speed: 3.5, up: 5, life: 1.2 });
      sfx.play('correct');
    },
  };
  return stage;
}
