// All writes are limited to the disposable Obsidian QA repository.
module.exports = async ({ js, check, capture }) => {
  const run = (fn, ...args) => js(`(${fn.toString()})(...${JSON.stringify(args)})`);
  const wait = async fn => { for (let i = 0; i < 120; i++) { if (await run(fn)) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('Partial staging UI did not settle'); };
  await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    await app.vault.create('逐行测试.md', '# lines\na\nb\nmiddle\nremove one\nremove two\nend\n');
    await p.git.stage(['笔记库/逐行测试.md']); await p.git.commit('QA 逐行基准');
    await app.vault.modify(app.vault.getAbstractFileByPath('逐行测试.md'), '# lines\nA\nB\nextra\nmiddle\nend\n');
    p.settings.diffMode = 'split'; p.settings.stagingMode = 'line'; await p.controller.refresh(); await p.openDiff('笔记库/逐行测试.md', { kind: 'index' }, { kind: 'worktree' });
  });
  await wait(() => !!document.querySelector('.gp-line-stage'));
  const count = await run(() => ({ stage: document.querySelectorAll('.gp-line-stage').length, restore: document.querySelectorAll('.gp-line-restore').length }));
  console.log('Split line actions', count);
  check(count.stage === 5 && count.restore === 5, 'split gutters expose individual replacement, insertion and deletion actions including empty-side spacers');
  await capture('git-workbench-line-actions-split.png');
  await run(() => document.querySelector('.gp-staging-option[data-staging-mode="block"]').click());
  await wait(() => document.querySelectorAll('.gp-block-stage').length === 2);
  const blockControls = await run(() => [...document.querySelectorAll('.gp-block-stage')].map(control => control.dataset.blockEdits.split(',').length));
  check(blockControls[0] === 3 && blockControls[1] === 2 && await run(async () => (await app.plugins.plugins['git-workbench'].loadData()).settings.stagingMode === 'block'), 'staging mode persists and groups adjacent replacements, insertions and deletions into two actions');
  const blockVisual = await run(() => {
    const first = document.querySelector('.gp-block-stage');
    const rows = [...document.querySelectorAll('.gp-block-boundary')];
    const brackets = rows.every(row => {
      const style = getComputedStyle(row, '::before');
      return style.borderLeftWidth === '1px' && style.borderRightWidth === '0px'
        && (style.borderTopWidth === '1px') === (row.classList.contains('gp-block-start') || row.classList.contains('gp-block-single'))
        && (style.borderBottomWidth === '1px') === (row.classList.contains('gp-block-end') || row.classList.contains('gp-block-single'));
    });
    const plain = [...document.querySelectorAll('.cm-line.gp-block-range')].every(line => getComputedStyle(line).boxShadow === 'none' && getComputedStyle(line).backgroundImage === 'none');
    window.__qaBracketTheme = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
    return {badges: document.querySelectorAll('.gp-block-badge').length, aria: first?.getAttribute('aria-label'), left: document.querySelectorAll('.cm-merge-a .cm-line.gp-block-range').length, right: document.querySelectorAll('.cm-merge-b .cm-line.gp-block-range').length, rows: rows.length, brackets, plain};
  });
  check(blockVisual.badges === 0 && blockVisual.aria?.includes('左侧第 2 至 3 行 → 右侧第 2 至 4 行') && blockVisual.left === 4 && blockVisual.right === 3 && blockVisual.rows === 8 && blockVisual.brackets && blockVisual.plain, 'split block ranges use gutter brackets with start/end caps and line-range hints without badges or content frames');
  for (const theme of ['dark', 'light']) {
    await run(theme => { document.body.removeClass('theme-dark', 'theme-light'); document.body.addClass(`theme-${theme}`); }, theme);
    await capture(`git-workbench-block-brackets-${theme}.png`);
    const normal = await run(() => [...document.querySelectorAll('.cm-line.gp-block-range')].map(line => getComputedStyle(line).backgroundColor));
    await run(() => document.querySelector('.gp-block-stage').dispatchEvent(new PointerEvent('pointerenter')));
    await wait(() => document.querySelectorAll('.cm-merge-a .cm-line.gp-block-range-hover').length === 2 && document.querySelectorAll('.cm-merge-b .cm-line.gp-block-range-hover').length === 3 && document.querySelectorAll('.gp-block-boundary-active').length === 5);
    check(await run(normal => {
      const lines = [...document.querySelectorAll('.cm-line.gp-block-range')];
      return lines.every((line, index) => (getComputedStyle(line).backgroundColor !== normal[index]) === line.classList.contains('gp-block-range-hover') && getComputedStyle(line).boxShadow === 'none' && getComputedStyle(line).backgroundImage === 'none');
    }, normal), `${theme} theme hover links both gutter brackets and strengthens only the matching red/green ranges`);
    await capture(`git-workbench-block-brackets-${theme}-hover.png`);
    await run(() => document.querySelector('.gp-block-stage').dispatchEvent(new PointerEvent('pointerleave')));
    await wait(() => !document.querySelector('.gp-block-range-hover, .gp-block-boundary-active'));
  }
  await run(() => { document.body.removeClass('theme-dark', 'theme-light'); document.body.addClass(`theme-${window.__qaBracketTheme}`); });
  await run(() => document.querySelector('.gp-block-stage').focus());
  await wait(() => document.querySelectorAll('.cm-merge-a .cm-line.gp-block-range-hover').length === 2 && document.querySelectorAll('.cm-merge-b .cm-line.gp-block-range-hover').length === 3 && document.querySelectorAll('.gp-block-boundary-active').length === 5);
  await run(() => document.querySelector('.gp-block-stage').blur());
  await wait(() => !document.querySelector('.gp-block-range-hover, .gp-block-boundary-active'));
  await run(() => document.querySelectorAll('.gp-block-stage')[1].dispatchEvent(new PointerEvent('pointerenter')));
  await wait(() => document.querySelectorAll('.cm-merge-a .cm-line.gp-block-range-hover').length === 2 && !document.querySelector('.cm-merge-b .cm-line.gp-block-range-hover') && document.querySelectorAll('.gp-block-boundary-active').length === 3);
  check(await run(() => !!document.querySelector('.cm-merge-b .gp-block-single.gp-block-boundary-active')), 'pure deletion highlights its two removed lines and the opposite empty-side bracket');
  await run(() => document.querySelectorAll('.gp-block-stage')[1].dispatchEvent(new PointerEvent('pointerleave')));
  await wait(() => !document.querySelector('.gp-block-range-hover, .gp-block-boundary-active'));
  await run(async () => { const p = app.plugins.plugins['git-workbench']; p.settings.diffMode = 'unified'; await p.openDiff('笔记库/逐行测试.md', { kind: 'index' }, { kind: 'worktree' }); });
  await wait(() => document.querySelectorAll('.cm-deletedLine.gp-block-range').length === 4 && document.querySelectorAll('.cm-line.gp-block-range').length === 3);
  await run(() => document.querySelector('.gp-block-stage').focus());
  await wait(() => document.querySelectorAll('.cm-deletedLine.gp-block-range-hover').length === 2 && document.querySelectorAll('.cm-line.gp-block-range-hover').length === 3 && document.querySelectorAll('.gp-block-boundary-active').length === 5);
  await run(() => document.querySelector('.gp-block-restore').focus());
  await wait(() => document.querySelector('.gp-block-restore') === document.activeElement);
  check(await run(() => {
    const rows = [...document.querySelectorAll('.gp-block-boundary-active')];
    return rows.length === 5 && rows.filter(row => row.classList.contains('gp-block-start')).length === 1 && rows.filter(row => row.classList.contains('gp-block-end')).length === 1;
  }), 'unified replacements share one continuous bracket across old and new rows and retain linked highlighting when focus moves between actions');
  await capture('git-workbench-block-brackets-unified-replacement.png');
  await run(async () => { const p = app.plugins.plugins['git-workbench']; p.settings.diffMode = 'split'; await p.openDiff('笔记库/逐行测试.md', { kind: 'index' }, { kind: 'worktree' }); });
  await wait(() => !!document.querySelector('.cm-merge-b') && document.querySelectorAll('.gp-block-stage').length === 2);
  await run(() => document.querySelector('.gp-block-stage').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && document.querySelectorAll('.gp-block-stage').length === 1);
  check(await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    return (await p.git.file('笔记库/逐行测试.md', { kind: 'index' })).text === '# lines\nA\nB\nextra\nmiddle\nremove one\nremove two\nend\n' && (await p.git.file('笔记库/逐行测试.md', { kind: 'worktree' })).text === '# lines\nA\nB\nextra\nmiddle\nend\n';
  }), 'staging one block leaves the other block and working file unchanged');
  await run(async () => app.plugins.plugins['git-workbench'].openDiff('笔记库/逐行测试.md', { kind: 'commit', ref: 'HEAD' }, { kind: 'index' }));
  await wait(() => !!document.querySelector('.gp-block-unstage'));
  await run(() => document.querySelector('.gp-block-unstage').click());
  await wait(async () => !app.plugins.plugins['git-workbench'].controller.busy && !(await app.plugins.plugins['git-workbench'].git.file('笔记库/逐行测试.md', { kind: 'index' })).text.includes('\nA\n'));
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; p.settings.stagingMode = 'line'; await p.persistSettings();
    await p.openDiff('笔记库/逐行测试.md', { kind: 'index' }, { kind: 'worktree' });
  });
  await wait(() => document.querySelectorAll('.gp-line-stage').length === 5);
  check(await run(async () => (await app.plugins.plugins['git-workbench'].git.file('笔记库/逐行测试.md', { kind: 'index' })).text === '# lines\na\nb\nmiddle\nremove one\nremove two\nend\n'), 'cancel-staging a whole block restores the original index snapshot');
  await wait(() => {
    const node = document.querySelector('.cm-merge-b'); if (!node) return false;
    const v = require('@codemirror/view').EditorView.findFromDOM(node);
    v.dispatch({ selection: { anchor: v.state.doc.line(2).from, head: v.state.doc.line(3).to } });
    return true;
  });
  await wait(() => document.querySelector('.gp-line-selection')?.textContent.includes('已选 2'));
  await run(() => [...document.querySelectorAll('.gp-line-selection button')].find(b => b.textContent === '暂存所选修改').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && !!document.querySelector('.cm-merge-b') && !!document.querySelector('.gp-save-worktree'));
  check(await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    return (await p.git.file('笔记库/逐行测试.md', { kind: 'index' })).text === '# lines\nA\nB\nmiddle\nremove one\nremove two\nend\n' && (await p.git.file('笔记库/逐行测试.md', { kind: 'worktree' })).text === '# lines\nA\nB\nextra\nmiddle\nend\n' && !require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b')).state.readOnly && document.querySelector('.gp-diff-columns > span:last-child').textContent === '工作区 · 可编辑';
  }), 'multi-line selection stages only selected replacements and keeps partially staged working files editable by default');
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
  await run(async () => { const p = app.plugins.plugins['git-workbench']; p.settings.stagingMode = 'block'; await p.persistSettings(); p.settings.diffMode = 'unified'; await p.openDiff('笔记库/逐行测试.md', { kind: 'index' }, { kind: 'worktree' }); });
  await wait(() => !!document.querySelector('.cm-deletedChunk .cm-deletedLine.gp-block-range') && !!document.querySelector('.gp-block-stage'));
  const unifiedVisual = await run(() => ({deleted: [...document.querySelectorAll('.cm-deletedChunk .cm-deletedLine')].map(node => ({text: node.textContent, classes: node.className, blockId: node.dataset.gpBlockId})), control: [...document.querySelectorAll('.gp-block-stage')].map(node => node.getAttribute('aria-label'))}));
  check(unifiedVisual.deleted.length === 1 && unifiedVisual.deleted[0].classes.includes('gp-block-range') && unifiedVisual.control.some(label => label.includes('左侧第 5 至 5 行 → 右侧无修改行')), 'unified view marks deleted ranges with a gutter bracket and exposes the original-line range');
  await capture('git-workbench-block-brackets-unified.png');
  await run(() => document.querySelector('.gp-block-stage').dispatchEvent(new PointerEvent('pointerenter')));
  await wait(() => !!document.querySelector('.cm-deletedLine.gp-block-range-hover') && !!document.querySelector('.gp-block-boundary-active'));
  check(await run(() => getComputedStyle(document.querySelector('.cm-deletedLine.gp-block-range-hover')).boxShadow === 'none'), 'unified deleted range hover keeps its semantic red background without a content frame');
  await capture('git-workbench-block-brackets-unified-hover.png');
  await run(() => document.querySelector('.gp-block-stage').dispatchEvent(new PointerEvent('pointerleave')));
  await wait(() => !document.querySelector('.gp-block-range-hover, .gp-block-boundary-active'));
  await run(async () => { const p = app.plugins.plugins['git-workbench']; p.settings.stagingMode = 'line'; await p.persistSettings(); await p.openDiff('笔记库/逐行测试.md', { kind: 'index' }, { kind: 'worktree' }); });
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
  await run(() => document.querySelector('.gp-staging-option[data-staging-mode="block"]').click());
  await wait(() => !!document.querySelector('.gp-block-stage'));
  await run(() => document.querySelector('.gp-block-stage').focus());
  await wait(() => document.querySelectorAll('.cm-line.gp-block-range-hover').length === 3 && document.querySelectorAll('.gp-block-boundary-active').length === 3);
  check(await run(() => document.querySelector('.gp-block-stage').getAttribute('aria-label').includes('左侧无修改行（插入点第 1 行）')), 'pure addition brackets all inserted lines and describes the empty-side insertion point');
  await run(() => document.querySelector('.gp-staging-option[data-staging-mode="line"]').click());
  await wait(() => document.querySelectorAll('.gp-line-stage').length === 3 && !document.querySelector('.gp-block-boundary, .gp-block-range-hover'));
  await run(() => document.querySelector('.gp-line-stage[data-after-line="2"]').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && document.querySelectorAll('.gp-line-stage').length === 2);
  check(await run(async () => (await app.plugins.plugins['git-workbench'].git.file('笔记库/逐行新增.md', { kind: 'index' })).text === 'second\n'), 'unified untracked files support staging one line without staging the rest');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    window.__qaPermissionBase = { index: (await p.git.file('笔记库/逐行测试.md', { kind: 'index' })).indexEntry, head: (await p.git.status()).head };
  });
  for (const mode of ['split', 'unified']) {
    await run(async mode => {
      const p = app.plugins.plugins['git-workbench']; p.settings.diffMode = mode; p.settings.allowEditingStagedFiles = false;
      await p.persistSettings(); await p.controller.refresh(); await p.openDiff('笔记库/逐行测试.md', { kind: 'index' }, { kind: 'worktree' });
    }, mode);
    await wait(() => !!document.querySelector('.gp-save-worktree') && !!document.querySelector('.cm-merge-b, .gp-merge-body > .cm-editor'));
    check(await run(mode => {
      const api = require('@codemirror/view').EditorView, view = api.findFromDOM(document.querySelector('.cm-merge-b, .gp-merge-body > .cm-editor'));
      return !view.state.readOnly && !!document.querySelector('.gp-save-worktree') && (mode !== 'split' || api.findFromDOM(document.querySelector('.cm-merge-a')).state.readOnly && document.querySelector('.gp-diff-columns > span:last-child').textContent === '工作区 · 可编辑');
    }, mode), `${mode} partially staged worktree remains editable while its index baseline stays read-only`);
    await run(mode => {
      const view = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b, .gp-merge-body > .cm-editor'));
      view.dispatch({ changes: { from: 0, to: view.state.doc.line(1).to, insert: `# lines: ${mode} worktree edit` } });
      window.__qaPermissionExpected = view.state.sliceDoc();
    }, mode);
    await wait(() => !!app.plugins.plugins['git-workbench'].worktreeEdits.size);
    for (const enabled of [true, false]) {
      await run(() => {
        const tab = app.setting.pluginTabs.find(tab => tab.id === 'git-workbench'); tab.display();
        [...tab.containerEl.querySelectorAll('.setting-item')].find(row => row.querySelector('.setting-item-name')?.textContent === '允许编辑暂存区').querySelector('.checkbox-container').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      await wait(async () => {
        const p = app.plugins.plugins['git-workbench']; return p.settings.allowEditingStagedFiles === (await p.loadData()).settings.allowEditingStagedFiles;
      });
      check(await run(enabled => {
        const p = app.plugins.plugins['git-workbench'], view = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b, .gp-merge-body > .cm-editor'));
        return p.settings.allowEditingStagedFiles === enabled && !view.state.readOnly && view.state.sliceDoc() === window.__qaPermissionExpected && p.worktreeEdits.has('笔记库/逐行测试.md');
      }, enabled), `${mode} changing index editing to ${enabled} preserves pending worktree edits and permission`);
    }
    await run(() => document.querySelector('.gp-save-worktree').click());
    await wait(() => !app.plugins.plugins['git-workbench'].controller.busy && !app.plugins.plugins['git-workbench'].worktreeEdits.size);
    check(await run(async () => {
      const p = app.plugins.plugins['git-workbench'];
      return (await p.git.file('笔记库/逐行测试.md', { kind: 'worktree' })).text === window.__qaPermissionExpected && (await p.git.file('笔记库/逐行测试.md', { kind: 'index' })).indexEntry === window.__qaPermissionBase.index && (await p.git.status()).head === window.__qaPermissionBase.head;
    }), `${mode} partially staged worktree saves the edited text without changing index or HEAD`);
    await capture(`git-workbench-partial-permissions-${mode}.png`);
    await run(async () => app.plugins.plugins['git-workbench'].openDiff('笔记库/逐行测试.md', { kind: 'commit', ref: 'HEAD' }, { kind: 'index' }));
    await wait(() => {
      const node = document.querySelector('.cm-merge-b, .gp-merge-body > .cm-editor');
      return !!node && require('@codemirror/view').EditorView.findFromDOM(node).state.readOnly && !document.querySelector('.gp-save-worktree');
    });
    check(await run(() => {
      const view = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b, .gp-merge-body > .cm-editor')), before = view.state.sliceDoc();
      view.dispatch({ changes: { from: 0, insert: 'must not enter index' } });
      return view.state.readOnly && !document.querySelector('.gp-save-index') && view.state.sliceDoc() === before;
    }), `${mode} index remains read-only and rejects typing while index editing is disabled`);
  }
  await run(async () => { const p = app.plugins.plugins['git-workbench']; await p.git.unstage(['笔记库/逐行测试.md', '笔记库/逐行新增.md']); await p.openWorkbench('graph'); });
};
