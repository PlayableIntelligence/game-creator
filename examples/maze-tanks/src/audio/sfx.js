import { audioManager } from './AudioManager.js';

const _noiseBuffers = new Map();

function noiseBuffer(ctx, durationSec) {
  const key = Math.round(durationSec * 1000);
  let buf = _noiseBuffers.get(key);
  if (buf) return buf;
  const len = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  _noiseBuffers.set(key, buf);
  return buf;
}

function bulletFireSfx(ctx, dest) {
  const now = ctx.currentTime;
  const dur = 0.08;

  // Pitched square sweep down (the "thunk" of the shell leaving the barrel)
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(70, now + 0.06);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, now);
  og.gain.exponentialRampToValueAtTime(0.32, now + 0.005);
  og.gain.exponentialRampToValueAtTime(0.001, now + dur);
  const olpf = ctx.createBiquadFilter();
  olpf.type = 'lowpass';
  olpf.frequency.value = 2400;
  osc.connect(olpf).connect(og).connect(dest);
  osc.start(now);
  osc.stop(now + dur + 0.02);

  // Noise burst — the crackle
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.06);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, now);
  ng.gain.exponentialRampToValueAtTime(0.18, now + 0.005);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 800;
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 4500;
  src.connect(hpf).connect(lpf).connect(ng).connect(dest);
  src.start(now);
  src.stop(now + 0.08);
}

function ricochetSfx(ctx, dest, opts) {
  const now = ctx.currentTime;
  const bounceCount = (opts && opts.bounceCount) || 1;
  const basePitch = bounceCount <= 1 ? 820 : 520;
  const dur = 0.16;

  // Pitched sine ping (the metallic ring)
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(basePitch * 1.6, now);
  osc.frequency.exponentialRampToValueAtTime(basePitch, now + 0.04);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, now);
  og.gain.exponentialRampToValueAtTime(0.18, now + 0.003);
  og.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.connect(og).connect(dest);
  osc.start(now);
  osc.stop(now + dur + 0.02);

  // Noise burst through ringing band-pass for the "tink"
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.05);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = basePitch;
  bp.Q.value = 18;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, now);
  ng.gain.exponentialRampToValueAtTime(0.22, now + 0.002);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  src.connect(bp).connect(ng).connect(dest);
  src.start(now);
  src.stop(now + 0.06);
}

function tankExplodeSfx(ctx, dest) {
  const now = ctx.currentTime;
  const dur = 0.55;

  // Big square sweep — the boom body (300 Hz → 40 Hz)
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.4);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, now);
  og.gain.exponentialRampToValueAtTime(0.42, now + 0.01);
  og.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  const olpf = ctx.createBiquadFilter();
  olpf.type = 'lowpass';
  olpf.frequency.setValueAtTime(1800, now);
  olpf.frequency.exponentialRampToValueAtTime(400, now + 0.45);
  osc.connect(olpf).connect(og).connect(dest);
  osc.start(now);
  osc.stop(now + dur);

  // Filtered low noise — debris rumble
  const lowSrc = ctx.createBufferSource();
  lowSrc.buffer = noiseBuffer(ctx, dur);
  const lowLpf = ctx.createBiquadFilter();
  lowLpf.type = 'lowpass';
  lowLpf.frequency.setValueAtTime(900, now);
  lowLpf.frequency.exponentialRampToValueAtTime(180, now + 0.4);
  const lowG = ctx.createGain();
  lowG.gain.setValueAtTime(0.0001, now);
  lowG.gain.exponentialRampToValueAtTime(0.5, now + 0.01);
  lowG.gain.exponentialRampToValueAtTime(0.001, now + dur);
  lowSrc.connect(lowLpf).connect(lowG).connect(dest);
  lowSrc.start(now);
  lowSrc.stop(now + dur);

  // High-pass sizzle on top — short and fast
  const sizzleSrc = ctx.createBufferSource();
  sizzleSrc.buffer = noiseBuffer(ctx, 0.18);
  const sizzleHpf = ctx.createBiquadFilter();
  sizzleHpf.type = 'highpass';
  sizzleHpf.frequency.value = 2800;
  const sizzleG = ctx.createGain();
  sizzleG.gain.setValueAtTime(0.0001, now);
  sizzleG.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
  sizzleG.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  sizzleSrc.connect(sizzleHpf).connect(sizzleG).connect(dest);
  sizzleSrc.start(now);
  sizzleSrc.stop(now + 0.18);
}

function roundCountdownBeepSfx(ctx, dest, opts) {
  const now = ctx.currentTime;
  const pitchHz = (opts && opts.pitchHz) || 600;
  const dur = 0.09;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = pitchHz;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.28, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.connect(g).connect(dest);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

function roundWinFanfareSfx(ctx, dest) {
  const now = ctx.currentTime;
  // Triumphant ascending arpeggio — C major triad + octave
  const notes = [392.00, 523.25, 659.25, 783.99, 1046.50];
  const noteDur = 0.18;
  const gap = 0.09;
  notes.forEach((freq, i) => {
    const start = now + i * gap;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.22, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, start + noteDur);
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 3500;
    osc.connect(lpf).connect(g).connect(dest);
    osc.start(start);
    osc.stop(start + noteDur + 0.02);

    // Detuned octave below for body
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq / 2;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, start);
    g2.gain.exponentialRampToValueAtTime(0.16, start + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.001, start + noteDur);
    osc2.connect(g2).connect(dest);
    osc2.start(start);
    osc2.stop(start + noteDur + 0.02);
  });
}

function roundDrawSfx(ctx, dest) {
  const now = ctx.currentTime;
  const dur = 0.6;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(200, now + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(1600, now);
  lpf.frequency.exponentialRampToValueAtTime(700, now + dur);
  osc.connect(lpf).connect(g).connect(dest);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

audioManager.registerSfx('bulletFire', bulletFireSfx);
audioManager.registerSfx('ricochet', ricochetSfx);
audioManager.registerSfx('tankExplode', tankExplodeSfx);
audioManager.registerSfx('roundCountdownBeep', roundCountdownBeepSfx);
audioManager.registerSfx('roundWinFanfare', roundWinFanfareSfx);
audioManager.registerSfx('roundDraw', roundDrawSfx);
