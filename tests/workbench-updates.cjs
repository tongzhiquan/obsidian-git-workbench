// Regression checks for the approved changes, using only the isolated QA vault.
module.exports = async ({ js, check }) => {
  const run = fn => js(`(${fn.toString()})()`);
  check(await run(() => {
    const expected = ['open-workbench', 'open-source-control', 'file-history', 'file-diff', 'commit', 'fill-backup-message', 'generate-commit-message', 'fetch', 'pull', 'push', 'refresh', 'toggle-blame'].sort();
    const actual = Object.keys(app.commands.commands).filter(id => id.startsWith('git-workbench:')).map(id => id.slice('git-workbench:'.length)).sort();
    const p = app.plugins.plugins['git-workbench'];
    return JSON.stringify(expected) === JSON.stringify(actual) && typeof p.compareRefs === 'function' && typeof p.createBranch === 'function';
  }), 'only the 12 selected commands remain registered and removed command features retain their implementations');
  const aiSettings = await run(() => {
    const p = app.plugins.plugins['git-workbench'], tab = app.setting.pluginTabs.find(tab => tab.id === 'git-workbench'); tab.display();
    const names = [...tab.containerEl.querySelectorAll('.setting-item-name')].map(node => node.textContent);
    return { provider: p.settings.aiProvider, model: p.settings.aiModel, hasEndpoint: 'aiBaseUrl' in p.settings, names,
      deepSeek: tab.containerEl.textContent.includes('DeepSeek'), providerOptions: !!tab.containerEl.querySelector('select option[value="openai"], select option[value="custom"]'),
      password: !!tab.containerEl.querySelector('input[type="password"]') };
  });
  console.log('DeepSeek settings', aiSettings);
  check(aiSettings.provider === 'deepseek' && aiSettings.model === 'deepseek-flash' && !aiSettings.hasEndpoint && aiSettings.deepSeek &&
    !aiSettings.names.includes('AI 服务') && !aiSettings.names.includes('API 地址') && !aiSettings.providerOptions && aiSettings.password,
    'settings expose only DeepSeek with a model and masked key, without provider or custom endpoint controls');
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; await p.openWorkbench('graph'); p.compareRefs(' :empty ', ' :worktree ');
    const modal = [...document.querySelectorAll('.modal')].at(-1), inputs = modal.querySelectorAll('.gp-field input');
    inputs[0].value = '笔记库/项目笔记.md';
    [...modal.querySelectorAll('button')].find(button => button.textContent === '确定').click();
  });
  for (let i = 0; i < 100; i++) {
    if (await run(() => app.workspace.getLeavesOfType('git-workbench-workbench')[0]?.view.left.kind === 'empty' && !!document.querySelector('.gp-merge-body .cm-content'))) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  check(await run(() => {
    const view = app.workspace.getLeavesOfType('git-workbench-workbench')[0].view;
    return view.left.kind === 'empty' && view.right.kind === 'worktree' && !!document.querySelector('.gp-merge-body .cm-content');
  }), 'the retained comparison dialog accepts whitespace-trimmed :empty and :worktree revisions');
  check(await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    const file = text => ({ exists: true, text, size: text.length, binary: false, large: false });
    const original = p.git.conflict;
    const conflict = { path: '笔记库/回归冲突.md', base: file('base\n'), ours: file('ours\n'), theirs: file('theirs\n'), result: '<<<<<<<<< HEAD\nours\n=========\ntheirs\n>>>>>>>>> topic\n', markerSize: 9, fileLevel: false, blocks: [] };
    p.git.conflict = async () => conflict;
    try {
      await p.openConflict(conflict.path);
      const area = document.querySelector('.gp-conflict-result'), save = [...document.querySelectorAll('.gp-workbench-body > button')].find(button => button.textContent === '保存结果并暂存');
      if (!save.disabled || !document.querySelector('.gp-conflict-blocks').textContent.includes('剩余 1')) return false;
      area.value = '<<<<<<<<< HEAD\nleftover\n'; area.dispatchEvent(new Event('input', { bubbles: true }));
      if (!save.disabled || !document.querySelector('.gp-workbench-body p[role="status"]').textContent.includes('第 1 行')) return false;
      area.value = conflict.result; area.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('.gp-conflict-blocks button')].find(button => button.textContent === '保留双方').click();
      await Promise.resolve();
      return area.value === 'ours\ntheirs\n' && !save.disabled;
    } finally { p.git.conflict = original; }
  }), 'nine-character conflict blocks support keep-both while complete and orphaned markers disable saving');
  check(await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    const file = text => ({ exists: true, text, size: text.length, binary: false, large: false });
    const original = p.git.conflict;
    p.git.conflict = async () => ({ path: '笔记库/超限冲突.md', base: file('base\n'), ours: file('ours\n'), theirs: file('theirs\n'), result: null, markerSize: 7, fileLevel: true, blocks: [] });
    try {
      await p.openConflict('笔记库/超限冲突.md');
      return !document.querySelector('.gp-conflict-result') && ![...document.querySelectorAll('.gp-workbench-body > button')].some(button => button.textContent === '保存结果并暂存') &&
        document.querySelectorAll('.gp-conflict-sides button').length === 2;
    } finally { p.git.conflict = original; await p.openWorkbench('graph'); }
  }), 'an unavailable merge result offers file choices without an empty editable result or text-save action');
};
