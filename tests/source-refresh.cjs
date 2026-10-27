// Exercise sidebar updates in the isolated Obsidian profile; real Git writes use its fixture only.
module.exports = async ({ js, check }) => {
  const run = fn => js(`(${fn.toString()})()`);
  check(await run(async () => {
    const p = app.plugins.plugins['git-workbench'], view = app.workspace.getLeavesOfType('git-workbench-source-control')[0].view;
    const header = view.contentEl.querySelector('.gp-sc-header'), input = view.contentEl.querySelector('.gp-commit-input'), branch = view.contentEl.querySelector('.gp-sc-repository'), list = view.contentEl.querySelector('.gp-virtual');
    window.__qaRefresh = { draft: input.value };
    input.value = '刷新期间保留的消息'; input.dispatchEvent(new Event('input')); input.focus(); input.setSelectionRange(2, 6);
    const focused = header.querySelector('.gp-sc-more'); focused.focus();
    await p.controller.refresh();
    return view.contentEl.querySelector('.gp-sc-header') === header && view.contentEl.querySelector('.gp-commit-input') === input && view.contentEl.querySelector('.gp-sc-repository') === branch && view.contentEl.querySelector('.gp-virtual') === list && document.activeElement === focused && input.value === '刷新期间保留的消息' && input.selectionStart === 2 && input.selectionEnd === 6;
  }), 'unchanged repository refresh preserves sidebar nodes, unfocused draft selection and toolbar focus');
  try {
    check(await run(async () => {
      const p = app.plugins.plugins['git-workbench'], view = app.workspace.getLeavesOfType('git-workbench-source-control')[0].view;
      const input = view.contentEl.querySelector('.gp-commit-input'), header = view.contentEl.querySelector('.gp-sc-header'), list = view.contentEl.querySelector('.gp-virtual');
      let release; const gate = new Promise(resolve => { release = resolve; });
      const operation = p.run('QA 侧栏更新', async () => { await gate; await p.git.stage(['笔记库/目录测试/子目录/第二篇.md']); });
      const busy = [...view.contentEl.querySelectorAll('.gp-sc-stage, .gp-sc-network button, .gp-submit')].every(button => button.disabled) && view.contentEl.querySelector('.gp-virtual') === list;
      try {
        release(); await operation;
        const changed = view.contentEl.querySelector('.gp-virtual') !== list && !!view.contentEl.querySelector('.gp-sc-file[data-group="index"][data-path="笔记库/目录测试/子目录/第二篇.md"]') && !view.contentEl.querySelector('.gp-sc-file[data-group="worktree"][data-path="笔记库/目录测试/子目录/第二篇.md"]');
        return busy && changed && view.contentEl.querySelector('.gp-sc-header') === header && view.contentEl.querySelector('.gp-commit-input') === input && input.value === '刷新期间保留的消息' && input.selectionStart === 2 && input.selectionEnd === 6 && [...view.contentEl.querySelectorAll('.gp-sc-stage')].every(button => !button.disabled);
      } finally { release(); await operation; await p.run('QA 恢复侧栏测试', () => p.git.unstage(['笔记库/目录测试/子目录/第二篇.md'])); }
    }), 'busy feedback updates in place and real staging updates rows without replacing header or draft');
    check(await run(async () => {
      const p = app.plugins.plugins['git-workbench'], c = p.controller, saved = c.status, view = app.workspace.getLeavesOfType('git-workbench-source-control')[0].view;
      try {
        c.status = { ...saved, files: [...saved.files, ...Array.from({ length: 80 }, (_, i) => ({ path: `笔记库/刷新滚动/文件-${i}.md`, index: '?', worktree: '?', untracked: true, conflict: false, submodule: false }))] }; view.render();
        const scroll = view.contentEl.querySelector('.gp-virtual'); scroll.scrollTop = 560; scroll.dispatchEvent(new Event('scroll'));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const focused = scroll.querySelector('button'); focused.focus(); const top = scroll.scrollTop;
        c.emit(); c.emit();
        return top > 0 && view.contentEl.querySelector('.gp-virtual') === scroll && scroll.scrollTop === top && document.activeElement === focused && focused.isConnected;
      } finally { c.status = saved; view.render(); }
    }), 'repeated status emissions preserve virtual-list scroll position and focused file controls');
    check(await run(async () => {
      const p = app.plugins.plugins['git-workbench'], c = p.controller, saved = c.status, view = app.workspace.getLeavesOfType('git-workbench-source-control')[0].view;
      const originalRun = p.run, originalContinue = p.git.continueOperation, input = view.contentEl.querySelector('.gp-commit-input'), calls = [];
      try {
        input.focus(); c.status = { ...saved, branch: 'qa-refresh', ahead: 3, behind: 2, upstream: 'origin/qa-refresh', operation: 'merge' }; view.render();
        c.busy = true; view.render(); const disabled = [...view.contentEl.querySelectorAll('.gp-sc-operation button')].every(button => button.disabled);
        c.busy = false; c.status = { ...c.status, operation: 'rebase' }; view.render();
        p.run = async (_label, work) => work(); p.git.continueOperation = async operation => { calls.push(operation); };
        view.contentEl.querySelector('.gp-sc-operation button').click(); await Promise.resolve(); await Promise.resolve();
        return disabled && calls.join(',') === 'rebase' && view.contentEl.querySelector('.gp-sc-branch-name').textContent === 'qa-refresh' && view.contentEl.querySelector('.gp-sc-tracking').textContent === '↑3 ↓2' && view.contentEl.querySelector('.gp-sc-branch').getAttribute('aria-label').includes('origin/qa-refresh') && view.contentEl.querySelector('.gp-operation strong').textContent.includes('rebase') && view.contentEl.querySelector('.gp-commit-input') === input && document.activeElement === input;
      } finally { p.run = originalRun; p.git.continueOperation = originalContinue; c.status = saved; c.busy = false; view.render(); }
    }), 'focused composer does not block branch, tracking or operation updates and operation callbacks use the current action');
    check(await run(() => {
      const p = app.plugins.plugins['git-workbench'], c = p.controller, view = app.workspace.getLeavesOfType('git-workbench-source-control')[0].view;
      const error = c.error, paused = c.automationPaused, enabled = p.settings.autoBackup, input = view.contentEl.querySelector('.gp-commit-input');
      try {
        c.error = 'QA 错误提示'; p.settings.autoBackup = true; c.automationPaused = true; c.emit();
        const notice = view.contentEl.querySelector('.gp-sc-feedback p'); c.emit();
        return view.contentEl.querySelectorAll('.gp-sc-feedback p').length === 2 && view.contentEl.querySelector('.gp-sc-feedback p') === notice && notice.textContent === 'QA 错误提示' && view.contentEl.querySelector('.gp-commit-input') === input;
      } finally { c.error = error; c.automationPaused = paused; p.settings.autoBackup = enabled; view.render(); }
    }), 'error and automation feedback refresh without duplicate notices or composer replacement');
    check(await run(() => {
      const p = app.plugins.plugins['git-workbench'], c = p.controller, repo = p.git.repo, error = c.error, view = app.workspace.getLeavesOfType('git-workbench-source-control')[0].view;
      try {
        p.git.repo = undefined; c.error = 'QA 未连接'; view.render(); const header = view.contentEl.querySelector('.gp-sc-header');
        c.error = 'QA 连接状态更新'; view.render();
        const disconnected = !!view.contentEl.querySelector('.gp-sc-disconnected') && view.contentEl.querySelector('.gp-sc-header') === header && view.contentEl.textContent.includes('QA 连接状态更新');
        p.git.repo = repo; c.error = error; view.render();
        return disconnected && !!view.contentEl.querySelector('.gp-sc-repository') && !!view.contentEl.querySelector('.gp-virtual') && view.contentEl.querySelector('.gp-commit-input').value === '刷新期间保留的消息';
      } finally { p.git.repo = repo; c.error = error; view.render(); }
    }), 'repository disconnect and reconnect rebuild only when the sidebar structure changes and keep the draft');
  } finally {
    await run(() => { const input = document.querySelector('.gp-commit-input'); input.value = window.__qaRefresh.draft; input.dispatchEvent(new Event('input')); input.blur(); delete window.__qaRefresh; });
  }
};
