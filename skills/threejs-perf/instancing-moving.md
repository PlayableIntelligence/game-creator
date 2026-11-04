# Moving Entity Update Loops with InstancedMesh

## Problem

Animating thousands of entities (enemies, particles, swarm members, NPCs) as independent `Mesh` objects creates avoidable scene-graph churn, transform propagation cost, and renderer overhead. The bottleneck shifts from GPU to CPU-side scene management.

## Use When

- Many moving actors share the same geometry and material
- The simulation can write per-instance transforms in batches
- The bottleneck is update-loop overhead or scene complexity, not GPU fill rate
- Entity count exceeds ~100 with shared geometry

## Avoid When

- Each entity needs unique material/shader state that defeats shared rendering
- Object counts are low enough that simpler per-Mesh code is preferable (<50)
- Entities need individual raycasting or picking (InstancedMesh raycasting requires extra work)

## Anti-Patterns

- One `Mesh` per actor for large swarms or crowds
- Per-entity object allocation inside the hot update loop
- Updating transforms through deep scene graphs when flat batched state is sufficient
- Creating/destroying Meshes per frame instead of reusing instance slots

## Implementation

### Baseline (Anti-Pattern): Individual Moving Meshes

```ts
import { BoxGeometry, Mesh, MeshStandardMaterial, Scene } from 'three';

const scene = new Scene();
const geometry = new BoxGeometry(0.5, 0.5, 0.5);
const material = new MeshStandardMaterial({ color: 0x4ea7d8 });
const meshes = [];

for (let i = 0; i < 8000; i++) {
  const mesh = new Mesh(geometry, material);
  meshes.push(mesh);
  scene.add(mesh);
}

// Per-frame update: 8000 individual position writes
function update(tick) {
  for (let i = 0; i < meshes.length; i++) {
    meshes[i].position.x = computeX(i, tick);
    meshes[i].position.y = computeY(i, tick);
    meshes[i].position.z = computeZ(i, tick);
  }
}
```

### Optimized: Batched InstancedMesh Writes

```ts
import { BoxGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Scene } from 'three';

const scene = new Scene();
const geometry = new BoxGeometry(0.5, 0.5, 0.5);
const material = new MeshStandardMaterial({ color: 0x4ea7d8 });
const count = 8000;
const instancedMesh = new InstancedMesh(geometry, material, count);
const matrix = new Matrix4();

// Initial placement
for (let i = 0; i < count; i++) {
  matrix.makeTranslation(0, 0, 0);
  instancedMesh.setMatrixAt(i, matrix);
}
instancedMesh.instanceMatrix.needsUpdate = true;
scene.add(instancedMesh);

// Per-frame update: batched matrix writes, single needsUpdate
function update(tick) {
  for (let i = 0; i < count; i++) {
    matrix.makeTranslation(
      computeX(i, tick),
      computeY(i, tick),
      computeZ(i, tick),
    );
    instancedMesh.setMatrixAt(i, matrix);
  }
  instancedMesh.instanceMatrix.needsUpdate = true; // Once per frame
}
```

## Key Points

1. **Flat state buffer**: Keep entity state (position, velocity, health) in flat arrays or a typed buffer. Don't store state on Three.js objects.
2. **Batch all writes, then set `needsUpdate` once**: Write all instance matrices in a single loop, then set `instanceMatrix.needsUpdate = true` once at the end.
3. **Reuse the `Matrix4`**: One shared matrix for all `setMatrixAt` calls. Zero per-frame allocations.
4. **Hide dead entities**: Set `instancedMesh.count` to the number of active entities. Swap dead entities to the end of the buffer.
5. **Rotation + scale**: Use `matrix.compose(position, quaternion, scale)` instead of `makeTranslation` when entities need rotation or non-uniform scale.

## Entity Pool Pattern

```js
const MAX_ENTITIES = 10000;
let activeCount = 0;
const positions = new Float32Array(MAX_ENTITIES * 3);
const velocities = new Float32Array(MAX_ENTITIES * 3);
const instancedMesh = new THREE.InstancedMesh(geo, mat, MAX_ENTITIES);

function spawn(x, y, z, vx, vy, vz) {
  if (activeCount >= MAX_ENTITIES) return;
  const i = activeCount++;
  positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
  velocities[i * 3] = vx; velocities[i * 3 + 1] = vy; velocities[i * 3 + 2] = vz;
  instancedMesh.count = activeCount;
}

function kill(index) {
  // Swap with last active
  const last = --activeCount;
  positions.copyWithin(index * 3, last * 3, last * 3 + 3);
  velocities.copyWithin(index * 3, last * 3, last * 3 + 3);
  instancedMesh.count = activeCount;
}

function update(dt) {
  const mat = new THREE.Matrix4();
  for (let i = 0; i < activeCount; i++) {
    positions[i * 3] += velocities[i * 3] * dt;
    positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
    positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
    mat.makeTranslation(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    instancedMesh.setMatrixAt(i, mat);
  }
  instancedMesh.instanceMatrix.needsUpdate = true;
}
```

## Measured Results

Scenario: 8,000 entities in a wave-field (sin/cos of position + time), Three.js r183, headless Chromium 147 (scripted benchmark), Apple M1 Pro, 30 warmup + 180 sample frames, median of 3 runs.

| Metric | Baseline | Optimized | Delta |
|--------|----------|-----------|-------|
| Draw calls (avg) | 8,000 | 1 | 8,000× fewer |
| Render CPU p95 | 9.9ms | 0.5ms | ~20× faster |
| Update loop p95 | 1.4ms | 0.3ms | ~4.7× faster |
| Traversal p95 | 0.3ms | ~0ms | collapses to noise floor |
| Mesh count | 8,000 | 0 | -100% |
| InstancedMesh count | 0 | 1 | +1 |

Update loop shrinks because `matrix.makeTranslation` + `setMatrixAt(i, m)` bypasses per-`Object3D` state churn (dirty flags, matrix recompute, parent propagation). Render CPU drops by ~20× because the baseline burns ~10ms per frame just submitting 8,000 draw calls.

FPS and frame-time p95 are not cited here — headless Chromium without a GPU runs software WebGL (SwiftShader), which bottlenecks on fragment shading regardless of draw-call count. On real hardware the FPS delta would be substantially larger.

## Template Files

See `templates/moving-entities-baseline.ts` and `templates/moving-entities-instanced.ts` for drop-in reference implementations.
