import { FuzzySuggestModal, Notice, type FuzzyMatch } from 'obsidian';
import type GitWorkbench from '../main';
import { el, message } from './common';

export class HistoryFilePicker extends FuzzySuggestModal<string> {
  constructor(private plugin: GitWorkbench, private paths: string[], private choose: (path: string) => Promise<void>) {
    super(plugin.app);
    this.modalEl.addClass('gp-history-picker');
    this.setPlaceholder('搜索文件名或路径，选择后查看历史');
    this.emptyStateText = '没有匹配的文件';
    this.setInstructions([{ command: '↑ ↓', purpose: '选择文件' }, { command: 'Enter', purpose: '查看历史' }, { command: 'Esc', purpose: '取消' }]);
  }
  getItems(): string[] { return this.paths; }
  getItemText(path: string): string { return path; }
  renderSuggestion(match: FuzzyMatch<string>, parent: HTMLElement): void {
    const path = match.item;
    const heading = el(parent, 'div', 'gp-picker-heading');
    el(heading, 'strong', '', path.split('/').at(-1)!);
    if (this.plugin.git.vaultPath(path) === undefined) el(heading, 'span', 'gp-outside', '库外');
    el(parent, 'div', 'gp-picker-path', path);
  }
  onChooseItem(path: string): void { void this.choose(path).catch(error => new Notice(message(error), 8000)); }
}
