import { audioManager } from './AudioManager.js';

const NOTES = {
  E2: 82.41, G2: 98.00, A2: 110.00, B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25,
  R: 0,
};

function parsePattern(str) {
  return str.split(/\s+/).filter(Boolean).map(t => {
    if (t === 'R' || t === '~') return 0;
    return NOTES[t] || 0;
  });
}

function sequencer(ctx, dest, layers, bpm, stepsPerBeat) {
  const stepDuration = 60 / bpm / stepsPerBeat;
  const lookAheadSec = 0.12;
  const tickMs = 25;
  let nextStepTime = ctx.currentTime + 0.05;
  let stepIndex = 0;
  let stopped = false;
  let timerId = null;

  function scheduleStep() {
    if (stopped) return;
    while (nextStepTime < ctx.currentTime + lookAheadSec) {
      for (const layer of layers) {
        const pat = layer.pattern;
        const note = pat[stepIndex % pat.length];
        if (note > 0) {
          layer.play(ctx, dest, note, nextStepTime, stepDuration, stepIndex);
        }
      }
      stepIndex++;
      nextStepTime += stepDuration;
    }
    timerId = setTimeout(scheduleStep, tickMs);
  }

  scheduleStep();
  return {
    stop() {
      stopped = true;
      if (timerId) clearTimeout(timerId);
    },
  };
}

function bassPlay(ctx, dest, freq, when, stepDur) {
  const dur = stepDur * 0.85;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq;
  const detune = ctx.createOscillator();
  detune.type = 'sawtooth';
  detune.frequency.value = freq * 1.005;
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(900, when);
  lpf.frequency.exponentialRampToValueAtTime(400, when + dur);
  lpf.Q.value = 4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.18, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  osc.connect(lpf);
  detune.connect(lpf);
  lpf.connect(g).connect(dest);
  osc.start(when);
  detune.start(when);
  osc.stop(when + dur + 0.02);
  detune.stop(when + dur + 0.02);
}

let _hatBuffer = null;
function hatPlay(ctx, dest, _freq, when) {
  if (!_hatBuffer) {
    const len = Math.floor(ctx.sampleRate * 0.05);
    _hatBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = _hatBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = _hatBuffer;
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 6000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.06, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
  src.connect(hpf).connect(g).connect(dest);
  src.start(when);
  src.stop(when + 0.05);
}

function leadPlay(ctx, dest, freq, when, stepDur) {
  const dur = stepDur * 1.6;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = freq;
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 2200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.07, when + 0.02);
  g.gain.linearRampToValueAtTime(0.04, when + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  osc.connect(lpf).connect(g).connect(dest);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

function kickPlay(ctx, dest, _freq, when) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(110, when);
  osc.frequency.exponentialRampToValueAtTime(40, when + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.32, when + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.16);
  osc.connect(g).connect(dest);
  osc.start(when);
  osc.stop(when + 0.18);
}

function gameplayBgm(ctx, dest) {
  // 16-step bars at 120 BPM, 8th-note steps (= 4 sec/bar, 32 sec/loop)
  // Layers run at different lengths so the loop doesn't immediately repeat.
  const layers = [
    {
      pattern: parsePattern('E2 E2 R E2  E2 R G2 R   E2 E2 R E2  A2 R G2 R'),
      play: bassPlay,
    },
    {
      pattern: parsePattern('R C3 R C3  R C3 R C3   R C3 R C3  R C3 R C3'),
      play: hatPlay,
    },
    {
      pattern: parsePattern('R R E4 R   R R G4 R    R R E4 R   R R B3 R'),
      play: leadPlay,
    },
    {
      pattern: parsePattern('E2 R R R   E2 R R R    E2 R R R   E2 R R R'),
      play: kickPlay,
    },
  ];
  return sequencer(ctx, dest, layers, 120, 2);
}

audioManager.registerBgm('gameplay', gameplayBgm);
