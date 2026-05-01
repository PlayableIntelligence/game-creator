import * as THREE from 'three';
import { PLAYER, PLAYER_VRM, ANIM, PROPS, COMBAT } from '../core/Constants.js';
import { loadVRM } from '../systems/vrmLoader.js';
import { loadMixamoFbx, retargetMixamoToVRM, reverseClip, trimClipEnd } from '../systems/mixamoRetarget.js';
import { attachWeapon } from '../systems/WeaponAttach.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { applySwordEnv } from '../systems/SwordLighting.js';
import { RootMotionAbsorb } from '../systems/RootMotionAbsorb.js';

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.vrm = null;
    this.mixer = null;
    this.actions = {};      // name -> AnimationAction
    this.currentAction = null;

    // Placeholder capsule until VRM loads — keeps movement testable.
    const geo = new THREE.CapsuleGeometry(0.35, 0.9, 6, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0x666270, roughness: 0.8 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(PLAYER.START_X, PLAYER.START_Y + 0.9, PLAYER.START_Z);
    scene.add(this.mesh);

    this.velocity = new THREE.Vector3();
    this.desiredYaw = 0;
    this.isRolling = false;
    this.rollTimer = 0;

    // Combat state machine. `_lock` is the single "animation-owning" state;
    // everything else is orthogonal. null means the movement anim selector
    // is free to pick idle/walk/run. Block is orthogonal (held flag).
    //
    //   null       → movement anims win
    //   'attack'   → light or heavy swing in flight
    //   'heal'     → sheath → drink → draw chain
    //   'stagger'  → hit-react; consumed by a timer
    //   'dead'     → death anim holds the skeleton; no input accepted
    this._lock = null;
    this._lockTimer = 0;
    this._blocking = false;
    this._attackSpec = null;
    this.combat = null;            // bound from Game.init()
    this.estus = COMBAT.PLAYER.startingEstus;

    // Keep Player authoritative for HP. GameState is the shared read source
    // but writes flow through CombatSystem → here → state update.
    eventBus.on(Events.PLAYER_DAMAGE, (p) => this._onDamaged(p));
    eventBus.on(Events.PLAYER_DEATH,  () => this._onDeath());

    this._loadRig();
  }

  bindCombat(combatSystem) { this.combat = combatSystem; }
  bindAudio(audioManager) { this.audio = audioManager; }

  // Stamina API. Drain returns whether the action can go — callers should
  // gate attack / roll starts on `_drainStamina(cost)` returning true.
  _drainStamina(cost) {
    if (gameState.stamina < cost) return false;
    gameState.stamina = Math.max(0, gameState.stamina - cost);
    // Larger cooldown when we drained ourselves to empty — classic "punish
    // the mash" window where the player is exposed.
    this._staminaRegenAt = performance.now() + COMBAT.PLAYER.staminaRegenCooldownMs
      + (gameState.stamina === 0 ? COMBAT.PLAYER.staminaEmptyExtraMs : 0);
    eventBus.emit(Events.STAMINA_CHANGE, { stamina: gameState.stamina });
    return true;
  }
  // For passive drains (block-absorb) that shouldn't gate — still respects
  // the regen cooldown but doesn't refuse the action.
  _drainStaminaPassive(cost) {
    gameState.stamina = Math.max(0, gameState.stamina - cost);
    this._staminaRegenAt = performance.now() + COMBAT.PLAYER.staminaRegenCooldownMs
      + (gameState.stamina === 0 ? COMBAT.PLAYER.staminaEmptyExtraMs : 0);
    eventBus.emit(Events.STAMINA_CHANGE, { stamina: gameState.stamina });
  }
  _regenStamina(delta) {
    if (gameState.stamina >= gameState.staminaMax) return;
    if (performance.now() < (this._staminaRegenAt ?? 0)) return;
    const next = Math.min(gameState.staminaMax,
      gameState.stamina + COMBAT.PLAYER.staminaRegenPerSec * delta);
    if (next !== gameState.stamina) {
      gameState.stamina = next;
      eventBus.emit(Events.STAMINA_CHANGE, { stamina: gameState.stamina });
    }
  }

  // Queries the CombatSystem uses to gate damage.
  isInvulnerable() {
    // i-frames are a SUB-window inside the roll (not the entire roll).
    // Gives the roll a vulnerable tail where mistimed rolls eat damage —
    // which is the Souls pattern.
    const inRollIFrames = this.isRolling && (this.rollIFrameTimer ?? 0) > 0;
    // Plus the brief startup of heal (where you'd expect the drinking motion
    // to absorb a glancing hit before vulnerability kicks in).
    const inHealStart = (this._lock === 'heal' && this._lockTimer > COMBAT.PLAYER.healDurationMs * 0.5);
    return inRollIFrames || inHealStart;
  }
  isBlockingToward(attackerPos) {
    if (!this._blocking || !attackerPos) return false;
    const fx = Math.sin(this.mesh.rotation.y);
    const fz = Math.cos(this.mesh.rotation.y);
    const dx = attackerPos.x - this.mesh.position.x;
    const dz = attackerPos.z - this.mesh.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.001) return true;
    const cosTheta = (dx * fx + dz * fz) / d;
    return cosTheta > Math.cos((COMBAT.PLAYER.blockConeDegrees * Math.PI / 180) / 2);
  }

  async _loadRig() {
    console.log('[Player] VRM load start', PLAYER_VRM.url);
    try {
      const vrm = await loadVRM(PLAYER_VRM.url);
      this.vrm = vrm;
      vrm.scene.scale.setScalar(PLAYER_VRM.scale);
      vrm.scene.position.copy(this.mesh.position);
      this.scene.add(vrm.scene);

      // Disable frustum culling on skinned meshes. three.js's default
      // SkinnedMesh culling test uses the authored (un-skinned) bounds at the
      // object origin, which is the wrong volume once the skeleton animates —
      // the documented workaround is just to turn culling off. Per-frame
      // bounds checks are wasted work anyway for a two-character scene.
      vrm.scene.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });

      this.mesh.visible = false;
      this._vrmRoot = vrm.scene;
      this.mixer = new THREE.AnimationMixer(vrm.scene);
      // Root-motion absorber — target mesh.position (the authoritative game
      // position; vrm.scene gets synced from it each frame). fadeMs matches
      // play()'s default so the gradual absorb moves in lockstep with the
      // idle crossfade. Gradual strategy was approved in the tuner A/B.
      this.absorb = new RootMotionAbsorb(vrm, this.mesh, {
        strategy: 'gradual',
        fadeMs: PLAYER_ABSORB_FADE_MS,
      });
      console.log('[Player] VRM ready');

      // Preload the whole greatsword moveset in parallel. Missing clips are
      // fine — `play(name)` is a no-op if the clip didn't load.
      await Promise.all([
        this._tryLoadClip('idle',        ANIM.idle),
        this._tryLoadClip('walk',        ANIM.walk),
        this._tryLoadClip('run',         ANIM.run),
        this._tryLoadClip('roll',        ANIM.roll),
        this._tryLoadClip('block',       ANIM.block),
        this._tryLoadClip('sheath',      ANIM.sheath),
        this._tryLoadClip('heal',        ANIM.heal),
        this._tryLoadClip('draw',        ANIM.draw),
        this._tryLoadClip('lightAttack', ANIM.lightAttack),
        this._tryLoadClip('heavyAttack', ANIM.heavyAttack),
        this._tryLoadClip('hit',         ANIM.hit),
        this._tryLoadClip('death',       ANIM.death),
      ]);

      // One-shot clips — fire once, hold the final frame until re-triggered.
      // Block is included: the "raise guard" motion plays through once and
      // then clamps at the final frame for as long as F is held. Looping the
      // full raise-guard motion looked like the arm kept re-raising; clamp
      // at end is the "stance hold" vibe you want (equivalent to looping
      // just the last few frames).
      for (const name of ['roll', 'block', 'sheath', 'heal', 'draw', 'lightAttack', 'heavyAttack', 'hit', 'death']) {
        if (this.actions[name]) {
          this.actions[name].setLoop(THREE.LoopOnce);
          this.actions[name].clampWhenFinished = true;
        }
      }
      this.mixer.addEventListener('finished', (e) => {
        // Any locking one-shot clears its lock on finish. The _lock itself
        // may have been cleared earlier by a roll-cancel; that's fine.
        const a = e.action;
        if (a === this.actions.lightAttack || a === this.actions.heavyAttack) {
          // Attack clips (especially the heavy spin) lunge the hip forward.
          // Commit the drift into mesh.position and start the idle
          // crossfade RIGHT NOW in the same instant — `gradual` cancels
          // the teleport only when the absorb's position shift moves in
          // lockstep with the pose blend. If we let update() start the
          // idle fade a frame later there's a visible 1-frame jolt.
          this.absorb?.commit();
          if (this.actions.idle) {
            const fadeSec = (this.absorb?.fadeMs ?? PLAYER_ABSORB_FADE_MS) / 1000;
            e.action.fadeOut(fadeSec);
            this.actions.idle.reset().fadeIn(fadeSec).play();
            this.currentAction = this.actions.idle;
          }
          if (this._lock === 'attack') this._lock = null;
          this._attackSpec = null;
        }
        if (a === this.actions.roll) {
          // Roll commits drift too, but doesn't force-fade-to-idle —
          // next frame's movement selector picks run / walk / idle based
          // on input, and the one-frame lag is inside the rollTimer
          // window where the character is already back on their feet.
          this.absorb?.commit();
        }
        if (a === this.actions.hit && this._lock === 'stagger') this._lock = null;
        if (a === this.actions.death) {
          // Hold the final frame; Game will surface YOU DIED overlay and
          // wait for GAME_RESTART before resetting state.
        }
      });

      if (this.actions.idle) this.play('idle');

      // Attach ONE greatsword to the right hand. sheathSword()/drawSword()
      // move it between hand and upperChest with `bone.attach()` so the
      // world transform is preserved — the sword stays exactly where the
      // last frame of the animation put it.
      try {
        this.sword = await attachWeapon(vrm, { ...PROPS.greatsword, ...PROPS.greatsword.player });
        this._handBone = vrm.humanoid.getRawBoneNode('rightHand');
        this._backBone = vrm.humanoid.getRawBoneNode(PROPS.greatsword.sheathedBone || 'upperChest')
                      || vrm.humanoid.getRawBoneNode('chest')
                      || vrm.humanoid.getRawBoneNode('spine');
        if (this.sword) {
          // Seed home-local with the Constants defaults so drawSword() has
          // something to restore to on a cold reset() (before any sheath).
          // sheathSword() refreshes this to the live local before reparenting
          // so slider-tuned offsets are preserved across the chain.
          this._swordHomeLocal = {
            position: this.sword.position.clone(),
            quaternion: this.sword.quaternion.clone(),
            scale: this.sword.scale.clone(),
          };
          // Override the blade's env map to the bright studio PMREM so it
          // catches proper metallic highlights. Scene.environment (dim
          // cathedral) still lights the VRM skin correctly.
          applySwordEnv(this.sword);
          console.log('[Player] greatsword attached');
        }
      } catch (err) {
        console.warn('[Player] sword attach failed:', err.message);
      }
    } catch (err) {
      console.warn('[Player] VRM load failed — staying as capsule:', err.message);
    }
  }

  async _tryLoadClip(name, url) {
    try {
      const asset = await loadMixamoFbx(url);
      let clip = retargetMixamoToVRM(asset, this.vrm);
      if (!clip) return null;
      // Per-clip cleanup.
      //  - draw: Mixamo "Draw A Great Sword" motion is authored going INTO
      //    the sheath; reverse so it reads as drawing.
      //  - sheath/draw: Mixamo appends a rest-pose snap at the final
      //    keyframe that the retarget amplifies into a disjointed arm when
      //    clampWhenFinished holds the last frame. Chop the last 0.12 s.
      if (name === 'draw') clip = reverseClip(clip);
      if (name === 'sheath' || name === 'draw') clip = trimClipEnd(clip, 0.12);
      const action = this.mixer.clipAction(clip);
      this.actions[name] = action;
      return action;
    } catch (err) {
      // Silent — missing FBX is expected during scaffolding.
      return null;
    }
  }

  play(name, fadeMs = 200) {
    const next = this.actions[name];
    if (!next || next === this.currentAction) return;
    if (this.currentAction) this.currentAction.fadeOut(fadeMs / 1000);
    next.reset().fadeIn(fadeMs / 1000).play();
    this.currentAction = next;
  }

  // Bridge-fade from the live skeleton pose into `name`. Three's crossFade
  // blends by weight and the target clip keeps advancing during the fade, so
  // mismatched end/start poses still pop. Trick: snapshot every bone's current
  // local transform into a held 1-frame clip, then crossFade that into the
  // target. Because the bridge is static, the weight lerp genuinely reads as
  // "current pose → target clip's first frame" — the arm sweeps naturally into
  // the next animation instead of snapping.
  playFromCurrentPose(name, dur = 0.25, { holdAtStart = false } = {}) {
    const next = this.actions[name];
    if (!next || !this.mixer || !this._vrmRoot) return null;

    const tracks = [];
    this._vrmRoot.traverse((o) => {
      if (!o.isBone) return;
      const q = o.quaternion.toArray();
      const p = o.position.toArray();
      // Two identical keyframes so the clip has non-zero duration (LoopRepeat
      // divides by duration, NaN otherwise). Flat hold between them.
      tracks.push(new THREE.QuaternionKeyframeTrack(`${o.name}.quaternion`, [0, 1], [...q, ...q]));
      tracks.push(new THREE.VectorKeyframeTrack(`${o.name}.position`, [0, 1], [...p, ...p]));
    });
    const bridgeClip = new THREE.AnimationClip(`__bridge_${name}_${performance.now()}`, 1, tracks);
    const bridge = this.mixer.clipAction(bridgeClip);
    bridge.setLoop(THREE.LoopRepeat, Infinity);
    bridge.play();

    if (this.currentAction && this.currentAction !== bridge) this.currentAction.stop();

    next.reset();
    next.timeScale = 1;
    bridge.crossFadeTo(next.play(), dur, false);
    // `holdAtStart` pins the next clip at time=0 during the fade. Useful when
    // the caller wants the bridge to land exactly on the next clip's first
    // frame (e.g. draw[0] = hand-reaching-behind, which matches sheath's end
    // pose — so a world-preserving reparent at that instant puts the sword in
    // the hand at the natural local offset instead of some mid-motion offset).
    if (holdAtStart) next.paused = true;
    this.currentAction = next;

    setTimeout(() => {
      bridge.stop();
      this.mixer.uncacheClip(bridgeClip);
      if (holdAtStart) next.paused = false;
    }, Math.ceil(dur * 1000) + 50);

    return next;
  }

  reset() {
    this.mesh.position.set(PLAYER.START_X, PLAYER.START_Y + 0.9, PLAYER.START_Z);
    this.velocity.set(0, 0, 0);
    this.isRolling = false;
    this.rollTimer = 0;
    this.rollIFrameTimer = 0;
    this._rollDir = null;
    this._lock = null;
    this._lockTimer = 0;
    this._blocking = false;
    this._attackSpec = null;
    this.estus = COMBAT.PLAYER.startingEstus;
    gameState.playerHP = gameState.playerMaxHP;
    gameState.stamina  = gameState.staminaMax;
    this._staminaRegenAt = 0;
    eventBus.emit(Events.STAMINA_CHANGE, { stamina: gameState.stamina });
    this.drawSword();
    if (this.actions.idle) this.play('idle');
  }

  // Triggered by CombatSystem event. Ignore if already dying; only play the
  // hit anim if the damage landed AND this wasn't an i-framed/blocked nullify.
  _onDamaged(p) {
    if (this._lock === 'dead' || gameState.playerHP <= 0) return;
    if (p.iframed || p.damage === 0) return;
    if (p.blocked) {
      // Blocked damage — guard absorbs it. Still drains stamina; if we get
      // drained to 0 by a chained hit, the *next* blocked hit should break
      // through. (Guard-break is a tier-2 feature, but the stamina drain
      // already makes mashing-block risky.)
      this._drainStaminaPassive(COMBAT.PLAYER.staminaBlockedHitCost);
      return;
    }
    if (!this.actions.hit) return;
    this._setLock('stagger', COMBAT.PLAYER.staggerMs);
    this._blocking = false;
    const a = this.actions.hit;
    if (this.currentAction && this.currentAction !== a) this.currentAction.fadeOut(0.08);
    a.reset().fadeIn(0.08).play();
    this.currentAction = a;
  }

  _onDeath() {
    if (this._lock === 'dead') return;
    this._lock = 'dead';
    this._lockTimer = 0;
    this._blocking = false;
    if (!this.actions.death) return;
    const a = this.actions.death;
    if (this.currentAction && this.currentAction !== a) this.currentAction.fadeOut(0.15);
    a.reset().fadeIn(0.15).play();
    this.currentAction = a;
  }

  _setLock(name, ms) {
    this._lock = name;
    this._lockTimer = ms / 1000;
  }

  // Chain: sheath → heal (HP restored mid-clip) → draw. Consumes one estus.
  // Roll during heal cancels (drops flask), because Souls.
  _startHeal() {
    if (this.estus <= 0) return false;
    if (!this.actions.sheath || !this.actions.heal || !this.actions.draw) return false;
    this.estus -= 1;
    this._setLock('heal', COMBAT.PLAYER.healDurationMs);
    this._healPhase = 'sheath';
    this._healElapsed = 0;
    const a = this.actions.sheath;
    if (this.currentAction && this.currentAction !== a) this.currentAction.fadeOut(0.1);
    a.reset().fadeIn(0.1).play();
    this.currentAction = a;
    return true;
  }

  // Advance the heal chain by time — three phases spread across the configured
  // duration. HP is credited on entering the 'heal' phase so the player feels
  // the heal land in the middle of the drinking motion.
  _updateHeal(delta) {
    if (this._lock !== 'heal') return;
    this._healElapsed += delta;
    const d = COMBAT.PLAYER.healDurationMs / 1000;
    const p = this._healElapsed / d;
    if (this._healPhase === 'sheath' && p > 0.33) {
      this.sheathSword();
      const h = this.actions.heal;
      if (h) { this.currentAction?.fadeOut(0.1); h.reset().fadeIn(0.1).play(); this.currentAction = h; }
      gameState.playerHP = Math.min(gameState.playerMaxHP, gameState.playerHP + COMBAT.PLAYER.healRestore);
      this._healPhase = 'heal';
    } else if (this._healPhase === 'heal' && p > 0.78) {
      this.drawSword();
      const dr = this.actions.draw;
      if (dr) { this.currentAction?.fadeOut(0.1); dr.reset().fadeIn(0.1).play(); this.currentAction = dr; }
      this._healPhase = 'draw';
    } else if (this._healPhase === 'draw' && p >= 1.0) {
      this._lock = null;
      this._healPhase = null;
    }
  }

  sheathSword() {
    if (!this.sword || !this._backBone) return;
    this._swordHomeLocal = {
      position: this.sword.position.clone(),
      quaternion: this.sword.quaternion.clone(),
      scale: this.sword.scale.clone(),
    };
    console.log('[sheath] capture home local', {
      pos: this.sword.position.toArray().map((n) => +n.toFixed(4)),
      quat: this.sword.quaternion.toArray().map((n) => +n.toFixed(4)),
      scale: this.sword.scale.toArray().map((n) => +n.toFixed(4)),
      parent: this.sword.parent?.name,
    });
    this._backBone.attach(this.sword);
    console.log('[sheath] after attach to back', {
      pos: this.sword.position.toArray().map((n) => +n.toFixed(4)),
      parent: this.sword.parent?.name,
    });
  }
  drawSword() {
    if (!this.sword || !this._handBone) return;
    console.log('[draw] before reparent', {
      pos: this.sword.position.toArray().map((n) => +n.toFixed(4)),
      parent: this.sword.parent?.name,
    });
    this._handBone.add(this.sword);
    if (this._swordHomeLocal) {
      this.sword.position.copy(this._swordHomeLocal.position);
      this.sword.quaternion.copy(this._swordHomeLocal.quaternion);
      this.sword.scale.copy(this._swordHomeLocal.scale);
    }
    console.log('[draw] after snap to home', {
      pos: this.sword.position.toArray().map((n) => +n.toFixed(4)),
      quat: this.sword.quaternion.toArray().map((n) => +n.toFixed(4)),
      scale: this.sword.scale.toArray().map((n) => +n.toFixed(4)),
      parent: this.sword.parent?.name,
    });
  }

  update(delta, input, cameraYaw) {
    // Tick heal + stagger timers before reading input, so a stagger that
    // expires this frame is treated as NORMAL for input purposes.
    if (this._lock === 'stagger') {
      this._lockTimer -= delta;
      if (this._lockTimer <= 0) this._lock = null;
    }
    this._updateHeal(delta);

    const dead = this._lock === 'dead';
    const axis = dead ? { x: 0, z: 0, running: false } : input.axis();

    // Consume edges BEFORE the movement-anim selector so the locks take
    // effect this same frame — avoids a 1-frame walk blip between press and
    // swing. Every edge accessor auto-clears so it's safe to poll even when
    // gated.
    const rollEdge    = !dead ? input.rollPressed()   : (input.rollPressed(), false);
    const lightEdge   = !dead ? input.attackPressed() : (input.attackPressed(), false);
    const heavyEdge   = !dead ? input.heavyPressed()  : (input.heavyPressed(), false);
    const healEdge    = !dead ? input.healPressed()   : (input.healPressed(), false);
    const blockNow    = !dead && input.blockHeld();

    // Block is orthogonal to the lock — but incompatible with attack/heal.
    this._blocking = blockNow && this._lock !== 'attack' && this._lock !== 'heal';

    // Roll. Cancels attack, heal, block, stagger (Souls: roll is the escape).
    // Two timers run in parallel:
    //   - rollTimer matches the clip duration so the animation plays fully
    //     before we drop back into idle/walk (previously used the 420ms
    //     i-frame value, which chopped the clip mid-roll).
    //   - rollIFrameTimer is the i-frame window; CombatSystem checks it via
    //     isInvulnerable() to skip damage. Always shorter than rollTimer so
    //     the "vulnerable" tail of the roll is a real window you can get
    //     clipped in.
    //
    // Direction is committed at the moment of press. If WASD is held, roll
    // in that camera-relative direction; else roll forward (player facing).
    // No mid-roll steering — mirror Souls.
    if (rollEdge && !this.isRolling && !dead && this._drainStamina(COMBAT.PLAYER.staminaRollCost)) {
      this.isRolling = true;
      // Wallclock duration = clip.duration / timeScale. We play the roll
      // clip faster (ROLL_TIMESCALE × 1) so the anim snap feels like a
      // dodge, not a slow tumble; the rollTimer matches that effective
      // duration so state exits cleanly when the anim visibly lands.
      const rollClipDur = this.actions.roll?.getClip?.()?.duration ?? 0.9;
      this.rollTimer = rollClipDur / PLAYER.ROLL_TIMESCALE;
      this.rollIFrameTimer = PLAYER.ROLL_IFRAMES_MS / 1000;
      if (this._lock === 'attack' || this._lock === 'heal' || this._lock === 'stagger') {
        this._lock = null;
        this._attackSpec = null;
        this._healPhase = null;
      }
      this._blocking = false;
      // Direction snapshot. axis is input.axis() — camera-relative not world.
      // Convert to world like the movement math below does.
      const sinCY = Math.sin(cameraYaw);
      const cosCY = Math.cos(cameraYaw);
      const inputMag = Math.hypot(axis.x, axis.z);
      if (inputMag > 0.05) {
        this._rollDir = {
          x: axis.x * cosCY + axis.z * sinCY,
          z: -axis.x * sinCY + axis.z * cosCY,
        };
      } else {
        // No input → roll forward along the player's current facing.
        this._rollDir = {
          x: Math.sin(this.mesh.rotation.y),
          z: Math.cos(this.mesh.rotation.y),
        };
      }
      // Face the roll direction immediately so the character dives the
      // right way (no lagged turn).
      this.desiredYaw = Math.atan2(this._rollDir.x, this._rollDir.z);
      if (this.actions.roll) {
        const r = this.actions.roll;
        r.timeScale = PLAYER.ROLL_TIMESCALE;   // snap up the clip so it reads as a dodge
        this.currentAction?.fadeOut(0.08);
        r.reset().fadeIn(0.08).play();
        this.currentAction = r;
        // Snapshot hip for root-motion absorb at roll end — same pattern
        // as attacks. Covers the "Jumping Down" fallback clip, which
        // carries a big forward hip translation.
        this.absorb?.captureStart();
      }
      // Roll audio — a soft coconut thud sells the impact of the dive.
      this.audio?.play('roll-land', { volume: 0.55, varyPitch: 0.1 });
    }
    if (this.isRolling) {
      this.rollTimer -= delta;
      this.rollIFrameTimer = Math.max(0, (this.rollIFrameTimer ?? 0) - delta);
      if (this.rollTimer <= 0) { this.isRolling = false; this._rollDir = null; }
    }

    // Attack inputs only fire when free AND stamina is available.
    if (!dead && this._lock === null && !this.isRolling && !this._blocking) {
      if (lightEdge && this.actions.lightAttack && this._drainStamina(COMBAT.PLAYER.staminaLightCost)) {
        this._startAttack('lightAttack', COMBAT.LIGHT_ATTACK);
      } else if (heavyEdge && this.actions.heavyAttack && this._drainStamina(COMBAT.PLAYER.staminaHeavyCost)) {
        this._startAttack('heavyAttack', COMBAT.HEAVY_ATTACK);
      } else if (healEdge) {
        this._startHeal();
      }
    }

    // Stamina regen each frame when not mid-drain-cooldown.
    this._regenStamina(delta);

    // Movement speed modulation by state. Blocking walks slow; staggered
    // locks in place; attacking locks; heal locks; dead locks.
    let moveMul = 1.0;
    if (this.isRolling)           moveMul = 0;   // handled below via the locked roll direction
    else if (this._blocking)      moveMul = 0.55;
    else if (this._lock)          moveMul = 0.0;

    const base = this.isRolling ? PLAYER.ROLL_SPEED
               : axis.running   ? PLAYER.SPEED * 1.6
               :                  PLAYER.SPEED;
    const speed = base * (this.isRolling ? 1 : moveMul);

    // Movement vector. During a roll use the snapshotted direction from
    // roll-start and IGNORE input — Souls rolls commit. Otherwise use
    // camera-relative WASD like normal.
    let moveX, moveZ;
    if (this.isRolling && this._rollDir) {
      moveX = this._rollDir.x;
      moveZ = this._rollDir.z;
    } else {
      const sinCY = Math.sin(cameraYaw);
      const cosCY = Math.cos(cameraYaw);
      moveX = axis.x * cosCY + axis.z * sinCY;
      moveZ = -axis.x * sinCY + axis.z * cosCY;
    }
    const dPosX = moveX * speed * delta;
    const dPosZ = moveZ * speed * delta;
    this.mesh.position.x += dPosX;
    this.mesh.position.z += dPosZ;

    // Footsteps — trigger each time the player accumulates one "stride" of
    // movement. Run strides are shorter (faster cadence). Not fired during
    // rolls (the roll-land sound already covers the dive impact) or locks.
    if (!this.isRolling && !this._lock) {
      const step = Math.hypot(dPosX, dPosZ);
      if (step > 0.001) {
        this._stepAccum = (this._stepAccum ?? 0) + step;
        const stride = axis.running ? 1.3 : 1.8;
        if (this._stepAccum >= stride) {
          this._stepAccum = 0;
          this.audio?.playStep({ volume: axis.running ? 0.5 : 0.4 });
        }
      } else {
        this._stepAccum = 0;
      }
    }

    // Facing: while not locked-on, movement direction decides the yaw.
    // While locked-on, Game has already set desiredYaw to the boss's
    // direction this frame — don't overwrite it, so the player always
    // faces the target even when strafing.
    if (!this.lockedOn && (moveX !== 0 || moveZ !== 0) && !this._lock && !this.isRolling) {
      this.desiredYaw = Math.atan2(moveX, moveZ);
    }
    const yawDelta = angleDelta(this.mesh.rotation.y, this.desiredYaw);
    this.mesh.rotation.y += yawDelta * Math.min(1, PLAYER.TURN_SPEED * delta);

    // Gradual root-motion absorb — applies one step of the pending
    // attack-clip drift into mesh.position BEFORE the VRM sync, so the
    // pose blend (attack-end fading to idle) and the position shift move
    // in lockstep. Lockstep is what kills the end-of-swing teleport; any
    // 1-frame offset and you see a lurch.
    this.absorb?.update(delta);

    if (this._vrmRoot) {
      this._vrmRoot.position.copy(this.mesh.position);
      this._vrmRoot.position.y -= 0.9;
      this._vrmRoot.rotation.y = this.mesh.rotation.y + PLAYER_VRM.facingOffset;
    }

    if (this.mixer) this.mixer.update(delta);
    if (this.vrm) {
      this.vrm.humanoid?.update?.();
      this.vrm.expressionManager?.update?.();
      this.vrm.lookAt?.update?.(delta);
      this.vrm.nodeConstraintManager?.update?.();
      this._sbAccum = (this._sbAccum ?? 0) + delta;
      if ((++this._sbTick || (this._sbTick = 1)) % 2 === 0) {
        this.vrm.springBoneManager?.update?.(Math.min(this._sbAccum, 0.05));
        this._sbAccum = 0;
      }
    }

    // Movement-state animation selector. The lock and block flag override.
    if (this.actions.idle && !this._lock && !this.isRolling) {
      if (this._blocking && this.actions.block) {
        this.play('block');
      } else {
        const moving = Math.hypot(moveX, moveZ) > 0.05;
        const want = moving && axis.running && this.actions.run ? 'run'
          : moving && this.actions.walk ? 'walk'
          : 'idle';
        this.play(want);
      }
    }
  }

  // Fires an attack action and registers it with CombatSystem so the hit
  // window logic runs against the right clip. Also captures the hip bone's
  // world position so _commitAttackRootMotion can absorb the animation's
  // root drift back into mesh.position on finish.
  _startAttack(clipName, spec) {
    const a = this.actions[clipName];
    if (!a) return;
    this._setLock('attack', 0);            // finished-event clears it
    this._attackSpec = spec;
    if (this.currentAction && this.currentAction !== a) this.currentAction.fadeOut(0.08);
    a.reset().fadeIn(0.08).play();
    this.currentAction = a;
    this.combat?.registerPlayerAttack(a, spec);

    // Swing whoosh — dedicated player-sized whoosh, heavier strike gets a
    // lower base pitch + louder volume plus an effort grunt. Lights stay
    // tight so the two reads cleanly distinct.
    const isHeavy = clipName === 'heavyAttack';
    this.audio?.play('sword-swing', {
      volume: isHeavy ? 0.55 : 0.4,
      varyPitch: isHeavy ? 0.05 : 0.1,
    });
    if (isHeavy) {
      const grunt = Math.random() < 0.5 ? 'grunt-a' : 'grunt-b';
      this.audio?.play(grunt, { volume: 0.5, varyPitch: 0.08, delaySec: 0.03 });
    }

    // Snapshot hip world position via the RootMotionAbsorb module.
    // commit() runs in the mixer.finished handler and applies the drift
    // gradually over the idle crossfade so the lunge visually lands at
    // the end of the swing with no teleport.
    this.absorb?.captureStart();
  }
}

// fadeMs shared between RootMotionAbsorb and the mixer.finished idle
// crossfade. Must match — the two fades need to move in lockstep for the
// `gradual` strategy to cancel the end-of-swing teleport. See
// systems/RootMotionAbsorb.js for the full write-up.
const PLAYER_ABSORB_FADE_MS = 200;

function angleDelta(from, to) {
  let d = to - from;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
