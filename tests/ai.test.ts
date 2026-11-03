import './test-language';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiPrompt, extractAiMessage, normalizeDeepSeekSettings, DEEPSEEK_ENDPOINT, DEFAULT_DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_KEY_ID } from '../src/ai-core';
import { DEFAULT_SETTINGS } from '../src/types';
import { DEFAULT_AI_PROMPT, LEGACY_AI_PROMPT, normalizeAiPrompt } from '../src/ai-prompt';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import type { generateCommitMessage } from '../src/ai';

test('DeepSeek is the only provider and uses its official endpoint and current default model', () => {
  assert.equal(DEEPSEEK_ENDPOINT, 'https://api.deepseek.com/chat/completions');
  assert.equal(DEFAULT_SETTINGS.aiProvider, 'deepseek');
  assert.equal(DEFAULT_SETTINGS.aiModel, DEFAULT_DEEPSEEK_MODEL);
  assert.equal(DEFAULT_DEEPSEEK_MODEL, 'deepseek-flash');
  assert.equal(DEFAULT_SETTINGS.aiApiKeyId, DEFAULT_DEEPSEEK_KEY_ID);
  assert.equal('aiBaseUrl' in DEFAULT_SETTINGS, false);
});

test('DeepSeek migration preserves its credential reference and custom models while upgrading retired aliases', () => {
  const saved = { aiProvider: 'deepseek', aiModel: 'deepseek-v4-pro', aiApiKeyId: 'existing-deepseek-secret' };
  const migrated = normalizeDeepSeekSettings(saved);
  assert.deepEqual(migrated.settings, saved); assert.equal(migrated.needsApiKey, false);
  for (const aiModel of ['deepseek-chat', 'deepseek-reasoner', '', '  ']) {
    const result = normalizeDeepSeekSettings({ ...saved, aiModel });
    assert.equal(result.settings.aiModel, DEFAULT_DEEPSEEK_MODEL);
    assert.equal(result.settings.aiApiKeyId, saved.aiApiKeyId);
  }
  assert.equal(normalizeDeepSeekSettings({ ...saved, aiApiKeyId: '../invalid' }).settings.aiApiKeyId, DEFAULT_DEEPSEEK_KEY_ID);
});

test('OpenAI, custom and invalid provider migrations do not reuse their models or secret references', () => {
  for (const aiProvider of ['openai', 'custom', 'invalid', null]) {
    const saved = { aiProvider, aiModel: 'old-model', aiApiKeyId: 'old-provider-key', aiBaseUrl: 'https://old.example' };
    const result = normalizeDeepSeekSettings(saved);
    assert.equal(result.needsApiKey, true);
    assert.deepEqual(result.settings, { aiProvider: 'deepseek', aiModel: DEFAULT_DEEPSEEK_MODEL, aiApiKeyId: DEFAULT_DEEPSEEK_KEY_ID });
    assert.equal(saved.aiApiKeyId, 'old-provider-key');
  }
  assert.deepEqual(normalizeDeepSeekSettings().settings, {
    aiProvider: 'deepseek', aiModel: DEFAULT_DEEPSEEK_MODEL, aiApiKeyId: DEFAULT_DEEPSEEK_KEY_ID,
  });
  assert.notEqual(normalizeDeepSeekSettings({ aiProvider: 'custom', aiApiKeyId: DEFAULT_DEEPSEEK_KEY_ID }).settings.aiApiKeyId, DEFAULT_DEEPSEEK_KEY_ID);
});

test('commit generation sends only to DeepSeek, clips the diff and requires a key before requesting', async () => {
  const bundle = await build({ entryPoints: ['src/ai.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', plugins: [{
    name: 'mock-obsidian', setup(plugin) {
      plugin.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
      plugin.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const requestUrl = globalThis.requestMock;', loader: 'js' }));
    },
  }] });
  const requests: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const module = { exports: {} as { generateCommitMessage: typeof generateCommitMessage } };
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, requestMock: async (request: typeof requests[number]) => {
    requests.push(request); return { status: 200, json: { choices: [{ message: { content: 'fix: generated' } }] } };
  } });
  const settings = { ...DEFAULT_SETTINGS, aiMaxDiffChars: 1000, aiPrompt: 'custom prompt' };
  await assert.rejects(module.exports.generateCommitMessage(settings, '', 'diff'), /DeepSeek API Key/);
  assert.equal(requests.length, 0);
  assert.equal(await module.exports.generateCommitMessage(settings, ' example-key ', 'x'.repeat(1200)), 'fix: generated');
  assert.equal(requests.length, 1); assert.equal(requests[0].url, DEEPSEEK_ENDPOINT);
  assert.equal(requests[0].headers.Authorization, 'Bearer example-key');
  const body = JSON.parse(requests[0].body);
  assert.equal(body.model, DEFAULT_DEEPSEEK_MODEL); assert.equal(body.thinking.type, 'disabled');
  assert.ok(body.messages[1].content.includes('custom prompt'));
  assert.ok(body.messages[1].content.includes('x'.repeat(1000))); assert.ok(!body.messages[1].content.includes('x'.repeat(1001)));
});

test('AI response extraction removes optional code fences', () => {
  assert.equal(extractAiMessage({ choices: [{ message: { content: '```text\nfix(ui): update button\n```' } }] }), 'fix(ui): update button');
  assert.equal(extractAiMessage({ choices: [{ message: { content: [{ type: 'text', text: 'feat: add AI commits' }] } }] }), 'feat: add AI commits');
  assert.throws(() => extractAiMessage({ choices: [] }), /未返回/);
});

test('AI prompt includes custom instructions and staged diff', () => {
  const prompt = buildAiPrompt(DEFAULT_SETTINGS.aiPrompt, 'diff --git a/note.md b/note.md');
  assert.match(prompt, /Conventional Commits/);
  assert.match(prompt, /diff --git a\/note\.md b\/note\.md/);
});

test('AI prompt upgrades only the old default and keeps custom constraints', () => {
  for (const value of [undefined, null, '', '  ', LEGACY_AI_PROMPT]) assert.equal(normalizeAiPrompt(value), DEFAULT_AI_PROMPT);
  const custom = '项目规范：标题使用中文，正文仅总结当前笔记内容。';
  assert.equal(normalizeAiPrompt(custom), custom);
  assert.equal(normalizeAiPrompt(DEFAULT_AI_PROMPT), DEFAULT_AI_PROMPT);
  assert.ok(buildAiPrompt(custom, 'diff fixture').includes(custom));
});
