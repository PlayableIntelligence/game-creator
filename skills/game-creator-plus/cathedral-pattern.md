# The Cathedral Pattern

> Empty + Image + Floor + Light = Playable.

This is the actual product moat. Marble 1.1 Plus + raw user prompt produces beautiful viewers but unplayable levels. The Cathedral Pattern is the recipe that makes them playable.

Named after the worked example: a 30m³ cathedral interior, mostly empty, with stained glass and a flat floor, ready for a boss fight.

## Why this works

Marble bakes everything into the splat — including imagined furniture, debris, NPCs, environmental clutter. The auto-generated collider mesh tracks every visible surface, so:

- A fake chair in the splat = a real invisible wall in the collider
- A flickering candle on a table = a small invisible obstacle
- A pile of rubble = an unwalkable region
- "Atmospheric" floor textures (cracked tiles, scattered leaves) = bumpy collider that snags the player capsule

The model can't tell us what's "decoration" vs "geometry"; from its perspective they're the same. The cathedral pattern works around this by **prompting for emptiness**, then **adding controlled geometry back in code**.

## The four ingredients

### 1. Empty interior prompt augmentation

`plus-generate-world.mjs` auto-prepends a cathedral-pattern preamble to every prompt:

```
mostly empty interior, high ceilings, clear walking paths,
no furniture or debris on the floor, photorealistic,
{user prompt}
```

You can disable with `--no-augment` but you almost never want to. Without augmentation, Marble adds a center-of-room throne, scattered candles, fallen banners — all of which become invisible-wall collision geometry.

**Worked example:**

| User prompt | What Marble sees (augmented) | What you get |
|---|---|---|
| "a gothic cathedral" | "mostly empty interior, high ceilings, clear walking paths, no furniture or debris on the floor, photorealistic, a gothic cathedral" | Vast empty nave, flying buttresses, stained glass, walkable end-to-end |
| "a packed wizard's library" | (augmented) "...a packed wizard's library" | The model **resists** "packed" because of "no furniture/debris" — you get an empty library room with bookshelves only on walls. **This is the right tradeoff** — players need to walk around |
| "a busy marketplace" | (augmented) "...a busy marketplace" | An empty plaza with stalls only at the edges. The augmentation wins; "busy" is downweighted |

If the user explicitly wants clutter ("the floor is covered in scrolls"), tell them: this scene won't be walkable as a game level. Suggest either generating two scenes (clutter version for cinematic, empty version for gameplay) or adding clutter post-hoc as Meshy props with their own colliders.

### 2. Reference image (strongly recommended)

The single biggest quality lever. Marble's text-to-3D is impressionistic; image-to-3D is faithful.

**With image:** model copies stained-glass placement, lighting direction, material vocabulary (stone vs marble vs wood), color palette, sky tint, fog density. The result feels intentional.

**Text-only:** model picks a generic interpretation. Five generations with the same prompt give five different rooms. Walls might be brick or stone or wood; lighting might come from windows or torches or open ceiling. Hard to design a game around something you can't predict.

The augmentation still applies in image mode — image controls **look**, prompt controls **layout/contents**. So image of a cathedral + augmented prompt "a gothic cathedral" gives you the user's exact cathedral, emptied for play.

**Image sourcing:**

- User-provided is best (matches their vision)
- Stock photo sites (Unsplash, Pexels) for quick prototypes
- AI-generated reference (Midjourney, SDXL) is fine — Marble is fine with synthetic input
- Avoid: heavily filtered photos (Instagram filters confuse material extraction), crowd shots (Marble fixates on people), text-heavy images (signs, posters)

### 3. Fake floor

The single biggest gameplay-feel lever.

Marble's collider includes the bumpy real floor — every cracked tile, every rug fold, every little undulation in the photogrammetric scan. Walking on this feels terrible: capsule jitters, jumps trip on lips, sprinting catches on edges.

The fix:

```
1. peekColliderInfo() raycasts down from bbox center → finds true floor Y
2. installFakeFloor() places a smooth Rapier cuboid 5cm above
   - 90% of bbox XZ extent (slab doesn't cut into walls)
   - 0.5m thick (capsule can't tunnel through)
   - Optional visual: Polyhaven marble texture, matte
3. loadCollision() with floorCullY=fakeFloorTop → drops every triangle
   below the fake floor from the trimesh
```

End result: walls and ceiling are real (from Marble), floor is synthetic and perfect.

The visual marble texture is optional but recommended — it's neutral enough to blend with most architectural styles, and `renderOrder=10` makes it occlude any gaussians beneath it (so you don't see the bumpy real floor poking through).

See [splat-techniques.md](./splat-techniques.md) for the implementation.

### 4. Lightness bake (optional, +30s)

The splat IS the lighting — it's all baked into the gaussians. PBR meshes (player, enemies, props) have no idea, so they render flat against a photorealistic backdrop. Looks instantly like a video-game character pasted onto a movie still.

