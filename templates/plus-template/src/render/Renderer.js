import * as THREE from 'three';
import { DEVICE, RENDERER } from '../core/Constants.js';

/**
 * Renderer — Three.js WebGLRenderer + PerspectiveCamera + Scene tuned for
 * Gaussian-splat rendering.
 *
 * Why these defaults:
 *   - antialias: false — Spark provides its own AA via gaussian splatting.
 *     MSAA on top wastes ~30% GPU for no visible gain.
 *   - pixelRatio capped (1.5 mobile / 2 desktop) — see DEVICE.dprCap rationale.
 *   - ACES tone mapping at 0.85 exposure matches how Marble preview-renders
 *     the panorama, so splats look as intended.
 *   - PCFSoftShadowMap — sharp under character feet, soft at edges. The
 *     middle-ground default for moving SkinnedMesh shadows.
 *
 * The renderer auto-resizes on window resize; subsystems that hold a
 * composer or render target should subscribe to EVENTS.RENDERER_RESIZED
 * (added when post pipeline lands in step 10).
 */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    // Stencil + alpha both default to false — we don't need them, and
    // disabling alpha lets the canvas composite faster against the page.
  });
  renderer.setPixelRatio(DEVICE.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RENDERER.toneMappingExposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(RENDERER.background);
  return scene;
}

export function createCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.PerspectiveCamera(
    RENDERER.fov,
    aspect,
    RENDERER.near,
    RENDERER.far,
  );
  // Default position — overridden by player controller once spawned.
  camera.position.set(0, 1.7, 5);
  camera.lookAt(0, 0, 0);
  return camera;
}

/** Wire window resize → renderer + camera. Returns the listener so callers
 *  can extend it (post composer, etc.) and clean up. */
export function attachResize(renderer, camera, onResize) {
  const handler = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    onResize?.(w, h);
  };
  window.addEventListener('resize', handler);
  return handler;
}
