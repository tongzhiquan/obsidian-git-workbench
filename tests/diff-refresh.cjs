// Real editor identity, scroll and ordering checks in the disposable Obsidian vault.
module.exports = async ({ js, check, capture }) => {
  const run = fn => js(`(${fn.toString()})()`);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async fn => { for (let i = 0; i < 140; i++) { if (await run(fn)) return; await pause(50); } throw new Error('Incremental comparison did not settle'); };
  await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    const text = Array.from({ length: 300 }, (_, i) => `line ${i + 1}: original`).join('\n') + '\n';
    await app.vault.create('刷新测试.md', text); await p.git.stage(['笔记库/刷新测试.md']); await p.git.commit('QA 增量刷新基准');
    await app.vault.modify(app.vault.getAbstractFileByPath('刷新测试.md'), text.replace('line 20: original', 'line 20: changed').replace('line 80: original', 'line 80: changed').replace('line 160: original', 'line 160: changed'));
    p.settings.diffMode = 'split'; await p.controller.refresh(); await p.openDiff('笔记库/刷新测试.md', { kind: 'index' }, { kind: 'worktree' });
  });
  await wait(() => document.querySelectorAll('.gp-line-stage').length >= 1);
  await pause(1000); // Let the fixture's create/modify notifications settle before measuring.
  await run(async () => {
    const p = app.plugins.plugins['git-workbench'], api = require('@codemirror/view').EditorView;
    const a = api.findFromDOM(document.querySelector('.cm-merge-a')), b = api.findFromDOM(document.querySelector('.cm-merge-b'));
    b.dispatch({ selection: { anchor: b.state.doc.line(160).from } });
    const scrolling = document.querySelector('.cm-mergeView'); scrolling.scrollTop = 300;
    await new Promise(resolve => setTimeout(resolve, 100));
    const probe = window.__qaRefresh = { pane: document.querySelector('.gp-diff-pane'), toolbar: document.querySelector('.gp-filters'), a, b, scrolling, top: scrolling.scrollTop, cursor: b.state.selection.main.head, reads: 0, done: 0, disconnected: false };
    const originalDiff = p.git.diff, originalStatus = p.git.status;
    p.git.diff = async function (...args) { const sequence = ++probe.reads; try { return await originalDiff.apply(this, args); } finally { probe.done = sequence; } };
    // Deterministically distinguish the successful file write from the subsequent status refresh.
    p.git.status = async function (...args) { if (p.controller.busy) await new Promise(resolve => setTimeout(resolve, 350)); return originalStatus.apply(this, args); };
    probe.restore = () => { p.git.diff = originalDiff; p.git.status = originalStatus; probe.observer.disconnect(); };
    probe.observer = new MutationObserver(() => {
      if (!probe.pane.isConnected || !a.dom.isConnected || !b.dom.isConnected) probe.disconnected = true;
      if (!probe.updated && a.state.doc.line(20).text === 'line 20: changed') probe.updated = { ms: performance.now() - probe.start, whileBusy: p.controller.busy };
    });
    probe.observer.observe(document.querySelector('.gp-workbench'), { childList: true, subtree: true });
    probe.start = performance.now(); document.querySelector('.gp-line-stage[data-after-line="20"]').click();
  });
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && !!window.__qaRefresh.updated);
  const first = await run(() => {
    const q = window.__qaRefresh;
    return { updated: q.updated, reads: q.reads, stable: q.pane === document.querySelector('.gp-diff-pane') && q.toolbar === document.querySelector('.gp-filters') && q.a.dom.isConnected && q.b.dom.isConnected && !q.disconnected, top: q.scrolling.scrollTop, oldTop: q.top, cursor: q.b.state.selection.main.head === q.cursor };
  });
  console.log('Incremental line action', first);
  check(first.updated.whileBusy && first.reads === 1 && first.stable && first.cursor && first.oldTop > 100 && Math.abs(first.top - first.oldTop) < 2, 'split staging updates after the Git write and before status refresh without rereading the diff or replacing editors and scroll');
  await run(() => app.plugins.plugins['git-workbench'].controller.scheduleRefresh());
  await wait(() => window.__qaRefresh.done >= 2);
  await pause(100);
  check(await run(() => { const q = window.__qaRefresh; return !q.disconnected && q.pane === document.querySelector('.gp-diff-pane') && q.toolbar === document.querySelector('.gp-filters') && q.b.dom.isConnected && Math.abs(q.scrolling.scrollTop - q.top) < 2; }), 'the delayed 600ms refresh keeps the same comparison editors, toolbar and scroll position');
  await capture('git-workbench-incremental-diff.png');
  await run(() => document.querySelector('[aria-label="折叠未修改区域"]').click());
  await wait(() => !!document.querySelector('.cm-collapsedLines'));
  await run(async () => app.plugins.plugins['git-workbench'].controller.refresh());
  await wait(() => window.__qaRefresh.done >= 3);
  await pause(100);
  check(await run(() => window.__qaRefresh.a.dom.isConnected && window.__qaRefresh.b.dom.isConnected && !!document.querySelector('.cm-collapsedLines') && document.querySelector('[aria-label="展开未修改区域"]').getAttribute('aria-pressed') === 'true'), 'repository refresh retains the existing editors and folded unchanged regions');
  await run(() => window.__qaRefresh.restore());

  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; p.settings.diffMode = 'unified'; await p.openDiff('笔记库/刷新测试.md', { kind: 'index' }, { kind: 'worktree' });
  });
  try { await wait(() => { const view = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.gp-merge-body .cm-editor')); view.scrollDOM.scrollTop = 1700; return !!document.querySelector('.gp-line-stage[data-after-line="80"]'); }); }
  catch (error) { console.log('Unified scroll diagnostics', await run(() => [...document.querySelectorAll('.gp-workbench-body, .gp-diff-pane, .gp-merge-body, .cm-editor, .cm-scroller')].map(node => ({ className: node.className, top: node.scrollTop, height: node.clientHeight, content: node.scrollHeight, overflow: getComputedStyle(node).overflowY, buttons: [...node.querySelectorAll('.gp-line-stage')].map(button => button.dataset.afterLine) })))); throw error; }
  await run(() => { window.__qaUnifiedRefresh = document.querySelector('.gp-merge-body .cm-editor'); document.querySelector('.gp-line-stage[data-after-line="80"]').click(); });
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && !document.querySelector('.gp-line-stage[data-after-line="80"]'));
  check(await run(async () => window.__qaUnifiedRefresh === document.querySelector('.gp-merge-body .cm-editor') && (await app.plugins.plugins['git-workbench'].git.file('笔记库/刷新测试.md', { kind: 'index' })).text.includes('line 80: changed') && !app.plugins.plugins['git-workbench'].worktreeEdits.size), 'unified staging updates its original document in the existing editor without creating unsaved edits');
  await run(async () => app.plugins.plugins['git-workbench'].openDiff('笔记库/刷新测试.md', { kind: 'commit', ref: 'HEAD' }, { kind: 'index' }));
  await wait(() => !!document.querySelector('.gp-line-unstage[data-after-line="20"]'));
  await run(() => { window.__qaUnifiedRefresh = document.querySelector('.gp-merge-body .cm-editor'); document.querySelector('.gp-line-unstage[data-after-line="20"]').click(); });
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && !document.querySelector('.gp-line-unstage[data-after-line="20"]'));
  check(await run(async () => { const p = app.plugins.plugins['git-workbench'], index = await p.git.file('笔记库/刷新测试.md', { kind: 'index' }); return window.__qaUnifiedRefresh === document.querySelector('.gp-merge-body .cm-editor') && !p.indexEdits.size && index.text.includes('line 20: original') && index.text.includes('line 80: changed'); }), 'unified cancel staging updates the existing document without adding an unsaved edit');

  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; await p.openDiff('笔记库/刷新测试.md', { kind: 'index' }, { kind: 'worktree' });
    window.__qaRejectedRefresh = { editor: document.querySelector('.gp-merge-body .cm-editor'), original: p.git.applyLines };
    p.git.applyLines = async () => { throw new Error('QA 拒绝逐行写入'); };
    document.querySelector('.gp-line-stage[data-after-line="20"]').click();
  });
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && app.plugins.plugins['git-workbench'].controller.error === 'QA 拒绝逐行写入');
  check(await run(async () => { const p = app.plugins.plugins['git-workbench']; return window.__qaRejectedRefresh.editor === document.querySelector('.gp-merge-body .cm-editor') && !!document.querySelector('.gp-line-stage[data-after-line="20"]') && (await p.git.file('笔记库/刷新测试.md', { kind: 'index' })).text.includes('line 20: original'); }), 'a failed Git write keeps the changed line visible and retains the existing comparison editor');
  await run(async () => { const p = app.plugins.plugins['git-workbench']; p.git.applyLines = window.__qaRejectedRefresh.original; await p.git.unstage(['笔记库/刷新测试.md']); await p.controller.refresh(); await p.openWorkbench('graph'); });
  await require('node:fs/promises').writeFile(require('node:path').join(__dirname, '../.qa/diff-refresh-results.json'), JSON.stringify(first, null, 2));
};
