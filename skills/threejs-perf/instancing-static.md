# Instancing Large Static Object Sets

## Problem

Rendering large numbers of repeated props (trees, rocks, debris, decorations) as separate `Mesh` objects creates unnecessary draw calls, increases renderer overhead, and destabilizes frame time before GPU throughput is the real bottleneck.

## Use When

- Many objects share the same geometry (BoxGeometry, loaded GLB, etc.)
- Many objects share the same material or a material variant that can be encoded efficiently
- Per-instance transforms differ but the render path is otherwise identical
- Object count exceeds ~50 for a single geometry+material combo

## Avoid When

- Every object needs materially different shaders or uniforms that defeat shared rendering
- Geometry differs enough that instancing provides no batching benefit
- Object count is too low for the complexity to matter (<20)

## Anti-Patterns

- Creating one `Mesh` per prop for forests, debris, or large decoration sets
- Treating small transform differences as a reason to skip instancing
- Rebuilding instance data every frame when transforms are mostly static
- Adding objects to deeply nested groups instead of a flat InstancedMesh

## Implementation

### Baseline (Anti-Pattern): Individual Meshes

```ts
import { BoxGeometry, Mesh, MeshStandardMaterial, Scene } from 'three';

const geometry = new BoxGeometry(1, 1, 1);
const material = new MeshStandardMaterial({ color: 0x7aa95c });
const scene = new Scene();

// 19,600 draw calls — one per mesh
for (let x = 0; x < 140; x++) {
  for (let z = 0; z < 140; z++) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x * 1.5, 0, z * 1.5);
    scene.add(mesh);
  }
}
```

### Optimized: Single InstancedMesh

```ts
import { BoxGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Scene } from 'three';

const geometry = new BoxGeometry(1, 1, 1);
const material = new MeshStandardMaterial({ color: 0x7aa95c });
const scene = new Scene();
const instanceCount = 140 * 140;
const matrix = new Matrix4();
const instancedMesh = new InstancedMesh(geometry, material, instanceCount);

let index = 0;
for (let x = 0; x < 140; x++) {
  for (let z = 0; z < 140; z++) {
    matrix.makeTranslation(x * 1.5, 0, z * 1.5);
    instancedMesh.setMatrixAt(index, matrix);
    index++;
  }
}

instancedMesh.instanceMatrix.needsUpdate = true;
scene.add(instancedMesh); // 1 draw call
```

## Key Points

1. **Share geometry AND material**: `InstancedMesh` requires a single geometry and a single material. If you need material variants, use `instanceColor` or custom attributes.
2. **Set `needsUpdate = true`**: After writing all matrices, set `instancedMesh.instanceMatrix.needsUpdate = true`. Only do this once after all writes, not per-instance.
3. **Pre-allocate the count**: Pass the total instance count to the constructor. You can hide unused instances by setting `instancedMesh.count` to a lower value.
4. **Use a reusable `Matrix4`**: Create one `Matrix4` and reuse it for all `setMatrixAt` calls. Don't allocate per-instance.
5. **Instance colors**: Use `instancedMesh.setColorAt(index, color)` and set `instancedMesh.instanceColor.needsUpdate = true` for per-instance color variation.

## Per-Instance Color Example

```js
const color = new THREE.Color();
for (let i = 0; i < count; i++) {
  color.setHSL(Math.random(), 0.7, 0.5);
  instancedMesh.setColorAt(i, color);
}
instancedMesh.instanceColor.needsUpdate = true;
```

## Measured Results

Scenario: 140×140 grid = 19,600 cubes, Three.js r183, headless Chromium 147 (scripted benchmark), Apple M1 Pro, 30 warmup + 180 sample frames, median of 3 runs.

| Metric | Baseline | Optimized | Delta |
|--------|----------|-----------|-------|
| Draw calls (avg) | ~19,365 | 2 | ~9,682× fewer |
| Render CPU p95 | 28.5ms | 0.5ms | ~57× faster |
| Render CPU mean | 19.6ms | 0.21ms | ~95× faster |
| Build | 39.4ms | 3.9ms | ~10× faster |
| Mesh count | 19,600 | 0 | -100% |
| InstancedMesh count | 0 | 1 | +1 |

The optimized case reports 2 draw calls (not 1) because the scene also contains a floor plane — the 19,600-cube `InstancedMesh` itself is a single draw call. Baseline draw calls sit at ~19,365 rather than 19,600 because individual meshes at the far edges get frustum-culled; `InstancedMesh` does not cull per-instance, so it's all-or-nothing.

FPS and frame-time p95 are not cited here — headless Chromium without a GPU runs software WebGL (SwiftShader), which makes GPU-bound timing unreliable. On real hardware the FPS delta would be substantially larger.

## Template Files

See `templates/static-world-baseline.ts` and `templates/static-world-instanced.ts` for drop-in reference implementations.
