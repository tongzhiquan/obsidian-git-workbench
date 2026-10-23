import { requestUrl } from 'obsidian';
import type { Settings } from './types';
import { aiBaseUrl, buildAiPrompt, extractAiMessage } from './ai-core';

export async function generateCommitMessage(settings: Pick<Settings, 'aiProvider' | 'aiBaseUrl' | 'aiModel' | 'aiPrompt' | 'aiMaxDiffChars'>, apiKey: string, diff: string): Promise<string> {
  if (!apiKey.trim()) throw new Error('请先在设置中填写 AI API Key');
  if (!settings.aiModel.trim()) throw new Error('请在设置中填写 AI 模型名称');
  const maxChars = Math.max(1000, Math.min(500000, Number(settings.aiMaxDiffChars) || 120000));
  const clipped = diff.length > maxChars ? `${diff.slice(0, maxChars)}\n\n[diff 已截断]` : diff;
  if (!clipped.trim()) throw new Error('暂存区没有可用于生成提交信息的变化');
  const response = await requestUrl({
    url: aiBaseUrl(settings), method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
    body: JSON.stringify({ model: settings.aiModel.trim(), temperature: 0.2, messages: [
      { role: 'system', content: '你是一个严谨的 Git 提交信息生成器。所有结论必须来自给定 diff。' },
      { role: 'user', content: buildAiPrompt(settings.aiPrompt, clipped) },
    ] }),
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`AI 请求失败（HTTP ${response.status}）`);
  return extractAiMessage(response.json);
}
