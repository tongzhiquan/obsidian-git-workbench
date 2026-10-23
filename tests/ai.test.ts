import test from 'node:test';
import assert from 'node:assert/strict';
import { aiBaseUrl, buildAiPrompt, extractAiMessage, DEFAULT_AI_MODELS } from '../src/ai-core';
import { DEFAULT_SETTINGS } from '../src/types';

test('AI provider URLs use the OpenAI-compatible chat completions endpoint', () => {
  assert.equal(aiBaseUrl({ aiProvider: 'openai', aiBaseUrl: '' }), 'https://api.openai.com/v1/chat/completions');
  assert.equal(aiBaseUrl({ aiProvider: 'deepseek', aiBaseUrl: '' }), 'https://api.deepseek.com/chat/completions');
  assert.equal(aiBaseUrl({ aiProvider: 'custom', aiBaseUrl: 'https://llm.example/v1/' }), 'https://llm.example/v1/chat/completions');
});

test('AI providers have useful default model names', () => {
  assert.equal(DEFAULT_AI_MODELS.openai, 'gpt-5-mini');
  assert.equal(DEFAULT_AI_MODELS.deepseek, 'deepseek-chat');
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
