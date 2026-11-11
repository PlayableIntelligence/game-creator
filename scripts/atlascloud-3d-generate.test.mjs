import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInput,
  pollPrediction,
  selectGlbUrl,
  submitPrediction,
} from './atlascloud-3d-generate.mjs';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('builds only the live Hunyuan3D text schema fields', () => {
  assert.deepEqual(
    buildInput({ mode: 'text-to-3d', prompt: 'low-poly tree', pbr: true, geometry: false }),
    {
      model: 'tencent/hunyuan3d-rapid/text-to-3d',
      prompt: 'low-poly tree',
      enable_pbr: true,
      enable_geometry: false,
      format: 'GLB',
    },
  );
});

test('submits a generation POST exactly once', async () => {
  const calls = [];
  const prediction = await submitPrediction({
    apiBase: 'https://example.test',
    apiKey: 'secret',
    input: { model: 'model', prompt: 'tree' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ data: { id: 'pred-1', status: 'created' } });
    },
  });

  assert.equal(prediction.id, 'pred-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
});

test('retries bounded GET polling and returns the completed prediction', async () => {
  let attempts = 0;
  const delays = [];
  const prediction = await pollPrediction({
    apiBase: 'https://example.test',
    apiKey: 'secret',
    id: 'pred-1',
    maxPolls: 3,
    pollIntervalMs: 1,
    sleepImpl: async (delay) => delays.push(delay),
    fetchImpl: async (_url, init) => {
      assert.equal(init.method, undefined);
      attempts += 1;
      if (attempts === 1) return jsonResponse({ error: 'temporary' }, 503);
      return jsonResponse({ id: 'pred-1', status: 'completed', outputs: ['https://cdn/model.glb'] });
    },
  });

  assert.equal(prediction.status, 'completed');
  assert.equal(attempts, 2);
  assert.equal(delays.length, 1);
});

test('does not retry a terminal prediction failure', async () => {
  let attempts = 0;
  await assert.rejects(
    pollPrediction({
      apiBase: 'https://example.test',
      apiKey: 'secret',
      id: 'pred-1',
      maxPolls: 3,
      sleepImpl: async () => {},
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse({ id: 'pred-1', status: 'failed', error: 'upstream failed' });
      },
    }),
    /upstream failed/,
  );
  assert.equal(attempts, 1);
});

test('does not retry a permanent polling authorization error', async () => {
  let attempts = 0;
  await assert.rejects(
    pollPrediction({
      apiBase: 'https://example.test',
      apiKey: 'secret',
      id: 'pred-1',
      maxPolls: 3,
      sleepImpl: async () => {},
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse({ error: 'unauthorized' }, 401);
      },
    }),
    /unauthorized/,
  );
  assert.equal(attempts, 1);
});

test('prefers structured GLB output metadata', () => {
  assert.equal(
    selectGlbUrl({
      files: [
        { type: 'PNG', url: 'https://cdn/preview.png' },
        { type: 'GLB', url: 'https://cdn/model.glb' },
      ],
      outputs: ['https://cdn/fallback.glb'],
    }),
    'https://cdn/model.glb',
  );
});
