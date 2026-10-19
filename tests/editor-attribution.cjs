// All files and Git writes belong to the isolated Obsidian QA repository.
module.exports = async ({ js, check, capture }) => {
  const run = fn => js(`(${fn.toString()})()`);
  const wait = async predicate => {
    for (let i = 0; i < 100; i++) {
      if (await run(predicate)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('New-note attribution did not settle');
  };
  await run(async () => {
    window.__qaAttributionOriginalLeaf = app.workspace.activeLeaf;
    const file = await app.vault.create('新笔记归属.md', '# 尚未提交的笔记\n新笔记第二行\n');
    window.__qaNewNoteLeaf = app.workspace.getLeaf('tab');
    await window.__qaNewNoteLeaf.openFile(file);
    window.__qaNewNoteLeaf.view.editor.setCursor({ line: 1, ch: 1 });
    window.__qaNewNoteHead = (await app.plugins.plugins['git-workbench'].git.status()).head;
  });
  await wait(() => window.__qaNewNoteLeaf.view.contentEl.querySelector('.gp-inline-blame')?.textContent === '未提交的修改');
  check(await run(() => {
    const a = window.__qaNewNoteLeaf.view.contentEl.querySelector('.gp-inline-blame');
    return a.dataset.gpLine === '2' && a.tagName === 'SPAN' && !a.hasAttribute('title') && a.tabIndex === -1;
  }), 'untracked note shows passive inline uncommitted attribution on the selected line');
  await run(() => {
    const a = window.__qaNewNoteLeaf.view.contentEl.querySelector('.gp-inline-blame'), r = a.getBoundingClientRect();
    a.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: r.left + 10, clientY: r.top + 5 }));
  });
  await wait(() => document.querySelector('.gp-blame-card-diff')?.getAttribute('aria-busy') === 'false');
  check(await run(() => document.querySelector('.gp-blame-card-primary').disabled && !document.querySelector('.gp-blame-card-copy') && document.querySelector('.gp-blame-change-add.is-current code')?.textContent === '新笔记第二行'), 'untracked note hover shows the current added line without a fake author or commit SHA');
  await capture('git-workbench-untracked-blame.png');
  await run(() => { document.querySelector('.gp-blame-card-close').click(); window.__qaNewNoteLeaf.view.editor.setCursor({ line: 2, ch: 0 }); });
  await wait(() => window.__qaNewNoteLeaf.view.contentEl.querySelector('.gp-inline-blame')?.dataset.gpLine === '3');
  check(true, 'untracked note retains attribution on its trailing empty editor line');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; p.settings.fullBlame = true; p.controller.emit();
  });
  await wait(() => window.__qaNewNoteLeaf.view.contentEl.querySelectorAll('.gp-inline-blame').length >= 3);
  check(await run(() => [...window.__qaNewNoteLeaf.view.contentEl.querySelectorAll('.gp-inline-blame')].every(a => a.textContent === '未提交的修改')), 'whole-file attribution also covers new untracked note lines');
  await run(async () => {
    app.plugins.plugins['git-workbench'].settings.fullBlame = false;
    await app.plugins.disablePlugin('git-workbench'); await app.plugins.enablePlugin('git-workbench');
  });
  await wait(() => window.__qaNewNoteLeaf.view.contentEl.querySelector('.gp-inline-blame')?.textContent === '未提交的修改');
  check(true, 'plugin reload restores the new-note annotation in an already open editor');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; await p.git.stage(['笔记库/新笔记归属.md']); await p.controller.refresh();
  });
  await wait(() => window.__qaNewNoteLeaf.view.contentEl.querySelector('.gp-inline-blame')?.textContent === '未提交的修改');
  check(await run(async () => { const p = app.plugins.plugins['git-workbench']; const s = await p.git.status(); return s.head === window.__qaNewNoteHead && s.files.some(f => f.path === '笔记库/新笔记归属.md' && f.index === 'A'); }), 'staging a new note preserves uncommitted attribution without creating a commit');
  await run(async () => {
    await app.workspace.revealLeaf(window.__qaAttributionOriginalLeaf);
    window.__qaNewNoteLeaf.detach();
    await app.plugins.plugins['git-workbench'].controller.refresh();
  });
  await wait(() => app.workspace.activeLeaf.view.contentEl.querySelector('.gp-inline-blame')?.textContent.includes('Git Workbench QA'));
};
