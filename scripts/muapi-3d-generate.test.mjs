import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInput,
  pollPrediction,
  selectModelUrl,
  submitPrediction,
} from './muapi-3d-generate.mjs';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('builds the current text-to-3D request shape without network access', () => {
  assert.deepEqual(
    buildInput({
      mode: 'text-to-3d',
      prompt: 'low-poly treasure chest',
      topology: 'quad',
      polycount: 12000,
      pbr: true,
      preview: false,
      remesh: true,
      symmetry: 'auto',
      expandPrompt: false,
    }),
    {
      topology: 'quad',
      target_polycount: 12000,
      should_remesh: true,
      symmetry_mode: 'auto',
      enable_pbr: true,
      prompt: 'low-poly treasure chest',
      mode: 'full',
      enable_prompt_expansion: false,
    },
  );
});

test('builds image-to-3D input from a public URL', () => {
  const input = buildInput({
    mode: 'image-to-3d',
    image: 'https://example.test/concept.png',
    topology: 'triangle',
    polycount: 30000,
    pbr: false,
    remesh: true,
    texture: true,
    symmetry: 'auto',
  });
  assert.equal(input.image_url, 'https://example.test/concept.png');
  assert.equal(input.should_texture, true);
});

test('submits exactly one POST and returns the request ID', async () => {
  const calls = [];
  const result = await submitPrediction({
    apiBase: 'https://api.example.test',
    apiKey: 'secret',
    endpoint: '/api/v1/meshy-6-text-to-3d',
    input: { prompt: 'tree' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ request_id: 'request-1', status: 'queued' });
    },
  });

  assert.equal(result.request_id, 'request-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.match(calls[0].init.headers['x-api-key'], /secret/);
});

test('polls only GET results with a finite retry budget', async () => {
  let attempts = 0;
  const delays = [];
  const result = await pollPrediction({
    apiBase: 'https://api.example.test',
    apiKey: 'secret',
    id: 'request-1',
    maxPolls: 3,
    pollIntervalMs: 1,
    sleepImpl: async (delay) => delays.push(delay),
    fetchImpl: async (_url, init) => {
      assert.equal(init.method, 'GET');
      attempts += 1;
      if (attempts === 1) return jsonResponse({ status: 'processing' });
      return jsonResponse({ status: 'completed', output: { model_url: 'https://cdn.example.test/model.glb' } });
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(attempts, 2);
  assert.equal(delays.length, 1);
});

test('selects only HTTPS GLB outputs', () => {
  assert.equal(
    selectModelUrl({ output: { model_url: 'https://cdn.example.test/model.glb' } }),
    'https://cdn.example.test/model.glb',
  );
  assert.equal(selectModelUrl({ output: { model_url: 'http://example.test/model.glb' } }), null);
});

test('stops on terminal failure without another poll', async () => {
  let attempts = 0;
  await assert.rejects(
    pollPrediction({
      apiBase: 'https://api.example.test',
      apiKey: 'secret',
      id: 'request-1',
      maxPolls: 3,
      sleepImpl: async () => {},
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse({ status: 'failed', error: 'invalid input' });
      },
    }),
    /invalid input/,
  );
  assert.equal(attempts, 1);
});
