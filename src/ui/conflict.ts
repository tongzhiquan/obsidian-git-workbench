import { formatNumber, t } from '../i18n';
import type GitWorkbench from '../main';
import type { Conflict } from '../types';
import { conflictBlocks } from '../git/parsers';
import { button, ConfirmModal, el } from './common';
export function renderConflict(parent: HTMLElement, conflict: Conflict, plugin: GitWorkbench): void {
  const header = el(parent, 'div', 'gp-diff-bar'); el(header, 'strong', 'gp-path', conflict.path); el(header, 'span', 'gp-danger', t('conflict.title'));
  el(parent, 'p', 'gp-conflict-help', t('conflict.explanation'));
  const sides = el(parent, 'div', 'gp-conflict-sides');
  for (const [key, title] of [['ours', t('conflict.ours')], ['theirs', t('conflict.theirs')]] as const) {
    const panel = el(sides, 'section'); el(panel, 'h4', '', title); const file = conflict[key];
    el(panel, 'pre', 'gp-conflict-source', !file.exists ? t('conflict.deleted') : file.binary || file.large ? t('conflict.metadata', { p0: formatNumber(file.size) }) : file.text);
    button(panel, file.exists ? key === 'ours' ? t('conflict.useOursFile') : t('conflict.useTheirsFile') : t('conflict.useDeletion'), () => new ConfirmModal(plugin.app, t('conflict.fileTitle'), t('conflict.fileDescription', { p0: conflict.path }), () => plugin.run(t('conflict.resolve'), () => plugin.git.resolveConflict(conflict.path, key, undefined, conflict.result))).open());
  }
  const base = el(parent, 'details', 'gp-base-version'); el(base, 'summary', '', t('conflict.base')); el(base, 'pre', '', conflict.base.exists ? conflict.base.binary || conflict.base.large ? t('conflict.baseHidden') : conflict.base.text : t('conflict.noBase'));
  if (conflict.fileLevel) {
    el(parent, 'p', 'gp-muted', t('conflict.fileLevelHint'));
    button(parent, t('conflict.deletePath'), () => new ConfirmModal(plugin.app, t('conflict.deleteTitle'), t('conflict.deleteDescription', { p0: conflict.path }), () => plugin.run(t('conflict.resolve'), () => plugin.git.resolveConflict(conflict.path, 'delete'))).open()); return;
  }
  el(parent, 'h4', '', t('conflict.result')); const textarea = el(parent, 'textarea', 'gp-conflict-result'); textarea.value = conflict.result; textarea.spellcheck = false; textarea.setAttribute('aria-label', t('conflict.editableResult'));
  const tools = el(parent, 'div', 'gp-conflict-blocks');
  const draw = () => {
    tools.replaceChildren(); const blocks = conflictBlocks(textarea.value); el(tools, 'span', 'gp-muted', t('conflict.remaining', { p0: blocks.length }));
    blocks.forEach((block, index) => {
      const row = el(tools, 'div', 'gp-actions'); el(row, 'span', '', t('conflict.blockNumber', { p0: index + 1 }));
      for (const [label, text] of [[t('conflict.keepOurs'), block.ours], [t('conflict.keepTheirs'), block.theirs], [t('conflict.keepBoth'), block.ours + block.theirs]] as const) button(row, label, () => { textarea.value = textarea.value.slice(0, block.start) + text + textarea.value.slice(block.end); draw(); });
    });
  };
  textarea.oninput = draw; draw();
  button(parent, t('conflict.saveStage'), () => plugin.run(t('conflict.saveResult'), () => plugin.git.resolveConflict(conflict.path, 'result', textarea.value, conflict.result)), 'mod-cta');
}
