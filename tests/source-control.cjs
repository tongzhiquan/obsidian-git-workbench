// All Git mutations below use the isolated QA repository.
module.exports = async ({ window, js, check, capture }) => {
  const run = (fn, ...args) => js(`(${fn.toString()})(...${JSON.stringify(args)})`);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const settle = async () => { await delay(100); };
  await run(async () => {
    const p = app.plugins.plugins['git-plus'];
    await app.vault.createFolder('目录测试/子目录');
    await app.vault.create('目录测试/子目录/第一篇.md', 'one\n'); await app.vault.create('目录测试/子目录/第二篇.md', 'two\n');
    await p.git.stage(['笔记库/目录测试/子目录/第一篇.md', '笔记库/目录测试/子目录/第二篇.md']);
    await p.git.commit('QA 侧栏目录基准');
    await app.vault.modify(app.vault.getAbstractFileByPath('目录测试/子目录/第一篇.md'), 'changed one\n');
    await app.vault.modify(app.vault.getAbstractFileByPath('目录测试/子目录/第二篇.md'), 'changed two\n');
    await p.git.stage(['笔记库/目录测试/子目录/第一篇.md']);
    await app.vault.modify(app.vault.getAbstractFileByPath('目录测试/子目录/第一篇.md'), 'another working edit\n');
    await p.controller.refresh();
  }); await settle();
  check(await run(() => document.querySelector('.gp-sc-list').dataset.layout === 'tree' && !!document.querySelector('.gp-sc-folder')), 'source control defaults to a hierarchical directory tree');
  const compact = await run(() => {
    const side = document.querySelector('.gp-source-control').getBoundingClientRect(), list = document.querySelector('.gp-sc-list').getBoundingClientRect();
    return { height: list.top - side.top, network: [...document.querySelectorAll('.gp-sc-network button')].every(b => !b.textContent.trim() && b.querySelector('svg') && b.getAttribute('aria-label')), list: list.height, message: document.querySelector('.gp-commit-input').clientHeight };
  });
  check(compact.height < 175 && compact.message < 50 && compact.network && compact.list > 450, 'compact composer and icon-only remote actions leave most sidebar height for changes');
  const collapse = await run(async () => {
    const folder = document.querySelector('[data-folder="笔记库/目录测试"][data-group="worktree"] .gp-sc-toggle');
    folder.click(); await new Promise(r => setTimeout(r, 50));
    const absent = ![...document.querySelectorAll('.gp-sc-file[data-group="worktree"]')].some(r => r.dataset.path.startsWith('笔记库/目录测试/'));
    const staged = !!document.querySelector('.gp-sc-file[data-group="index"][data-path="笔记库/目录测试/子目录/第一篇.md"]');
    await app.plugins.plugins['git-plus'].controller.refresh();
    const persisted = document.querySelector('[data-folder="笔记库/目录测试"][data-group="worktree"] .gp-sc-toggle').getAttribute('aria-expanded') === 'false';
    document.querySelector('[data-folder="笔记库/目录测试"][data-group="worktree"] .gp-sc-toggle').click();
    return { absent, staged, persisted };
  }); check(collapse.absent && collapse.staged && collapse.persisted, 'folder collapse is independent per status group and survives refresh');
  const preserved = await run(async () => {
    const input = document.querySelector('.gp-commit-input'); input.value = '未提交的消息'; input.dispatchEvent(new Event('input')); input.focus(); input.setSelectionRange(2, 4);
    document.querySelector('.gp-sc-layout').click(); await new Promise(r => setTimeout(r, 70));
    return input === document.querySelector('.gp-commit-input') && input.value === '未提交的消息' && input.selectionStart === 2 && input.selectionEnd === 4 && document.querySelector('.gp-sc-list').dataset.layout === 'list' && !document.querySelector('.gp-sc-folder') && !!document.querySelector('.gp-sc-directory');
  }); check(preserved, 'list toggle preserves composer node, draft and selection while showing filename plus directory');
  await capture('git-plus-sidebar-list.png');
  const persisted = await run(async () => {
    const p = app.plugins.plugins['git-plus']; await p.persistSettings(); await app.plugins.disablePlugin('git-plus'); await app.plugins.enablePlugin('git-plus');
    for (let i = 0; i < 80 && !document.querySelector('.gp-source-control'); i++) await new Promise(r => setTimeout(r, 30));
    return app.plugins.plugins['git-plus'].settings.sourceControlLayout === 'list' && document.querySelector('.gp-sc-list').dataset.layout === 'list';
  }); check(persisted, 'source control layout choice survives plugin reload');
  await run(() => document.querySelector('.gp-sc-layout').click()); await settle();
  const stagedFolder = await run(async () => {
    const p = app.plugins.plugins['git-plus'];
    const before = (await p.git.status()).head;
    document.querySelector('[data-folder="笔记库/目录测试"][data-group="worktree"] .gp-sc-stage').click();
    for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 40)); if (!p.controller.busy && (await p.git.status()).files.filter(f => f.path.startsWith('笔记库/目录测试/') && f.worktree !== '.').length === 0) break; }
    const staged = (await p.git.status()).files.filter(f => f.path.startsWith('笔记库/目录测试/') && f.index !== '.').length;
    document.querySelector('[data-folder="笔记库/目录测试"][data-group="index"] .gp-sc-stage').click();
    for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 40)); if (!p.controller.busy && (await p.git.status()).files.filter(f => f.path.startsWith('笔记库/目录测试/') && f.index !== '.').length === 0) break; }
    return { staged, head: (await p.git.status()).head === before, unstaged: (await p.git.status()).files.filter(f => f.path.startsWith('笔记库/目录测试/') && f.worktree !== '.').length };
  }); check(stagedFolder.staged === 2 && stagedFolder.unstaged === 2 && stagedFolder.head, 'folder stage and unstage affect only descendant files and never create a commit');
  const actions = await run(async () => {
    const p = app.plugins.plugins['git-plus'], original = p.network, invoked = [];
    p.network = async action => { invoked.push(action); };
    try { for (const button of document.querySelectorAll('.gp-sc-network button')) button.click(); await new Promise(r => setTimeout(r, 50)); } finally { p.network = original; }
    return invoked;
  }); check(actions.join(',') === 'fetch,pull,push', 'remote icons retain fetch, fast-forward pull and push actions');
  window.focus(); await run(() => { window.focus(); document.querySelector('.gp-sc-more').click(); }); await settle();
  check(await run(() => [...document.querySelectorAll('.menu-item')].some(n => n.textContent.includes('以列表形式查看')) && [...document.querySelectorAll('.menu-item')].some(n => n.textContent.includes('仓库操作'))), 'overflow menu exposes both layouts, expand/collapse and repository operations');
  await run(() => [...document.querySelectorAll('.menu-item')].find(n => n.textContent.includes('以树形式查看')).click()); await settle();
  const groupCollapse = await run(async () => {
    const toggle = () => document.querySelector('[data-collapse-key="group:worktree"]');
    toggle().click(); await new Promise(r => setTimeout(r, 50));
    const hidden = !document.querySelector('.gp-sc-file[data-group="worktree"]');
    toggle().click(); await new Promise(r => setTimeout(r, 50));
    return hidden && !!document.querySelector('.gp-sc-file[data-group="worktree"]');
  }); check(groupCollapse, 'status groups can be collapsed and reopened without losing files');
  for (const theme of ['light', 'dark']) {
    await run(() => document.querySelectorAll('.notice').forEach(node => node.remove()));
    await run(theme => { document.body.toggleClass('theme-light', theme === 'light'); document.body.toggleClass('theme-dark', theme === 'dark'); }, theme);
    await capture(`git-plus-sidebar-tree-${theme}.png`);
  }
  const narrow = await run(async () => {
    const side = app.workspace.rightSplit.containerEl, old = side.getAttribute('style');
    side.style.setProperty('width', '230px', 'important'); await new Promise(r => setTimeout(r, 100));
    const panel = document.querySelector('.gp-source-control'), ok = panel.clientWidth <= 235 && panel.scrollWidth <= panel.clientWidth + 1 && [...panel.querySelectorAll('.gp-sc-header button, .gp-sc-network button')].every(node => node.getBoundingClientRect().width > 15);
    window.__qaSideStyle = old; return ok;
  }); check(narrow, 'narrow sidebar keeps toolbar icons visible without horizontal overflow');
  await capture('git-plus-sidebar-narrow.png');
  await run(() => { const side = app.workspace.rightSplit.containerEl; if (window.__qaSideStyle === null) side.removeAttribute('style'); else side.setAttribute('style', window.__qaSideStyle); });
};
