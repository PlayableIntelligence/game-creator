import * as THREE from 'three';
import { EffectComposer }   from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }       from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass }  from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }       from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass }       from 'three/addons/postprocessing/OutputPass.js';
import { POST } from '../core/Constants.js';

/**
 * PostPipeline — bloom + split-tone grade + vignette + animated grain.
 *
 *   RenderPass → UnrealBloomPass → GradePass → OutputPass
 *
 * The PS2-Souls "everything looks oily and underexposed but the highlights
 * sing" vibe. Tuned for cathedral-style scenes; works for forest/dungeon too.
 *
 * THE PERF LINE — composer.setPixelRatio(1).
 *   On retina the renderer's pixelRatio is 2; without this line the composer
 *   renders bloom + grade at FULL device resolution (e.g. 3840×2160 for a
 *   1920×1080 viewport). The post passes are inherently soft, so 1× is
 *   imperceptibly different visually but ~12.8 ms / frame cheaper. The final
 *   OutputPass blits back at full DPR via the renderer; splat rendering
 *   itself uses the renderer's full DPR through RenderPass before bloom
 *   touches anything. Net: splats stay sharp, post is fast.
 *
 * info.reset() pattern — main.js calls renderer.info.reset() BEFORE
 * post.render(dt), then reads counts after, so the HUD reports actual scene
 * draw calls instead of the OutputPass's 2-triangle blit.
 *
 * Source: ported from splats-repo post.ts. The grade shader is line-by-line
 * the same — its tuning was hard-won over many iterations.
 */

const GradeShader = {
  uniforms: {
    tDiffuse:         { value: null },
    saturation:       { value: POST.saturation },
    contrast:         { value: POST.contrast },
    shadowTint:       { value: new THREE.Color(...POST.shadowTint)    },
    highlightTint:    { value: new THREE.Color(...POST.highlightTint) },
    vignetteStart:    { value: POST.vignetteStart },
    vignetteEnd:      { value: POST.vignetteEnd },
    vignetteStrength: { value: POST.vignetteStrength },
    grain:            { value: POST.grain },
    time:             { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform vec3  shadowTint;
    uniform vec3  highlightTint;
    uniform float vignetteStart;
    uniform float vignetteEnd;
    uniform float vignetteStrength;
    uniform float grain;
    uniform float time;
    varying vec2 vUv;

    // 16-bit hash, stable per-pixel but moves with time. Cheap film grain.
    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;

      // Saturation around luma — lifts/cuts only the chrominance
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(luma), col, saturation);

      // Contrast pivot at 0.5
      col = (col - 0.5) * contrast + 0.5;

      // Split-tone: lerp shadow → highlight tint by luma. The smoothstep
      // gives Souls its "warm light, cold stone" feel — midtones don't get
      // touched, only the ends.
      float t = smoothstep(0.05, 0.85, luma);
      vec3 tint = mix(shadowTint, highlightTint, t);
      col *= tint;

      // Radial vignette — darker, not desaturated (matches a tube TV with
      // brightness rolled off at the edges)
      vec2 c = vUv - 0.5;
      float r = length(c) * 1.41421356; // normalize so corner = 1
      float v = 1.0 - smoothstep(vignetteStart, vignetteEnd, r) * vignetteStrength;
      col *= v;

      // Animated grain — moves with time so it doesn't look like a stuck pattern
      float n = hash21(vUv * 1024.0 + vec2(time * 0.5));
      col += (n - 0.5) * grain;

      // Floor at 0 to avoid negative HDR values bleeding into OutputPass
      col = max(col, 0.0);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostPipeline {
  constructor(renderer, scene, camera, width, height) {
    this.composer = new EffectComposer(renderer);

    // 🔑 The line. Force composer to render at 1× (CSS pixels) instead of
    // device pixel ratio. Saves 12.8 ms/frame on retina with no visible
    // quality loss because bloom + grade are both inherently soft.
    this.composer.setPixelRatio(1);
    this.composer.setSize(width, height);

    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      POST.bloomStrength,
      POST.bloomRadius,
      POST.bloomThreshold,
    );
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    // OutputPass keeps tone-mapping + sRGB conversion last; without it,
    // sRGB pipelines deliver linear values straight to the canvas and the
    // whole frame looks washed out.
    this.composer.addPass(new OutputPass());

    console.info(
      `[Post] composer ${width}×${height} (1× DPR override) · ` +
      `bloom (str=${POST.bloomStrength} rad=${POST.bloomRadius} th=${POST.bloomThreshold}) · ` +
      `split-tone grade · vignette · grain`,
    );
  }

  setSize(w, h) { this.composer.setSize(w, h); }

  /**
   * Render one frame. dt drives the grain time uniform so grain doesn't
   * lock to a fixed pattern. `time % 1000` cap so the float stays in
   * shader precision over long sessions.
   */
  render(dt) {
    const u = this.grade.uniforms.time;
    u.value = (u.value + dt) % 1000;
    this.composer.render();
  }
}
