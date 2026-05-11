/**
 * plus-prompt-templates.js — rich Marble prompt builder.
 *
 * Marble responds dramatically better to long, structured prompts than to
 * short ones. The reference cathedral that produced our best splat (the one
 * shipped with plus-template) used a 230-word prompt with a specific
 * 7-ingredient structure — anything shorter than ~150 words tends to ship
 * with cluttered floors, wrong-direction lighting, and inconsistent walls.
 *
 * Pattern (in this exact order — Marble's instruction-following degrades
 * if you reorder):
 *
 *   1. Aesthetic style + mood
 *   2. Floor description (the most important thing for cathedral-pattern)
 *   3. Explicit clutter enumeration ("no X, no Y, no Z")
 *   4. Perimeter / walls / ceiling treatment
 *   5. Lighting direction + qualities
 *   6. Atmospheric closer + game-ready phrase
 *   7. "The 360 scene is faultless."  ← this final sentence empirically helps
 *
 * Per-scene-type templates handle indoor / outdoor / corridor / room / arena
 * variants. Each can be overridden field-by-field via flags so power users
 * can tune without writing the whole prompt by hand.
 *
 * Used by scripts/plus-generate-world.mjs. The generated prompt lands in
 * meta.json's `augmented_prompt` so you can audit what was actually sent.
 */

export const SCENE_TYPES = ['indoor', 'outdoor-clearing', 'corridor', 'room', 'arena'];

// ---------------------------------------------------------------------------
// Per-scene defaults — each field is overridable via CLI flags
// ---------------------------------------------------------------------------

