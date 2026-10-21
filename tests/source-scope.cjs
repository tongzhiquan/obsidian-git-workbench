// Filtering and bulk Git operations are exercised only in the disposable nested-vault fixture.
module.exports = async ({ js, check, capture }) => {
  const run = (fn, ...args) => js(`(${fn.toString()})(...${JSON.stringify(args)})`);
  const wait = async fn => { for (let i = 0; i < 160; i++) { if (await run(fn)) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('Source scope did not settle'); };
  await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    await p.git.stage(['库外文件.md']); await require('node:fs/promises').writeFile(p.git.path('库外文件.md'), 'outside working edit\n');
    await p.controller.refresh();
    window.__qaScope = { outside: (await p.git.file('库外文件.md', { kind: 'index' })).indexEntry, head: (await p.git.status()).head };
    const input = document.querySelector('.gp-commit-input'); input.value = '范围过滤测试'; input.dispatchEvent(new Event('input')); input.focus(); input.setSelectionRange(2, 5);
    window.__qaScope.input = input;
  });
  check(await run(() => !app.plugins.plugins['git-workbench'].settings.sourceControlVaultOnly && document.querySelector('.gp-sc-filter').getAttribute('aria-pressed') === 'false' && !!document.querySelector('.gp-outside')), 'source control defaults to showing the full repository including outside-vault files');
  await run(() => document.querySelector('.gp-sc-filter').click());
  await wait(async () => (await app.plugins.plugins['git-workbench'].loadData()).settings.sourceControlVaultOnly === true);
  check(await run(() => {
    const input = window.__qaScope.input, filter = document.querySelector('.gp-sc-filter');
    return input === document.querySelector('.gp-commit-input') && input.value === '范围过滤测试' && input.selectionStart === 2 && input.selectionEnd === 5 && filter.getAttribute('aria-pressed') === 'true' && filter.classList.contains('is-active');
  }), 'filter icon persists vault scope without replacing the commit input or losing draft selection');
  for (const layout of ['tree', 'list']) {
    await run(async layout => app.workspace.getLeavesOfType('git-workbench-source-control')[0].view.setLayout(layout), layout);
    check(await run(() => {
      const p = app.plugins.plugins['git-workbench'], files = p.controller.status.files.filter(f => p.git.vaultPath(f.path) !== undefined);
      const expected = { conflict: files.filter(f => f.conflict).length, index: files.filter(f => !f.conflict && !f.untracked && f.index !== '.').length, worktree: files.filter(f => !f.conflict && !f.untracked && f.worktree !== '.').length, untracked: files.filter(f => f.untracked).length };
      return !document.querySelector('.gp-outside') && [...document.querySelectorAll('.gp-sc-file')].every(row => p.git.vaultPath(row.dataset.path) !== undefined) && Object.entries(expected).every(([type, count]) => {
        const toggle = document.querySelector(`[data-collapse-key="group:${type}"]`), group = toggle?.closest('.gp-group-heading');
        return count ? group?.querySelector('.gp-sc-count').textContent === String(count) : !group;
      });
    }), `${layout} scope filters rows and group counts to the current vault`);
  }
  await capture('git-workbench-source-vault-filter.png');
  for (const group of ['worktree', 'untracked']) {
    await run(group => document.querySelector(`[data-collapse-key="group:${group}"]`).closest('.gp-group-heading').querySelector('.gp-sc-stage').click(), group);
    await wait(() => !app.plugins.plugins['git-workbench'].controller.busy);
  }
  check(await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    return (await p.git.file('库外文件.md', { kind: 'index' })).indexEntry === window.__qaScope.outside && (await p.git.file('库外文件.md', { kind: 'worktree' })).text === 'outside working edit\n' && !p.controller.status.files.some(f => p.git.vaultPath(f.path) !== undefined && (f.untracked || f.worktree !== '.')) && (await p.git.status()).head === window.__qaScope.head;
  }), 'vault-scoped stage-all stages only visible tracked and untracked changes and preserves outside staged and working content');
  await run(() => document.querySelector('[data-collapse-key="group:index"]').closest('.gp-group-heading').querySelector('.gp-sc-stage').click());
  await wait(() => !app.plugins.plugins['git-workbench'].controller.busy);
  check(await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    return !p.controller.status.files.some(f => p.git.vaultPath(f.path) !== undefined && !f.untracked && f.index !== '.') && (await p.git.file('库外文件.md', { kind: 'index' })).indexEntry === window.__qaScope.outside;
  }), 'vault-scoped unstage-all preserves hidden outside-vault staged entries');
  await run(async () => { await app.plugins.disablePlugin('git-workbench'); await app.plugins.enablePlugin('git-workbench'); await app.plugins.plugins['git-workbench'].controller.refresh(); });
  await wait(() => document.querySelector('.gp-sc-filter')?.getAttribute('aria-pressed') === 'true');
  check(await run(() => app.plugins.plugins['git-workbench'].settings.sourceControlVaultOnly && !document.querySelector('.gp-outside') && document.querySelector('.gp-sc-list').dataset.scope === 'vault'), 'vault scope and its filter icon survive plugin reload');
  await run(() => document.querySelector('.gp-sc-more').click());
  check(await run(() => {
    const item = [...document.querySelectorAll('.menu-item')].find(n => n.textContent.includes('仅显示当前笔记库的变更'));
    return !!item && (!!item.querySelector('svg.lucide-check') || item.getAttribute('aria-checked') === 'true' || item.classList.contains('is-checked'));
  }), 'overflow scope option shows the same enabled state as the filter icon');
  await capture('git-workbench-source-scope-menu.png');
  await run(() => [...document.querySelectorAll('.menu-item')].find(n => n.textContent.includes('打开 Git Workbench 工作台')).click());
  await wait(() => app.workspace.getLeavesOfType('git-workbench-workbench').length === 1 && app.workspace.activeLeaf === app.workspace.getLeavesOfType('git-workbench-workbench')[0]);
  check(true, 'restored overflow workbench entry opens the existing workbench without adding a tab');
  await run(() => document.querySelector('.gp-sc-more').click());
  await run(() => [...document.querySelectorAll('.menu-item')].find(n => n.textContent.includes('仅显示当前笔记库的变更')).click());
  await wait(async () => (await app.plugins.plugins['git-workbench'].loadData()).settings.sourceControlVaultOnly === false);
  check(await run(() => document.querySelector('.gp-sc-filter').getAttribute('aria-pressed') === 'false' && !document.querySelector('.gp-sc-filter').classList.contains('is-active') && !!document.querySelector('.gp-outside')), 'overflow scope toggle restores repository rows and synchronizes the filter icon');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; await p.git.unstage(['库外文件.md']); await p.controller.refresh();
    await app.workspace.getLeavesOfType('git-workbench-source-control')[0].view.setLayout('tree');
    const input = document.querySelector('.gp-commit-input'); input.value = ''; input.dispatchEvent(new Event('input'));
  });
};
