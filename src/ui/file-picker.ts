import { t } from '../i18n';
import { FuzzySuggestModal, Notice, type FuzzyMatch } from 'obsidian';
import type GitWorkbench from '../main';
import { el, message } from './common';

export class HistoryFilePicker extends FuzzySuggestModal<string> {
  constructor(private plugin: GitWorkbench, private paths: string[], private choose: (path: string) => Promise<void>) {
    super(plugin.app);
    this.modalEl.addClass('gp-history-picker');
    this.setPlaceholder(t('history.searchPlaceholder'));
    this.emptyStateText = t('history.noMatches');
    this.setInstructions([{ command: '↑ ↓', purpose: t('history.selectFile') }, { command: 'Enter', purpose: t('history.view') }, { command: 'Esc', purpose: t('common.cancel') }]);
  }
  getItems(): string[] { return this.paths; }
  getItemText(path: string): string { return path; }
  renderSuggestion(match: FuzzyMatch<string>, parent: HTMLElement): void {
    const path = match.item;
    const heading = el(parent, 'div', 'gp-picker-heading');
    el(heading, 'strong', '', path.split('/').at(-1)!);
    if (this.plugin.git.vaultPath(path) === undefined) el(heading, 'span', 'gp-outside', t('common.outside'));
    el(parent, 'div', 'gp-picker-path', path);
  }
  onChooseItem(path: string): void { void this.choose(path).catch(error => new Notice(message(error), 8000)); }
}
