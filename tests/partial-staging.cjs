// All writes are limited to the disposable Obsidian QA repository.
module.exports = async ({ js, check, capture }) => {
  const run = fn => js(`(${fn.toString()})()`);
  const wait = async fn => { for (let i = 0; i < 120; i++) { if (await run(fn)) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('Partial staging UI did not settle'); };
  await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    await app.vault.create('逐行测试.md', '# lines\na\nb\nmiddle\nremove one\nremove two\nend\n');
    await p.git.stage(['笔记库/逐行测试.md']); await p.git.commit('QA 逐行基准');
    await app.vault.modify(app.vault.getAbstractFileByPath('逐行测试.md'), '# lines\nA\nB\nextra\nmiddle\nend\n');
    p.settings.diffMode = 'split'; await p.controller.refresh(); await p.openDiff('笔记库/逐行测试.md', { kind: 'index' }, { kind: 'worktree' });
  });
  await wait(() => !!document.querySelector('.gp-line-stage'));
  const count = await run(() => ({ stage: document.querySelectorAll('.gp-line-stage').length, restore: document.querySelectorAll('.gp-line-restore').length }));
  console.log('Split line actions', count);
  check(count.stage === 5 && count.restore === 5, 'split gutters expose individual replacement, insertion and deletion actions including empty-side spacers');
  await capture('git-workbench-line-actions-split.png');
  await wait(() => {
    const node = document.querySelector('.cm-merge-b'); if (!node) return false;
    const v = require('@codemirror/view').EditorView.findFromDOM(node);
    v.dispatch({ selection: { anchor: v.state.doc.line(2).from, head: v.state.doc.line(3).to } });
    return true;
  });
  await wait(() => document.querySelector('.gp-line-selection')?.textContent.includes('已选 2'));
  await run(() => [...document.querySelectorAll('.gp-line-selection button')].find(b => b.textContent === '暂存所选修改').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && !!document.querySelector('.cm-merge-b') && !document.querySelector('.gp-save-worktree'));
  check(await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    return (await p.git.file('笔记库/逐行测试.md', { kind: 'index' })).text === '# lines\nA\nB\nmiddle\nremove one\nremove two\nend\n' && (await p.git.file('笔记库/逐行测试.md', { kind: 'worktree' })).text === '# lines\nA\nB\nextra\nmiddle\nend\n' && require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b')).state.readOnly && document.querySelector('.gp-diff-columns > span:last-child').textContent === '工作区 · 只读';
  }), 'multi-line selection stages only selected replacements and partially staged working files become noneditable by default');
  await wait(() => !!document.querySelector('.gp-line-stage[data-before-line="5"]'));
  await run(() => document.querySelector('.gp-line-stage[data-before-line="5"]').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && !!document.querySelector('.gp-line-restore[data-after-line="4"]'));
  check(await run(async () => (await app.plugins.plugins['git-workbench'].git.file('笔记库/逐行测试.md', { kind: 'index' })).text === '# lines\nA\nB\nmiddle\nremove two\nend\n'), 'right-side deletion anchor stages only that deleted line');
  await run(() => document.querySelector('.gp-line-restore[data-after-line="4"]').click());
  await wait(() => !!document.querySelector('.gp-confirm-detail'));
  await run(() => [...document.querySelectorAll('.modal button')].find(b => b.textContent === '还原').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && document.querySelectorAll('.gp-line-stage').length === 1);
  check(await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    return (await p.git.file('笔记库/逐行测试.md', { kind: 'worktree' })).text === '# lines\nA\nB\nmiddle\nend\n' && (await p.git.file('笔记库/逐行测试.md', { kind: 'index' })).text === '# lines\nA\nB\nmiddle\nremove two\nend\n';
  }), 'left-side restore reverts only the insertion in the worktree and preserves staged content');
  await run(async () => { const p = app.plugins.plugins['git-workbench']; p.settings.diffMode = 'unified'; await p.openDiff('笔记库/逐行测试.md', { kind: 'index' }, { kind: 'worktree' }); });
  await wait(() => !!document.querySelector('.cm-deletedChunk') && !!document.querySelector('.gp-line-stage'));
  check(await run(() => document.querySelectorAll('.gp-line-stage').length === 1 && document.querySelectorAll('.gp-line-restore').length === 1), 'unified deleted-line gutter provides stage and restore without replacing copyable deleted text');
  await capture('git-workbench-line-actions-unified.png');
  await run(() => document.querySelector('.gp-line-stage').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && !document.querySelector('.gp-line-stage'));
  await run(async () => app.plugins.plugins['git-workbench'].openDiff('笔记库/逐行测试.md', { kind: 'commit', ref: 'HEAD' }, { kind: 'index' }));
  await wait(() => document.querySelectorAll('.gp-line-unstage').length === 4);
  await run(() => document.querySelector('.gp-line-unstage[data-before-line="2"]').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && document.querySelectorAll('.gp-line-unstage').length === 3);
  check(await run(async () => {
    const p = app.plugins.plugins['git-workbench']; return (await p.git.file('笔记库/逐行测试.md', { kind: 'index' })).text === '# lines\na\nB\nmiddle\nend\n' && (await p.git.file('笔记库/逐行测试.md', { kind: 'worktree' })).text === '# lines\nA\nB\nmiddle\nend\n';
  }), 'unified cancel-staging restores only the selected index line and retains worktree edits');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; await app.vault.create('逐行新增.md', 'first\nsecond\nthird\n'); await p.openDiff('笔记库/逐行新增.md', { kind: 'index' }, { kind: 'worktree' });
  });
  await wait(() => document.querySelectorAll('.gp-line-stage').length === 3);
  await run(() => document.querySelector('.gp-line-stage[data-after-line="2"]').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && document.querySelectorAll('.gp-line-stage').length === 2);
  check(await run(async () => (await app.plugins.plugins['git-workbench'].git.file('笔记库/逐行新增.md', { kind: 'index' })).text === 'second\n'), 'unified untracked files support staging one line without staging the rest');
  await run(async () => { const p = app.plugins.plugins['git-workbench']; await p.git.unstage(['笔记库/逐行测试.md', '笔记库/逐行新增.md']); await p.openWorkbench('graph'); });
};
