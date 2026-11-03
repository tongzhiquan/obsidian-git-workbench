import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { createTranslator, formatDateTime, formatNumber, getLocale, initializeLanguage, messages, normalizeLanguageSetting, resolveLanguage, t } from '../src/i18n';
import { GitError } from '../src/git/runner';
import { statusLabel } from '../src/git/status-label';
import { lineChange } from '../src/git/line-change';
import { DEFAULT_SETTINGS, INDEX, revisionLabel } from '../src/types';
import { normalizeAiPrompt } from '../src/ai-prompt';
import { buildAiPrompt } from '../src/ai-core';
import { formatCommitMessage } from '../src/commit-message';

test('language preference normalizes legacy and invalid values without changing defaults', () => {
  for (const value of [undefined, null, '', {}, 'fr', 'zh', 'auto']) assert.equal(normalizeLanguageSetting(value), 'auto');
  assert.equal(normalizeLanguageSetting('en'), 'en');
  assert.equal(normalizeLanguageSetting('zh-CN'), 'zh-CN');
  assert.equal(DEFAULT_SETTINGS.language, 'auto');
  assert.equal(DEFAULT_SETTINGS.version, 1);
});

test('auto follows Chinese variants and falls back to English; explicit choices override the app', () => {
  for (const app of ['zh', 'zh-CN', 'zh-TW', 'zh-Hans', 'ZH-hk']) assert.equal(resolveLanguage('auto', app), 'zh-CN');
  for (const app of ['en', 'en-GB', 'fr', 'ja', '', 'zhh']) assert.equal(resolveLanguage('auto', app), 'en');
  assert.equal(resolveLanguage('en', 'zh'), 'en');
  assert.equal(resolveLanguage('zh-CN', 'en'), 'zh-CN');
  assert.equal(resolveLanguage('invalid', 'zh'), 'zh-CN');
});

test('all messages have matching keys and interpolation parameters in both languages', () => {
  const parameters = (text: string) => [...new Set([...text.matchAll(/\{(p\d+)\}/g)].map(match => match[1]))].sort();
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages['zh-CN']).sort());
  for (const key of Object.keys(messages['zh-CN']) as Array<keyof typeof messages.en>) {
    assert.ok(messages.en[key].trim(), key);
    assert.deepEqual(parameters(messages.en[key]), parameters(messages['zh-CN'][key]), key);
    assert.doesNotMatch(messages.en[key], /\p{Script=Han}/u, key);
  }
});

test('translation interpolates values once and preserves templates, paths, and data', () => {
  const en = createTranslator('en'), zh = createTranslator('zh-CN');
  assert.equal(en('line.leftRange', { p0: 2, p1: 4 }), 'Left: lines 2–4');
  assert.equal(zh('line.leftRange', { p0: 2, p1: 4 }), '左侧第 2 至 4 行');
  assert.equal(en('blame.context', { p0: '笔记/{p1}.md', p1: 7 }), '笔记/{p1}.md · Line 7');
  assert.match(en('settings.commitTemplateHint'), /\{\{date\}\}/);
  // These calls must be rejected by TypeScript even though this function is never run.
  const typeChecks = () => {
    // @ts-expect-error Translation keys must exist.
    en('missing.key');
    // @ts-expect-error Required interpolation values must be supplied.
    en('line.leftRange');
    // @ts-expect-error Unexpected interpolation values are rejected.
    en('line.leftRange', { p0: 2, p1: 4, p2: 6 });
    // @ts-expect-error Messages without parameters do not accept parameters.
    en('source.title', { p0: 'unused' });
  };
  void typeChecks;
});

test('an initialized session stays in its language when the saved preference changes', () => {
  try {
    const saved = { language: 'en' as 'en' | 'zh-CN' };
    initializeLanguage(saved.language, 'zh');
    saved.language = 'zh-CN';
    assert.equal(getLocale(), 'en');
    assert.equal(t('source.title'), 'Source Control');
    initializeLanguage(saved.language, 'en');
    assert.equal(t('source.title'), '源代码管理');
  } finally { initializeLanguage('zh-CN', 'en'); }
});

test('errors, status labels and revisions localize while raw Git output remains intact', () => {
  try {
    initializeLanguage('en', 'zh');
    assert.equal(revisionLabel(INDEX), 'Index');
    assert.equal(statusLabel('U', 'conflict').label, 'Conflicted (unmerged)');
    assert.equal(lineChange('one\n', 'two\n', 0, 'raw label').notice, 'Unable to locate this line in history');
    const raw = 'fatal: index.lock exists\n原始错误';
    const error = new GitError(['add', '--', '中文.md'], 128, raw);
    assert.ok(error.message.startsWith(raw));
    assert.match(error.message, /Wait for other Git operations/);
    assert.equal(error.stderr, raw);
    assert.deepEqual(error.args, ['add', '--', '中文.md']);
    const when = new Date('2026-11-02T09:00:00+08:00');
    assert.equal(formatDateTime(when.getTime()), when.toLocaleString('en'));
    assert.equal(formatNumber(12345), '12,345');
  } finally { initializeLanguage('zh-CN', 'en'); }
});

test('language initialization does not rewrite AI prompts or commit templates', () => {
  const custom = '用中文总结 diff；保留 {{date}} 和 English identifiers。';
  const before = buildAiPrompt(normalizeAiPrompt(custom), 'diff --git 中文.md');
  const template = DEFAULT_SETTINGS.commitTemplate;
  const fixed = new Date('2026-11-02T09:00:00+08:00');
  const backup = formatCommitMessage(template, fixed);
  try {
    initializeLanguage('en', 'zh');
    assert.equal(buildAiPrompt(normalizeAiPrompt(custom), 'diff --git 中文.md'), before);
    assert.equal(formatCommitMessage(template, fixed), backup);
    assert.equal(DEFAULT_SETTINGS.commitTemplate, template);
  } finally { initializeLanguage('zh-CN', 'en'); }
});

test('runtime Chinese literals are limited to language names, AI payloads, and persisted backup reasons', async () => {
  const list = async (dir: string): Promise<string[]> => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry => entry.isDirectory() ? list(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
  const allowed: Record<string, Set<string>> = {
    'main.ts': new Set(['语言 / Language', '简体中文']),
    'ai.ts': new Set(['你是一个严谨的 Git 提交信息生成器。所有结论必须来自给定 diff。']),
  };
  for (const file of (await list('src')).filter(file => file.endsWith('.ts') && !file.includes('i18n') && !file.endsWith('ai-prompt.ts'))) {
    const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && /\p{Script=Han}/u.test(node.text)) {
        const backupReason = file.endsWith('service.ts') && ts.isCallExpression(node.parent) && node.parent.expression.getText(source).endsWith('.saveSafetyCopy');
        assert.ok(backupReason || allowed[file.split(/[\\/]/).at(-1)!]?.has(node.text), `${file}: ${node.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});
