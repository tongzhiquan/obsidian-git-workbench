// Text editing, history selection and Git status colors in the isolated QA vault.
module.exports = async ({ window, js, check, capture }) => {
  const run = (fn, ...args) => js(`(${fn.toString()})(...${JSON.stringify(args)})`);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async fn => { for (let i = 0; i < 160; i++) { if (await run(fn)) return; await delay(40); } throw new Error('Editing UI did not settle'); };
  const key = async value => { window.webContents.sendInputEvent({ type: 'keyDown', keyCode: value, modifiers: ['control'] }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: value, modifiers: ['control'] }); await delay(120); };
  await run(async () => {
    const p = app.plugins.plugins['git-workbench'], path = '笔记库/比较测试.md', file = app.vault.getAbstractFileByPath('比较测试.md');
    await p.git.stage([path]); window.__qaWorkingIndex = (await p.git.file(path, { kind: 'index' })).indexEntry; window.__qaWorkingHead = (await p.git.status()).head;
    await app.vault.modify(file, '工作文件原文\r\n第二行\r\n'); const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(file); window.__qaWorkingLeaf = leaf;
    p.settings.diffMode = 'split'; await p.controller.refresh(); await p.openDiff(path, { kind: 'index' }, { kind: 'worktree' });
  });
  await wait(() => !!document.querySelector('.cm-merge-b'));
  await run(() => {
    const view = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b'));
    view.dispatch({ changes: { from: 0, to: view.state.doc.line(1).to, insert: '从比较器保存到工作文件' } });
  });
  await wait(() => !document.querySelector('.gp-save-worktree').disabled);
  check(await run(async () => { const p = app.plugins.plugins['git-workbench']; await p.persistSettings(); return p.worktreeEdits.size === 1 && p.indexEdits.size === 0 && !JSON.stringify(await p.loadData()).includes('从比较器保存到工作文件'); }), 'working edits stay separate from staging and are not stored as persistent drafts');
  await run(() => document.querySelector('.gp-save-worktree').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && !app.plugins.plugins['git-workbench'].worktreeEdits.size);
  const saved = await run(async () => {
    const p = app.plugins.plugins['git-workbench']; const text = (await p.git.file('笔记库/比较测试.md', { kind: 'worktree' })).text;
    return { text, index: (await p.git.file('笔记库/比较测试.md', { kind: 'index' })).indexEntry === window.__qaWorkingIndex, head: (await p.git.status()).head === window.__qaWorkingHead };
  });
  check(saved.text === '从比较器保存到工作文件\r\n第二行\r\n' && saved.index && saved.head, 'worktree editor saves exact text without staging or changing HEAD');
  await wait(() => window.__qaWorkingLeaf.view.editor.getValue().startsWith('从比较器保存到工作文件'));
  check(true, 'saving from comparison updates the already open Obsidian note');
  await run(async () => {
    await app.plugins.disablePlugin('git-workbench'); await app.plugins.enablePlugin('git-workbench');
    await app.plugins.plugins['git-workbench'].openDiff('笔记库/比较测试.md', { kind: 'index' }, { kind: 'worktree' });
  });
  await wait(() => !!document.querySelector('.cm-merge-b'));
  check(await run(() => !app.plugins.plugins['git-workbench'].worktreeEdits.size && require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b')).state.doc.line(1).text === '从比较器保存到工作文件'), 'reload displays saved working file content without a draft restore workflow');
  const protectedNote = await run(async () => {
    const p = app.plugins.plugins['git-workbench'], base = await p.git.file('笔记库/比较测试.md', { kind: 'worktree' });
    const editor = window.__qaWorkingLeaf.view.editor; editor.replaceRange('原笔记中的新编辑', { line: 0, ch: 0 });
    let refused = false; try { await p.saveWorkingFile('笔记库/比较测试.md', '错误覆盖', base); } catch (error) { refused = /未覆盖|已变化/.test(error.message); }
    const kept = editor.getValue().startsWith('原笔记中的新编辑'); await window.__qaWorkingLeaf.view.save(); window.__qaWorkingLeaf.detach(); return refused && kept;
  });
  check(protectedNote, 'comparison refuses to overwrite newer edits in another note editor');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; await app.vault.create('新建编辑.md', '未跟踪原文\n');
    await p.openDiff('笔记库/新建编辑.md', { kind: 'empty' }, { kind: 'worktree' });
    const view = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b')); view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '未跟踪文件可以编辑\n' } });
    window.__qaOriginalClipboardWrite = navigator.clipboard.writeText;
  });
  await wait(() => !document.querySelector('.gp-save-worktree').disabled); await run(() => document.querySelector('.gp-save-worktree').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && !app.plugins.plugins['git-workbench'].worktreeEdits.size);
  check(await run(async () => { const p = app.plugins.plugins['git-workbench']; return (await p.git.file('笔记库/新建编辑.md', { kind: 'worktree' })).text === '未跟踪文件可以编辑\n' && !(await p.git.file('笔记库/新建编辑.md', { kind: 'index' })).exists; }), 'untracked files can be edited while remaining untracked');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; await p.git.unstage(['笔记库/比较测试.md']);
    await app.vault.delete(app.vault.getAbstractFileByPath('比较测试.md')); await p.openDiff('笔记库/比较测试.md', { kind: 'index' }, { kind: 'worktree' });
    const view = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b')); view.dispatch({ changes: { from: 0, insert: '从删除状态重新创建\n' } });
  });
  await wait(() => !document.querySelector('.gp-save-worktree').disabled); await run(() => document.querySelector('.gp-save-worktree').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && !app.plugins.plugins['git-workbench'].worktreeEdits.size);
  check(await run(async () => (await app.plugins.plugins['git-workbench'].git.file('笔记库/比较测试.md', { kind: 'worktree' })).text === '从删除状态重新创建\n'), 'deleted working files can be recreated by editing and saving');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; await app.vault.adapter.write('.obsidian/qa-edit.json', '{"enabled":false}\n');
    await p.openDiff('笔记库/.obsidian/qa-edit.json', { kind: 'empty' }, { kind: 'worktree' });
    const view = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b')); view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '{"enabled":true}\n' } });
  });
  await wait(() => !document.querySelector('.gp-save-worktree').disabled); await run(() => document.querySelector('.gp-save-worktree').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && !app.plugins.plugins['git-workbench'].worktreeEdits.size);
  check(await run(async () => !app.vault.getAbstractFileByPath('.obsidian/qa-edit.json') && (await app.plugins.plugins['git-workbench'].git.file('笔记库/.obsidian/qa-edit.json', { kind: 'worktree' })).text === '{"enabled":true}\n'), 'hidden configuration files outside the Vault file index can be edited safely');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; await p.openDiff('笔记库/项目笔记.md', { kind: 'commit', ref: 'HEAD^' }, { kind: 'commit', ref: 'HEAD' });
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { window.__qaHistoryCopied = text; } });
  });
  await wait(() => !!document.querySelector('.cm-merge-a'));
  for (const side of ['a', 'b']) {
    const position = await run(side => {
      const api = require('@codemirror/view'), view = api.EditorView.findFromDOM(document.querySelector('.cm-merge-' + side));
      view.focus(); view.dispatch({ selection: { anchor: 0 }, effects: api.EditorView.scrollIntoView(0, { y: 'start' }) });
      const from = view.coordsAtPos(0), to = view.coordsAtPos(5); return { x: from.left + 1, y: (from.top + from.bottom) / 2, end: to.left };
    }, side);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(position.x), y: Math.round(position.y) });
    window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(position.x), y: Math.round(position.y), button: 'left', clickCount: 1 });
    await delay(50);
    for (let step = 1; step <= 5; step++) { window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(position.x + (position.end - position.x) * step / 5), y: Math.round(position.y), button: 'left', modifiers: ['leftButtonDown'] }); await delay(20); }
    window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(position.end), y: Math.round(position.y), button: 'left', clickCount: 1 }); await delay(80);
    check(await run(side => !require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-' + side)).state.selection.main.empty, side), `historical ${side === 'a' ? 'left' : 'right'} pane supports native mouse text selection`);
    const selected = await run(side => {
      const view = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-' + side));
      view.focus(); view.dispatch({ selection: { anchor: 0, head: 10 } }); window.__qaHistoryCopied = null;
      return { readonly: view.state.readOnly, selectable: getComputedStyle(view.contentDOM).userSelect === 'text', text: view.state.sliceDoc(0, 10), full: view.state.sliceDoc() };
    }, side);
    await key('C'); await wait(() => !!window.__qaHistoryCopied);
    check(selected.readonly && selected.selectable && await run(() => window.__qaHistoryCopied) === selected.text, `historical ${side === 'a' ? 'left' : 'right'} pane copies selected text`);
    await key('A'); await key('C');
    check(await run(() => window.__qaHistoryCopied) === selected.full, `historical ${side === 'a' ? 'left' : 'right'} pane supports select-all and copy`);
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'x' }); await delay(100);
    check(await run(side => require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-' + side)).state.sliceDoc(), side) === selected.full, 'history remains read-only after typing over the selection');
  }
  await capture('git-workbench-history-selection.png');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; p.settings.diffMode = 'unified'; await p.persistSettings();
    await p.openDiff('笔记库/项目笔记.md', { kind: 'commit', ref: 'HEAD^' }, { kind: 'commit', ref: 'HEAD' });
    const view = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.gp-merge-body .cm-editor')); view.focus(); view.dispatch({ selection: { anchor: 0, head: view.state.doc.line(1).to } }); window.__qaHistoryCopied = null;
  });
  await key('C'); await wait(() => !!window.__qaHistoryCopied);
  check(await run(() => window.__qaHistoryCopied === '# Git Workbench' && !document.querySelector('.gp-save-diff')), 'unified history is copyable and has no save action');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench'], history = await p.git.history('笔记库/项目笔记.md', 2);
    await p.openDiff('笔记库/项目笔记.md', { kind: 'commit', ref: history[0].hash }, { kind: 'commit', ref: history[1].hash });
  });
  await wait(() => !!document.querySelector('.cm-deletedChunk'));
  const oldText = await run(async () => {
    const api = require('@codemirror/view'), view = api.EditorView.findFromDOM(document.querySelector('.gp-merge-body .cm-editor'));
    view.focus(); view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    // Let CodeMirror finish synchronizing its DOM selection before selecting a deleted widget.
    await new Promise(resolve => view.requestMeasure({ read: () => null, write: resolve }));
    const old = document.querySelector('.cm-deletedChunk'), range = document.createRange(); range.selectNodeContents(old);
    const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range); window.__qaHistoryCopied = null; return selection.toString();
  });
  console.log('Deleted history copy', await run(() => ({ active: document.activeElement?.className, selected: document.getSelection()?.toString() })), { expected: oldText });
  await key('C'); await wait(() => !!window.__qaHistoryCopied);
  check(await run(() => window.__qaHistoryCopied) === oldText, 'copying deleted historical text uses the selected old content instead of the newer document');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; navigator.clipboard.writeText = window.__qaOriginalClipboardWrite;
    await app.vault.create('颜色删除.md', 'delete\n'); await app.vault.create('颜色重命名.md', 'rename\n');
    await p.git.stage(['笔记库/颜色删除.md', '笔记库/颜色重命名.md']); await p.git.commit('QA 状态配色基准');
    await app.vault.delete(app.vault.getAbstractFileByPath('颜色删除.md'));
    await app.vault.rename(app.vault.getAbstractFileByPath('颜色重命名.md'), '颜色已重命名.md'); await p.git.stage(['笔记库/颜色重命名.md', '笔记库/颜色已重命名.md']);
    await app.vault.create('颜色新增.md', 'add\n'); await p.git.stage(['笔记库/颜色新增.md']);
    await p.controller.refresh(); await p.openWorkbench('graph'); await p.openSourceControl(false);
  });
  for (const theme of ['light', 'dark']) {
    await run(theme => { document.body.toggleClass('theme-light', theme === 'light'); document.body.toggleClass('theme-dark', theme === 'dark'); }, theme);
    const colors = await run(async () => {
      const found = {}, list = document.querySelector('.gp-sc-list .gp-virtual');
      for (let offset = 0; offset <= list.scrollHeight; offset += 140) {
        list.scrollTop = offset; list.dispatchEvent(new Event('scroll')); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        for (const badge of document.querySelectorAll('.gp-sc-file .gp-file-status')) found[badge.dataset.gitStatus] = { color: getComputedStyle(badge).color, letter: badge.textContent, label: badge.getAttribute('aria-label') };
      }
      list.scrollTop = 0; return found;
    });
    check(['added', 'modified', 'deleted', 'renamed', 'untracked'].every(kind => colors[kind]) && colors.added.color !== colors.modified.color && colors.modified.color !== colors.deleted.color && colors.untracked.letter === 'U' && colors.untracked.label.includes('未跟踪'), `${theme} theme renders semantic colors and labels for real Git status letters`);
    await capture(`git-workbench-status-${theme}.png`);
  }
  await run(async () => { const p = app.plugins.plugins['git-workbench']; await p.git.unstage(['笔记库/颜色新增.md', '笔记库/颜色重命名.md', '笔记库/颜色已重命名.md']); await p.controller.refresh(); });
};
