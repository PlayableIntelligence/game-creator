import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CHARACTER, WORLD } from '../core/Constants.js';
import { loadVRM } from './VRMLoader.js';
import { loadMixamoFbx, retargetMixamoToVRM } from './MixamoRetarget.js';

/**
 * AnimatedCharacter — load a humanoid character, drive an idle/walk/run
 * state machine, position from the Rapier capsule.
 *
 * Auto-detects format from URL extension:
 *   - `.glb`  → GLTFLoader + SkeletonUtils.clone, animations from clipMap
 *               (clip names baked into the GLB itself, e.g. Soldier.glb has
 *                'Idle', 'Walk', 'Run')
 *   - `.vrm`  → @pixiv/three-vrm + Mixamo FBX animations retargeted onto the
 *               standardized humanoid skeleton. The opensourceavatars.com /
 *               VRoid Hub workflow.
 *
 * Architecture notes (apply to both GLB and VRM):
 *   - SkeletonUtils.clone (GLB) — regular .clone() breaks SkinnedMesh bone
 *     bindings → T-pose. SkeletonUtils properly re-binds.
 *   - receiveShadow = FALSE on every Mesh — per-fragment shadow-map sampling
 *     on a moving SkinnedMesh is the single most expensive thing.
 *   - frustumCulled = FALSE on every SkinnedMesh — Three.js's frustum check
 *     uses the un-skinned bbox, wrong once bones move.
 *   - State machine driven by movement INTENT, not Rapier's grounded flag
 *     (which can flap on flat surfaces and chatter the animation).
 *   - VRM has additional update systems (humanoid, expressionManager,
 *     lookAt, springBoneManager) that need their own per-frame update().
 */
export class AnimatedCharacter {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'character';
    this.mixer = null;
    this.actions = {};
    this.activeAction = null;
    this.activeName = null;
    this.facingOffset = 0;
    this.vrm = null;             // set when format === 'vrm'
    this.format = null;          // 'glb' | 'vrm'
    this._loaded = false;
    this.triangleCount = 0;
  }

  /**
   * Load + set up. Auto-detects from URL extension.
   *
   * @param {string} url        - .glb or .vrm
   * @param {object} clipMap    - state name → clip source
   *                              For GLB: { idle: 'Idle', walk: 'Walk', ... }
   *                              For VRM: { idle: '/path/idle.fbx', walk: '/path/walk.fbx', ... }
   * @param {object} opts
   * @param {number} [opts.scale=1]
   * @param {number} [opts.facingOffset=0]
   */
  async load(url, clipMap, opts = {}) {
    const ext = url.toLowerCase().split('.').pop();
    this.format = ext === 'vrm' ? 'vrm' : 'glb';
    this.facingOffset = opts.facingOffset ?? 0;
    const scale = opts.scale ?? 1.0;

    if (this.format === 'vrm') {
      await this._loadVRM(url, clipMap, scale);
    } else {
      await this._loadGLB(url, clipMap, scale);
    }

    this._loaded = true;
    return this;
  }

  async _loadGLB(url, clipMap, scale) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = SkeletonUtils.clone(gltf.scene);
    model.scale.setScalar(scale);

    let tris = 0;
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = false;
      if (child.isSkinnedMesh) child.frustumCulled = false;
      if (child.material) child.material = child.material.clone();
      const idx = child.geometry.index;
      const count = idx ? idx.count : (child.geometry.attributes.position?.count ?? 0);
      tris += count / 3;
    });
    this.triangleCount = tris;

    // Auto-correct foot pivot so feet sit at group.position.y regardless of
    // where the artist placed the model's origin. Some GLBs put origin at
    // hips, some at feet, some weirdly in between. We measure the rest-pose
    // bbox and shift the model so bbox.min.y = 0 (feet on ground plane).
    model.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(model);
    model.position.y = -bbox.min.y;

    this.group.add(model);
    this.model = model;

    this.mixer = new THREE.AnimationMixer(model);
    for (const [stateName, clipName] of Object.entries(clipMap)) {
      const clip = gltf.animations.find((c) => c.name === clipName);
      if (!clip) {
        console.warn(`[Character] clip "${clipName}" not found in ${url} (state: ${stateName})`);
        continue;
      }
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveTimeScale(1);
      action.setEffectiveWeight(1);
      this.actions[stateName] = action;
    }

    if (this.actions.idle) {
      this.actions.idle.play();
      this.activeAction = this.actions.idle;
      this.activeName = 'idle';
    }

    console.info(
      `[Character] GLB loaded ${url} · clips=[${Object.keys(this.actions).join(', ')}] ` +
      `scale=${scale} tris=${tris.toLocaleString()}`,
    );
  }

  async _loadVRM(url, clipMap, scale) {
    const vrm = await loadVRM(url);
    this.vrm = vrm;
    vrm.scene.scale.setScalar(scale);

    let tris = 0;
    vrm.scene.traverse((node) => {
      if (node.isSkinnedMesh) node.frustumCulled = false;
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = false;
        const idx = node.geometry.index;
        const count = idx ? idx.count : (node.geometry.attributes.position?.count ?? 0);
        tris += count / 3;
      }
    });
    this.triangleCount = tris;

    // Same foot-pivot auto-correction as GLB. VRM 0.x and 1.0 differ in foot
    // origin convention, and three-vrm's rotateVRM0 doesn't shift Y, so we
    // do it here uniformly.
    vrm.scene.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(vrm.scene);
    vrm.scene.position.y = -bbox.min.y;

    this.group.add(vrm.scene);
    this.model = vrm.scene;

    // Mixamo retargeting — load each FBX in clipMap, retarget to VRM skeleton
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    const entries = Object.entries(clipMap);
    await Promise.all(entries.map(async ([stateName, fbxUrl]) => {
      try {
        const asset = await loadMixamoFbx(fbxUrl);
        const clip = retargetMixamoToVRM(asset, vrm);
        if (!clip) {
          console.warn(`[Character] retarget produced no clip for ${stateName} (${fbxUrl})`);
          return;
        }
        const action = this.mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
        this.actions[stateName] = action;
      } catch (err) {
        console.warn(`[Character] anim "${stateName}" failed —`, err);
      }
    }));

    if (this.actions.idle) {
      this.actions.idle.play();
      this.activeAction = this.actions.idle;
      this.activeName = 'idle';
    }

    console.info(
      `[Character] VRM loaded ${url} · anims=[${Object.keys(this.actions).join(', ')}] ` +
      `scale=${scale} tris=${tris.toLocaleString()}`,
    );
  }

  /** Crossfade to a named state. Idempotent — safe to call every frame. */
  play(name) {
    if (!this._loaded || name === this.activeName) return;
    const next = this.actions[name];
    if (!next) return;
    const fade = (CHARACTER.fadeMs ?? 300) / 1000;
    if (this.activeAction) this.activeAction.fadeOut(fade);
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    this.activeAction = next;
    this.activeName = name;
  }

  setPosition(x, y, z) { this.group.position.set(x, y, z); }
  setYaw(yaw)          { this.group.rotation.y = yaw + this.facingOffset; }

  /** Per-render-frame tick. dt = render delta in seconds. */
  update(dt) {
    this.mixer?.update(dt);
    // VRM-specific update systems (spring-bone physics, lookAt, expressions).
    // Negligible cost on a single character.
    if (this.vrm) {
      this.vrm.humanoid?.update?.();
      this.vrm.expressionManager?.update?.();
      this.vrm.lookAt?.update?.(dt);
      this.vrm.springBoneManager?.update?.(dt);
    }
  }

  get loaded() { return this._loaded; }
  get root()   { return this.group; }
}
