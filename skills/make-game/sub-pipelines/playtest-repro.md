# Playtest / repro

Convert vague gameplay feedback ("feels floaty", "combat is boring", "the jump is off") into observable, testable acceptance criteria.

## When to use

- The user describes a feel, balance, or UX problem in subjective terms
- A bug report has no clear repro steps
- You're considering a change to game feel and need to define "better" before touching code

## Inputs

- The user's description, however vague
- The current relevant code or config (jump curves, damage numbers, animation timings, hitbox sizes, etc.)

## Steps

1. **Reflect back what you heard, narrowly.** "When you say floaty, do you mean the jump arc, the landing, or air control?" Use the `AskUserQuestion` tool with the most likely interpretations as options.
2. **Identify the measurable variables behind the feel.** Examples:
   - "Floaty" → jump apex height, hang time, gravity scale, air friction
   - "Combat is boring" → hits-to-kill, hitstop duration, screen shake, damage variance, telegraph length
   - "Off" → input lag, animation startup frames, hitbox size, coyote time, input buffer window
3. **Read the current values from code or config.** Quote them back to the user.
4. **Propose target values or a target observation.** State as observable: "After change, a max-height jump should peak in ≤0.4s and the player should regain ground control within 0.1s of landing."
5. **Get the user to confirm the target.** That confirmed statement becomes the new acceptance criterion.
6. **Hand off** to [Bug fix](bug-fix.md) or the development phase pipeline with the AC in hand.

## Outputs

- A concrete, observable acceptance criterion the user has confirmed
- (Optional) A new milestone or a milestone update capturing the AC

## Exit criteria

- The vague feedback is now stated as `<observable change>` with a number, frame count, or yes/no observation
- The user has agreed with that statement
