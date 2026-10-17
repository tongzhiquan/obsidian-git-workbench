module.exports = async ({ js, check, capture }) => {
  const run = fn => js(`(${fn.toString()})()`);
  const typing = await run(async () => {
    const view = app.workspace.activeLeaf.view, editor = view.editor;
    window.__qaBeforeTyping = editor.getValue();
    const counts = [];
    for (let i = 0; i < 7; i++) {
      editor.replaceRange('字', { line: 0, ch: 1 });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      counts.push(view.contentEl.querySelectorAll('.gp-gutter-change').length);
      await new Promise(r => setTimeout(r, 60));
    }
    return counts;
  }); check(typing.every(n => n > 0), 'gutter modification markers remain visible throughout continuous typing without the 500ms idle wait');
  const movement = await run(async () => {
    const view = app.workspace.activeLeaf.view, editor = view.editor;
    editor.replaceRange('新增首行\n', { line: 0, ch: 0 });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const added = view.contentEl.querySelectorAll('.gp-gutter-add').length;
    const changed = view.contentEl.querySelectorAll('.gp-gutter-change').length;
    editor.setValue(window.__qaBeforeTyping);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { added, changed, restored: view.contentEl.querySelectorAll('.gp-gutter-change').length };
  }); check(movement.added > 0 && movement.changed > 0 && movement.restored === 0, 'inserting lines moves markers immediately and restoring text clears only reverted changes');
  const failedBlame = await run(async () => {
    const p = app.plugins.plugins['git-plus'], original = p.controller.blame, editor = app.workspace.activeLeaf.view.editor;
    p.controller.blame = async () => { throw new Error('QA unavailable blame'); };
    try {
      editor.replaceRange('待保存', { line: 0, ch: 1 }); await new Promise(r => setTimeout(r, 650));
      return app.workspace.activeLeaf.view.contentEl.querySelectorAll('.gp-gutter-change').length > 0;
    } finally { p.controller.blame = original; editor.setValue(window.__qaBeforeTyping); }
  }); check(failedBlame, 'blame failures do not clear cached-index gutter markers');
  const undo = await run(async () => {
    const view = app.workspace.activeLeaf.view, editor = view.editor;
    await new Promise(r => setTimeout(r, 650));
    editor.setCursor({ line: 0, ch: 0 }); editor.replaceRange('撤销测试', { line: 0, ch: 1 });
    await new Promise(r => setTimeout(r, 20)); editor.undo();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return editor.getValue() === window.__qaBeforeTyping && view.contentEl.querySelectorAll('.gp-gutter-change').length === 0;
  }); check(undo, 'native editor undo updates gutter markers immediately');
  const staging = await run(async () => {
    const p = app.plugins.plugins['git-plus'], view = app.workspace.activeLeaf.view, editor = view.editor, path = p.git.repoPath(view.file.path);
    editor.replaceRange('暂存测试', { line: 0, ch: 1 }); await p.flushEditors();
    await p.git.stage([path]); await p.controller.refresh();
    for (let i = 0; i < 60 && view.contentEl.querySelector('.gp-gutter-change'); i++) await new Promise(r => setTimeout(r, 30));
    const clean = !view.contentEl.querySelector('.gp-gutter-change');
    await p.git.unstage([path]); await p.controller.refresh();
    for (let i = 0; i < 60 && !view.contentEl.querySelector('.gp-gutter-change'); i++) await new Promise(r => setTimeout(r, 30));
    const changed = !!view.contentEl.querySelector('.gp-gutter-change'); editor.setValue(window.__qaBeforeTyping);
    return clean && changed;
  }); check(staging, 'staging and unstaging refresh the cached baseline without reopening the editor');
  await run(async () => { const p = app.plugins.plugins['git-plus']; await p.flushEditors(); await p.controller.refresh(); app.workspace.activeLeaf.view.editor.setCursor({ line: 0, ch: 1 }); await new Promise(r => setTimeout(r, 800)); });
  await capture('git-plus-live-gutter.png');
};
