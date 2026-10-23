import type { Settings } from './types';

export const DEFAULT_AI_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
} as const;
export const DEFAULT_AI_MODELS = { openai: 'gpt-5-mini', deepseek: 'deepseek-chat' } as const;

export function aiBaseUrl(settings: Pick<Settings, 'aiProvider' | 'aiBaseUrl'>): string {
  const value = settings.aiProvider === 'openai' ? DEFAULT_AI_BASE_URLS.openai
    : settings.aiProvider === 'deepseek' ? DEFAULT_AI_BASE_URLS.deepseek : settings.aiBaseUrl;
  if (!value.trim()) throw new Error('请在设置中填写 AI API 地址');
  return value.trim().replace(/\/+$/, '') + '/chat/completions';
}

export function buildAiPrompt(instructions: string, diff: string): string {
  return `${instructions.trim()}\n\n以下是本次暂存区的 Git diff：\n\n${diff}`;
}

export function extractAiMessage(body: unknown): string {
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map(part => typeof part === 'string' ? part : (part as { text?: string })?.text ?? '').join('') : content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('AI 未返回提交信息');
  return text.replace(/^```(?:text|gitcommit)?\s*/i, '').replace(/\s*```$/, '').trim();
}
