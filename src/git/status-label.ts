import { t } from '../i18n';
export function statusLabel(status: string, context?: 'conflict' | 'untracked'): { letter: string; kind: string; label: string } {
  if (context === 'conflict') return { letter: 'U', kind: 'conflict', label: t('status.conflict') };
  if (context === 'untracked' || status === '?') return { letter: 'U', kind: 'untracked', label: t('status.untracked') };
  const labels: Record<string, [string, string]> = {
    A: ['added', t('common.added')], M: ['modified', t('common.modified')], D: ['deleted', t('common.delete')], R: ['renamed', t('common.renamed')],
    C: ['copied', t('common.copy')], T: ['modified', t('status.typeChanged')], U: ['conflict', t('status.conflict')],
  };
  const letter = status[0] ?? '?', entry = labels[letter];
  return { letter, kind: entry?.[0] ?? 'unknown', label: entry?.[1] ?? t('status.other') };
}