The lightness bake fixes this:

```
1. After scene fully loaded, bake-lightness tool:
   - Hides character/debug meshes
   - For each 1m × 1m grid cell at floor + 1m height:
     - Renders 6 cube faces at 16×16 resolution
     - Computes mean Rec. 601 luminance
   - Writes lightness.json (~30–80 KB)
2. Runtime LightnessSampler:
   - Loads lightness.json on init
   - attach(mesh) hooks mesh.onBeforeRender:
     - Bilinear sample at mesh world position
     - Modulate envMapIntensity = lerp(min, max, luminance)
   - Result: characters dim in shadows, brighten in light shafts
```

For a cathedral: character entering the nave from a side chapel visibly brightens as they cross into the rose-window light beam. Free environmental storytelling.

**Skip when:**
- No PBR characters in the scene (pure splat viewer)
- Performance-critical mobile (60 readbacks per render-loop frame is too much; use a smaller grid)
- Dev iteration (bake takes 30s, only do for the production scene)

**Default: bake.** It's cheap, it's optional, the JSON ships in `public/`.

## Worked examples

### Example 1: Gothic cathedral boss fight

```bash
node scripts/plus-generate-world.mjs \
  --prompt "a gothic cathedral with stained glass windows" \
  --image ./refs/cathedral-interior.jpg \
  --slug cathedral \
  --output public/assets/worlds/
```

Augmented prompt sent to Marble:
```
mostly empty interior, high ceilings, clear walking paths,
no furniture or debris on the floor, photorealistic,
a gothic cathedral with stained glass windows
```

Result: 30m × 60m × 25m vaulted nave, walkable end-to-end, stained-glass color matches reference image, flat marble floor, ready to drop a boss enemy in the center.

Cost: $1.20 (1 cube — single interior fits) + $0 lightness bake = **$1.20**

### Example 2: Sci-fi corridor

```bash
node scripts/plus-generate-world.mjs \
  --prompt "a long sterile sci-fi corridor with overhead pipes" \
  --image ./refs/corridor.png \
  --slug corridor \
  --output public/assets/worlds/
```

Augmented prompt:
```
mostly empty interior, high ceilings, clear walking paths,
no furniture or debris on the floor, photorealistic,
a long sterile sci-fi corridor with overhead pipes
```

Result: 4m × 30m corridor with pipe-clad ceiling, even fluorescent lighting, totally clear floor. Ready for patrolling enemies, sliding doors as Meshy props.

Cost: $1.20 (1 cube) = **$1.20**

### Example 3: Auto-expanding multi-room dungeon

```bash
node scripts/plus-generate-world.mjs \
  --prompt "an underground dungeon with multiple connected stone chambers, torchlight, low ceiling" \
  --image ./refs/dungeon.jpg \
  --slug dungeon \
  --output public/assets/worlds/
```

Marble 1.1 Plus auto-expands when the prompt implies more space — "multiple chambers" triggers it. Probably 3–4 cubes.

Cost: $1.20 base + 3 × $0.24 = **$1.92** for ~3-room dungeon, ~12 minutes generation.

## Bad-prompt failure modes

These prompts fight the cathedral pattern. Either reword, or accept that the result won't be playable.

### "A cluttered alchemist's workshop"

The augmentation removes the clutter. User gets an empty workshop. If they wanted the clutter, this is the wrong tool — generate empty + add Meshy props.

### "A crowded medieval tavern"

"Crowded" implies NPCs, which Marble bakes into the splat as un-collidable visual fluff that looks awful when the player walks through them. Use Meshy for the NPCs separately, prompt this scene as "an empty medieval tavern".

### "An open field"

No interior to be empty inside. Marble does outdoor scenes but the cathedral pattern doesn't help — fake floor is wrong (real ground is fine outdoors), prompt augmentation is wrong (no "interior"). Use the bare `worldlabs` skill instead.

### "A spaceship cockpit, fully detailed dashboard"

Detailed dashboard = lots of small surfaces = collider noise. The "no furniture" augmentation undoes the dashboard request. Better: generate the cockpit empty, model the dashboard as a Meshy prop.

### "A landscape with a castle in the distance"

Two-scale problem — the castle is decoration (visual only) but might end up close enough to walk into and clip through. Tell the user to pick: walkable interior of castle, or distant-vista landscape, not both.

## Quick decision tree

```
User wants splat level?
├── Indoor? → Cathedral Pattern applies
│   ├── Has reference image? → Apply pattern, generate
│   └── Text only? → Warn "results vary", apply pattern, generate
└── Outdoor? → Bare worldlabs skill, no fake-floor, no augmentation
```

```
Has clutter in their description?
├── Decorative clutter (textures, atmosphere)? → OK, augmentation downweights it gracefully
├── Specific objects on floor (rubble, papers)? → Tell user: regenerate empty + add Meshy props
└── Many NPCs? → Generate empty + Meshy NPCs separately
```
