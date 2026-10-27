import test from 'node:test';
import assert from 'node:assert/strict';
import { aiBaseUrl, buildAiPrompt, extractAiMessage, DEFAULT_AI_MODELS } from '../src/ai-core';
import { DEFAULT_SETTINGS } from '../src/types';
import { DEFAULT_AI_PROMPT, LEGACY_AI_PROMPT, normalizeAiPrompt } from '../src/ai-prompt';

test('AI provider URLs use the OpenAI-compatible chat completions endpoint', () => {
  assert.equal(aiBaseUrl({ aiProvider: 'openai', aiBaseUrl: '' }), 'https://api.openai.com/v1/chat/completions');
  assert.equal(aiBaseUrl({ aiProvider: 'deepseek', aiBaseUrl: '' }), 'https://api.deepseek.com/chat/completions');
  assert.equal(aiBaseUrl({ aiProvider: 'custom', aiBaseUrl: 'https://llm.example/v1/' }), 'https://llm.example/v1/chat/completions');
});

test('AI providers have useful default model names', () => {
  assert.equal(DEFAULT_AI_MODELS.openai, 'gpt-5-mini');
  assert.equal(DEFAULT_AI_MODELS.deepseek, 'deepseek-chat');
  assert.equal(DEFAULT_SETTINGS.aiProvider, 'deepseek');
  assert.equal(DEFAULT_SETTINGS.aiBaseUrl, 'https://api.deepseek.com');
  assert.equal(DEFAULT_SETTINGS.aiModel, 'deepseek-chat');
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
