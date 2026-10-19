import type GitWorkbench from '../main';
import type { Conflict } from '../types';
import { conflictBlocks } from '../git/parsers';
import { button, ConfirmModal, el } from './common';
export function renderConflict(parent: HTMLElement, conflict: Conflict, plugin: GitWorkbench): void {
  const header = el(parent, 'div', 'gp-diff-bar'); el(header, 'strong', 'gp-path', conflict.path); el(header, 'span', 'gp-danger', '冲突处理');
  el(parent, 'p', 'gp-conflict-help', '“当前侧 / 传入侧”对应 Git index stage 2 / 3；rebase 时当前侧通常是目标分支，传入侧是正在重放的提交。保存结果后会暂存此文件。');
  const sides = el(parent, 'div', 'gp-conflict-sides');
  for (const [key, title] of [['ours', '当前侧（stage 2）'], ['theirs', '传入侧（stage 3）']] as const) {
    const panel = el(sides, 'section'); el(panel, 'h4', '', title); const file = conflict[key];
    el(panel, 'pre', 'gp-conflict-source', !file.exists ? '此侧删除了文件' : file.binary || file.large ? `文件内容不展开 · ${file.size.toLocaleString()} 字节` : file.text);
    button(panel, file.exists ? `采用${title.split('（')[0]}整个文件` : '采用此侧删除', () => new ConfirmModal(plugin.app, '解决此文件冲突？', `${conflict.path}\n将备份当前文件，采用所选版本并暂存。`, () => plugin.run('解决冲突', () => plugin.git.resolveConflict(conflict.path, key, undefined, conflict.result))).open());
  }
  const base = el(parent, 'details', 'gp-base-version'); el(base, 'summary', '', '共同基础版本（stage 1）'); el(base, 'pre', '', conflict.base.exists ? conflict.base.binary || conflict.base.large ? '基础内容不展开' : conflict.base.text : '无共同基础文件');
  if (conflict.fileLevel) {
    el(parent, 'p', 'gp-muted', '此冲突涉及文件删除、二进制或大文件，请采用文件级选择。重命名冲突的各路径会分别列在侧栏。');
    button(parent, '删除此路径并标记已解决', () => new ConfirmModal(plugin.app, '删除冲突文件？', `${conflict.path}\n保存备份后删除此路径，并暂存删除。`, () => plugin.run('解决冲突', () => plugin.git.resolveConflict(conflict.path, 'delete'))).open()); return;
  }
  el(parent, 'h4', '', '合并结果'); const textarea = el(parent, 'textarea', 'gp-conflict-result'); textarea.value = conflict.result; textarea.spellcheck = false; textarea.setAttribute('aria-label', '可编辑的合并结果');
  const tools = el(parent, 'div', 'gp-conflict-blocks');
  const draw = () => {
    tools.replaceChildren(); const blocks = conflictBlocks(textarea.value); el(tools, 'span', 'gp-muted', `剩余 ${blocks.length} 个冲突块`);
    blocks.forEach((block, index) => {
      const row = el(tools, 'div', 'gp-actions'); el(row, 'span', '', `块 ${index + 1}`);
      for (const [label, text] of [['采用当前侧', block.ours], ['采用传入侧', block.theirs], ['保留双方', block.ours + block.theirs]] as const) button(row, label, () => { textarea.value = textarea.value.slice(0, block.start) + text + textarea.value.slice(block.end); draw(); });
    });
  };
  textarea.oninput = draw; draw();
  button(parent, '保存结果并暂存', () => plugin.run('保存合并结果', () => plugin.git.resolveConflict(conflict.path, 'result', textarea.value, conflict.result)), 'mod-cta');
}
