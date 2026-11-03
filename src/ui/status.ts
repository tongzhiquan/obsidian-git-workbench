import { statusLabel } from '../git/status-label';
import { el } from './common';
import { setTooltip } from 'obsidian';
import { t } from '../i18n';
export function statusBadge(parent: HTMLElement, value: string, context?: 'conflict' | 'untracked'): HTMLElement {
  const status = statusLabel(value, context), badge = el(parent, 'span', `gp-file-status gp-status-${status.kind}`, status.letter);
  setTooltip(badge, t('diagnostics.config', { p0: status.letter, p1: status.label })); badge.dataset.gitStatus = status.kind; return badge;
}
