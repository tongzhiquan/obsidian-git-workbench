import { t } from './i18n';
import { requestUrl } from 'obsidian';
import type { Settings } from './types';
import { DEEPSEEK_ENDPOINT, buildAiPrompt, extractAiMessage } from './ai-core';

export async function generateCommitMessage(settings: Pick<Settings, 'aiModel' | 'aiPrompt' | 'aiMaxDiffChars'>, apiKey: string, diff: string): Promise<string> {
  if (!apiKey.trim()) throw new Error(t('ai.missingKey'));
  if (!settings.aiModel.trim()) throw new Error(t('ai.missingModel'));
  const maxChars = Math.max(1000, Math.min(500000, Number(settings.aiMaxDiffChars) || 120000));
  const clipped = diff.length > maxChars ? `${diff.slice(0, maxChars)}\n\n[diff 已截断]` : diff;
  if (!clipped.trim()) throw new Error(t('ai.noChanges'));
  const response = await requestUrl({
    url: DEEPSEEK_ENDPOINT, method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
    body: JSON.stringify({ model: settings.aiModel.trim(), thinking: { type: 'disabled' }, messages: [
      { role: 'system', content: '你是一个严谨的 Git 提交信息生成器。所有结论必须来自给定 diff。' },
      { role: 'user', content: buildAiPrompt(settings.aiPrompt, clipped) },
    ] }),
  });
  if (response.status < 200 || response.status >= 300) throw new Error(t('ai.httpError', { p0: response.status }));
  return extractAiMessage(response.json);
}
