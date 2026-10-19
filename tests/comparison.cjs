// Runs only inside the isolated Obsidian fixture created by obsidian.cjs.
module.exports = async ({ window, js, check, capture }) => {
  const run = fn => js(`(${fn.toString()})()`);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async predicate => { for (let i = 0; i < 100; i++) { if (await run(predicate)) return; await pause(50); } throw new Error('Comparison UI did not settle'); };
  await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    const text = Array.from({ length: 100 }, (_, i) => `第 ${i + 1} 行：比较测试`).join('\r\n');
    await app.vault.create('比较测试.md', text); await p.git.stage(['笔记库/比较测试.md']); await p.git.commit('QA 比较基准');
    const changed = text.replace('第 20 行：比较测试', '第 20 行：已暂存变化').replace('第 80 行：比较测试', '第 80 行：另一处变化');
    const file = app.vault.getAbstractFileByPath('比较测试.md'); await app.vault.modify(file, changed); await p.git.stage(['笔记库/比较测试.md']);
    await app.vault.modify(file, changed + '\r\n仅工作区的内容'); await p.controller.refresh();
    p.settings.diffMode = 'split'; await p.openDiff('笔记库/比较测试.md', { kind: 'commit', ref: 'HEAD' }, { kind: 'index' });
    window.__qaIndexHead = (await p.git.status()).head;
    window.__qaIndexWorktree = (await p.git.file('笔记库/比较测试.md', { kind: 'worktree' })).text;
  });
  await pause(800); await wait(() => !!document.querySelector('.gp-merge-body .cm-merge-b .cm-content'));
  check(await run(() => { const api = require('@codemirror/view').EditorView; return api.findFromDOM(document.querySelector('.cm-merge-a')).state.readOnly && !api.findFromDOM(document.querySelector('.cm-merge-b')).state.readOnly && !document.querySelector('.gp-hunk-tools') && !document.querySelector('.cm-merge-revert') && document.querySelector('.gp-save-index').disabled; }), 'comparison shows editable index and selectable read-only original without hunk stage controls');
  const navigation = await run(async () => {
    const get = () => require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b'));
    document.querySelector('[aria-label="下一处修改"]').click(); await new Promise(r => setTimeout(r, 50)); const first = get().state.selection.main.head;
    document.querySelector('[aria-label="下一处修改"]').click(); await new Promise(r => setTimeout(r, 50)); const second = get().state.selection.main.head;
    document.querySelector('[aria-label="上一处修改"]').click(); await new Promise(r => setTimeout(r, 50));
    return { first, second, back: get().state.selection.main.head, label: document.querySelector('.gp-diff-count').textContent };
  });
  check(navigation.second > navigation.first && navigation.back === navigation.first && navigation.label.includes('1 / 2'), 'previous and next navigate separate changes and show current change count');
  await run(() => document.querySelector('[aria-label="折叠未修改区域"]').click());
  await wait(() => document.querySelectorAll('.cm-collapsedLines').length >= 2);
  check(await run(() => document.querySelector('.cm-collapsedLines').textContent.includes('未修改内容')), 'unchanged context folds into localized expandable sections');
  await capture('git-workbench-comparison-folded.png');
  await run(() => document.querySelector('[aria-label="展开未修改区域"]').click());
  await wait(() => !document.querySelector('.cm-collapsedLines'));
  await run(() => {
    const view = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b'));
    const line = view.state.doc.line(20); view.dispatch({ changes: { from: line.from, to: line.to, insert: '第 20 行：编辑后的待提交内容' } });
  });
  check(await run(() => !document.querySelector('.gp-save-index').disabled && app.plugins.plugins['git-workbench'].indexEdits.size === 1 && !document.querySelector('.gp-discard-diff') && !document.querySelector('.gp-diff-pane').textContent.includes('草稿')), 'index editing uses ordinary save without draft management controls');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; await p.controller.refresh();
    await p.openWorkbench('graph'); await p.openDiff('笔记库/比较测试.md', { kind: 'commit', ref: 'HEAD' }, { kind: 'index' });
  });
  check(await run(() => require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b')).state.doc.line(20).text.includes('编辑后的待提交内容')), 'ordinary unsaved edits remain in the current session while switching views');
  check(await run(async () => { const p = app.plugins.plugins['git-workbench']; await p.persistSettings(); return !JSON.stringify(await p.loadData()).includes('编辑后的待提交内容'); }), 'saving settings does not persist unsaved index text');
  await run(() => {
    window.__qaContinuousEditor = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b'));
    window.__qaContinuousEditor.focus(); document.querySelector('.gp-save-index').click();
  });
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && app.plugins.plugins['git-workbench'].indexEdits.size === 0);
  const saved = await run(async () => {
    const p = app.plugins.plugins['git-workbench']; const index = await p.git.file('笔记库/比较测试.md', { kind: 'index' });
    return { text: index.text, worktree: (await p.git.file('笔记库/比较测试.md', { kind: 'worktree' })).text === window.__qaIndexWorktree, head: (await p.git.status()).head === window.__qaIndexHead };
  });
  check(saved.text.includes('编辑后的待提交内容') && saved.text.includes('\r\n') && !saved.text.endsWith('\n') && saved.worktree && saved.head, 'save writes edited index while preserving CRLF, final newline, worktree and HEAD');
  await run(() => { const view = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b')); const line = view.state.doc.line(21); view.dispatch({ changes: { from: line.from, to: line.to, insert: '第 21 行：连续保存' } }); });
  await run(() => document.querySelector('.gp-save-index').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && !app.plugins.plugins['git-workbench'].indexEdits.size);
  check(await run(async () => require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b')) === window.__qaContinuousEditor && (await app.plugins.plugins['git-workbench'].git.file('笔记库/比较测试.md', { kind: 'index' })).text.includes('连续保存')), 'consecutive saves update the baseline without reopening comparison');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    const legacy = { settings: p.settings, indexDrafts: [['笔记库/比较测试.md', { text: '旧版本未保存片段', base: await p.git.file('笔记库/比较测试.md', { kind: 'index' }) }]] };
    await p.saveData(legacy); await app.plugins.disablePlugin('git-workbench'); await app.plugins.enablePlugin('git-workbench');
    await app.plugins.plugins['git-workbench'].openDiff('笔记库/比较测试.md', { kind: 'commit', ref: 'HEAD' }, { kind: 'index' });
  });
  await wait(() => !!document.querySelector('.cm-merge-b .cm-content'));
  check(await run(async () => { const p = app.plugins.plugins['git-workbench']; return !p.indexEdits.size && require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b')).state.doc.line(21).text.includes('连续保存') && JSON.stringify(await p.loadData()).includes('旧版本未保存片段'); }), 'reload reads the saved index and preserves legacy records without restoring them');
  await run(() => { document.body.removeClass('theme-dark'); document.body.addClass('theme-light'); }); await capture('git-workbench-comparison-light.png');
  await run(() => { document.body.removeClass('theme-light'); document.body.addClass('theme-dark'); }); await capture('git-workbench-comparison-dark.png');
  window.setSize(1100, 850); await capture('git-workbench-comparison-narrow.png'); window.setSize(1600, 1000);
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; p.settings.diffMode = 'unified'; await p.persistSettings();
    await p.openDiff('笔记库/比较测试.md', { kind: 'commit', ref: 'HEAD' }, { kind: 'index' });
  });
  await wait(() => !!document.querySelector('.gp-merge-body .cm-deletedChunk'));
  check(await run(() => !!document.querySelector('.gp-merge-body .cm-deletedChunk') && document.querySelector('.gp-merge-body .cm-content').contentEditable === 'true' && !document.querySelector('.cm-chunkButtons')), 'unified diff is editable without accept or reject chunk buttons');
  await run(async () => {
    const view = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.gp-merge-body .cm-editor'));
    const line = view.state.doc.line(80); view.dispatch({ changes: { from: line.from, to: line.to, insert: '第 80 行：统一模式编辑' } });
    view.focus(); await new Promise(r => setTimeout(r, 100));
  });
  window.focus(); window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['control'] }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['control'] });
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && app.plugins.plugins['git-workbench'].indexEdits.size === 0);
  check(await run(async () => (await app.plugins.plugins['git-workbench'].git.file('笔记库/比较测试.md', { kind: 'index' })).text.includes('统一模式编辑')), 'Ctrl+S saves index edits in unified mode');
  await wait(() => !!document.querySelector('[aria-label="打开文件"]'));
  await run(async () => {
    const view = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.gp-merge-body .cm-editor'));
    view.dispatch({ changes: { from: 0, insert: '临时输入' } }); window.dispatchEvent(new Event('focus')); await new Promise(r => setTimeout(r, 30)); document.querySelector('[aria-label="重新加载文件"]').click();
  });
  await wait(() => !!document.querySelector('.gp-confirm-detail'));
  await run(() => Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === '不保存并重新加载').click());
  await wait(() => !app.plugins.plugins['git-workbench'].indexEdits.size && !!document.querySelector('[aria-label="打开文件"]'));
  check(await run(() => !document.querySelector('.gp-diff-pane').textContent.includes('临时输入')), 'ordinary file reload confirms discarding unsaved edits');
  await run(() => document.querySelector('[aria-label="打开文件"]').click());
  await wait(() => app.workspace.getActiveFile()?.path === '比较测试.md');
  check(true, 'open file action opens the working copy in Obsidian');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; await p.git.unstage(['笔记库/比较测试.md']);
    await p.openDiff('笔记库/项目笔记.md', { kind: 'index' }, { kind: 'worktree' });
  });
  check(await run(() => !require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.gp-merge-body .cm-editor')).state.readOnly && !!document.querySelector('.gp-save-worktree')), 'worktree comparison exposes an editable working file');
  await require('./editing.cjs')({ window, js, check, capture });
  await run(async () => {
    for (const leaf of app.workspace.getLeavesOfType('markdown')) if (leaf.view.file?.path === '比较测试.md') leaf.detach();
    await app.plugins.plugins['git-workbench'].openWorkbench('graph');
  });
};
