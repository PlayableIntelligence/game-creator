# Meshy AI — Post-Generation Verification Patterns

After loading any Meshy-generated model, **always verify orientation and scale** before proceeding. Meshy models have unpredictable facing directions and scales. Skipping this step leads to backwards-facing characters and models that overflow their containers.

## Auto-Orientation Check

Meshy models typically face +Z, but this varies. After loading, **log the bounding box and visually verify** via a screenshot (iterate client or `scripts/cdp.mjs`, viewed with Read) or dev tools:

```js
// Add this immediately after loading any GLB
model.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(model);
const size = box.getSize(new THREE.Vector3());
const center = box.getCenter(new THREE.Vector3());
console.log(`[Model] ${slug} — size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);
console.log(`[Model] ${slug} — center: ${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}`);
```

**Fixing facing direction:**
- Start with `rotationY: Math.PI` (180 degrees) — most Meshy models need this to face -Z
- If the model faces +Z by default and needs to face the camera: `rotationY: 0`
- If in doubt: take a screenshot, check which way the face/front is pointing, adjust
- Store `rotationY` in Constants.js per model — never hardcode in entity files

## Auto-Scale Fitting

Models must fit within their game context. After loading:

```js
// Calculate scale to fit a target height
const box = new THREE.Box3().setFromObject(model);
const currentHeight = box.max.y - box.min.y;
const targetHeight = 2.0; // desired height in world units
const autoScale = targetHeight / currentHeight;
model.scale.setScalar(autoScale);
```

For container fitting (e.g., robots inside a ring):
```js
// Ensure model fits within container bounds
const containerWidth = RING.PLATFORM_WIDTH * 0.8; // 80% of ring width
const modelWidth = box.max.x - box.min.x;
if (modelWidth * currentScale > containerWidth) {
  const fitScale = containerWidth / modelWidth;
  model.scale.setScalar(Math.min(currentScale, fitScale));
}
```

**Always take a screenshot after model integration** (cdp.mjs / iterate client) to visually verify:
1. Characters face the correct direction
2. Characters fit within their environment
3. Characters don't clip through floors/walls/each other

## Floor Alignment

Center the model on X/Z and plant feet on Y=0:
```js
const box = new THREE.Box3().setFromObject(model);
const center = box.getCenter(new THREE.Vector3());
model.position.y = -box.min.y;      // feet on ground
model.position.x = -center.x;       // centered X
model.position.z = -center.z;       // centered Z
```