const DEFAULTS = {
  indoor: {
    aesthetic: 'a painterly and desaturated style reminiscent of FromSoftware\'s Dark Souls',
    mood: 'somber and foreboding',
    floor: 'a completely empty, large, flat, smooth flagstone floor arena, meticulously swept and entirely clear from wall to wall, devoid of any obstructions',
    clutter: 'no columns, pillars, pews, chairs, altars, statues, tombs, rubble, debris, pulpits, coffins, or furniture of any kind',
    perimeter: 'distant perimeter stone walls rise dramatically into shadow, separated from the open floor by a broad, clear margin',
    lighting: 'tall, narrow stained glass windows are set into the distant walls, glowing with cold cobalt and violet light that pierces the gloom. Far overhead, a ribbed vaulted ceiling is lost in darkness. Atmospheric shafts of dim moonlight cut across the empty floor, highlighting its vastness',
    atmosphere: 'cavernous and abandoned, presenting a photorealistic yet desolate environment',
    closer: 'perfectly poised for a monumental confrontation',
  },

  'outdoor-clearing': {
    aesthetic: 'a dreamy painterly style reminiscent of a Studio Ghibli backdrop',
    mood: 'serene and magical fairy-tale',
    floor: 'a completely empty, large, flat, smooth grass meadow arena, carpeted with delicate wildflowers in purple violet, white, and yellow, entirely clear from edge to edge, devoid of any obstructions',
    clutter: 'no trees, tree trunks, tree branches, roots, logs, fallen branches, rocks, boulders, bushes, shrubs, mushrooms, stumps, fallen leaves piles, fences, or plants taller than ankle height in the central area',
    perimeter: 'a distant perimeter dense green forest treeline rises up forming a soft-focus backdrop, separated from the meadow by a broad clear margin of empty grass',
    lighting: 'atmospheric golden god rays cut diagonally through the distant canopy, illuminating the meadow. Soft glowing particles, fireflies and pollen motes drift dreamily through the warm hazy air',
    atmosphere: 'serene and idyllic, presenting a photorealistic yet idealized fairy-tale environment',
    closer: 'perfectly poised for a peaceful encounter or magical confrontation',
  },

  corridor: {
    aesthetic: 'a sterile, photorealistic sci-fi style with crisp linear geometry',
    mood: 'tense and claustrophobic',
    floor: 'a completely empty, long, flat, smooth metallic corridor floor, free of any debris or obstructions',
    clutter: 'no crates, boxes, equipment, debris, furniture, vents on the floor, conduits on the floor, or obstacles of any kind in the walking path',
    perimeter: 'parallel walls extend on both sides into the distance, with overhead pipes and recessed lighting strips, but no protrusions or alcoves at floor level',
    lighting: 'overhead fluorescent panels emit even, sterile blue-white light. Long shadows stretch down the corridor, with occasional warm-orange emergency lights flickering at intervals',
    atmosphere: 'sterile and abandoned, presenting a photorealistic yet uneasy environment',
    closer: 'perfectly poised for stealth, pursuit, or first encounter',
  },

  room: {
    aesthetic: 'a clean photorealistic interior style with soft natural light',
    mood: 'minimal and uncluttered',
    floor: 'a completely empty, flat, smooth interior floor, entirely clear from wall to wall',
    clutter: 'no furniture, no equipment, no decorations on the floor, no clutter, no debris, no rugs, no boxes — only the bare floor',
    perimeter: 'walls form a clean rectangular perimeter, separated from the open floor by clear margins, with art or window features at upper-wall height only',
    lighting: 'soft directional light enters through a single window or skylight, casting clean shadows across the floor. Ambient fill light keeps the corners legible',
    atmosphere: 'minimal and inviting, presenting a photorealistic yet abstracted environment',
    closer: 'perfectly poised for an interactive scene or product reveal',
  },

  arena: {
    aesthetic: 'a stylized cinematic style reminiscent of a fighting-game pre-match cutscene',
    mood: 'tense and grand',
    floor: 'a completely empty, large, flat, smooth circular floor arena, with a faint ring marking the boundary, devoid of any obstructions',
    clutter: 'no columns, pillars, fences, debris, rubble, or furniture of any kind in the arena',
    perimeter: 'distant perimeter walls or natural terrain rise dramatically into shadow, separated from the open floor by a broad clear margin where spectators or environment details might sit',
    lighting: 'a single dramatic key light from above carves the floor into bright and shadowed regions. The arena edges fade into atmospheric haze',
    atmosphere: 'tense and ceremonial, presenting a photorealistic yet stylized environment',
    closer: 'perfectly poised for a one-on-one combat encounter',
  },
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a rich Marble prompt from a topic + scene-type + optional overrides.
 *
 * @param {object} args
 * @param {string} args.topic                — the user's bare prompt ("a gothic cathedral")
 * @param {string} [args.sceneType='indoor'] — one of SCENE_TYPES
 * @param {string} [args.aesthetic]          — overrides default aesthetic
 * @param {string} [args.mood]               — overrides default mood
 * @param {string} [args.floor]              — overrides default floor description
 * @param {string} [args.clutter]            — overrides default clutter list
 * @param {string} [args.perimeter]          — overrides default perimeter
 * @param {string} [args.lighting]           — overrides default lighting
 * @param {string} [args.atmosphere]         — overrides default atmosphere
 * @param {string} [args.closer]             — overrides default closer
 *
 * @returns {string} a 200–250 word rich Marble prompt
 */
export function buildRichPrompt(args) {
  const sceneType = args.sceneType || 'indoor';
  const d = DEFAULTS[sceneType];
  if (!d) {
    throw new Error(
      `Unknown scene-type "${sceneType}". Allowed: ${SCENE_TYPES.join(', ')}`,
    );
  }
  if (!args.topic || args.topic.trim() === '') {
    throw new Error('topic is required (the bare user prompt, e.g. "a gothic cathedral")');
  }

  const aesthetic  = args.aesthetic  || d.aesthetic;
  const mood       = args.mood       || d.mood;
  const floor      = args.floor      || d.floor;
  const clutter    = args.clutter    || d.clutter;
  const perimeter  = args.perimeter  || d.perimeter;
  const lighting   = args.lighting   || d.lighting;
  const atmosphere = args.atmosphere || d.atmosphere;
  const closer     = args.closer     || d.closer;

  // Sentence-by-sentence assembly. Order is load-bearing — Marble's
  // instruction-following degrades if you reorder.
  const sentences = [
    `The scene is ${args.topic.trim()}, rendered in ${aesthetic}, evoking a ${mood} atmosphere.`,
    `The central feature is ${floor}.`,
    `There are ${clutter}.`,
    `${capitaliseFirst(perimeter)}.`,
    `${capitaliseFirst(lighting)}.`,
    `The arena is ${atmosphere}, ${closer}.`,
    `The 360 scene is faultless.`,
  ];

  return sentences.join(' ');
}

function capitaliseFirst(s) {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

/** List the available scene types — used by the CLI for `--scene-type help`. */
export function listSceneTypes() {
  return SCENE_TYPES.map((t) => ({
    type: t,
    aesthetic: DEFAULTS[t].aesthetic,
    mood:      DEFAULTS[t].mood,
  }));
}
