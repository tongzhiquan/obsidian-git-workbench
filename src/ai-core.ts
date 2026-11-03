import { t } from './i18n';
import type { Settings } from './types';

export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
export const DEFAULT_DEEPSEEK_KEY_ID = 'git-workbench-deepseek-api-key';

export function normalizeDeepSeekSettings(saved: Record<string, unknown> = {}): {
  settings: Pick<Settings, 'aiProvider' | 'aiModel' | 'aiApiKeyId'>;
  needsApiKey: boolean;
} {
  const needsApiKey = saved.aiProvider !== undefined && saved.aiProvider !== 'deepseek';
  const model = !needsApiKey && typeof saved.aiModel === 'string' ? saved.aiModel.trim() : '';
  return {
    settings: {
      aiProvider: 'deepseek',
      aiModel: !model || model === 'deepseek-chat' || model === 'deepseek-reasoner' ? DEFAULT_DEEPSEEK_MODEL : model,
      aiApiKeyId: !needsApiKey && typeof saved.aiApiKeyId === 'string' && /^[a-z0-9-]+$/.test(saved.aiApiKeyId)
        ? saved.aiApiKeyId : needsApiKey && saved.aiApiKeyId === DEFAULT_DEEPSEEK_KEY_ID ? DEFAULT_DEEPSEEK_KEY_ID + '-migrated' : DEFAULT_DEEPSEEK_KEY_ID,
    },
    needsApiKey,
  };
}

export function buildAiPrompt(instructions: string, diff: string): string {
  return `${instructions.trim()}\n\n以下是本次暂存区的 Git diff：\n\n${diff}`;
}

export function extractAiMessage(body: unknown): string {
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map(part => typeof part === 'string' ? part : (part as { text?: string })?.text ?? '').join('') : content;
  if (typeof text !== 'string' || !text.trim()) throw new Error(t('ai.noMessage'));
  return text.replace(/^```(?:text|gitcommit)?\s*/i, '').replace(/\s*```$/, '').trim();
}
