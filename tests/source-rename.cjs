// All paths and Git writes in this suite belong to the disposable QA repository.
module.exports = async ({ js, check }) => {
  const run = (fn, ...args) => js(`(${fn.toString()})(...${JSON.stringify(args)})`);
  const wait = async fn => { for (let i = 0; i < 160; i++) { if (await run(fn)) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Renamed source-control row did not settle'); };
  await run(async () => {
    const p = app.plugins.plugins['git-workbench'], folder = '00-重命名暂存', prefix = `笔记库/${folder}/`;
    await app.vault.createFolder(folder);
    const text = 'rename baseline\n'.repeat(30), oldNames = ['2026-10-29（周四） [x].md', '第二篇.md'], newNames = ['2026-10-29~30（周四） [x].md', '第二篇-新名称.md'];
    const files = oldNames.map((name, i) => ({ old: `${folder}/${name}`, path: `${folder}/${newNames[i]}` }));
    for (const file of files) await app.vault.create(file.old, text);
    const oldPaths = files.map(file => `笔记库/${file.old}`);
    await p.git.stage(oldPaths); await p.git.runner.text(['commit', '--only', '--message=QA 重命名暂存基准', '--', ...oldPaths]);
    const otherIndex = (await p.git.runner.text(['ls-files', '--stage', '-z'])).split('\0').filter(entry => entry && !entry.split('\t')[1].startsWith(prefix)).join('\0');
    window.__qaRename = { files, text, prefix, otherIndex, head: (await p.git.status()).head };
    for (const file of files) {
      await app.vault.rename(app.vault.getAbstractFileByPath(file.old), file.path);
      await p.git.stage([`笔记库/${file.old}`, `笔记库/${file.path}`]);
      await app.vault.modify(app.vault.getAbstractFileByPath(file.path), text + 'working edit\n');
    }
    await p.controller.refresh();
  });
  try {
    for (const layout of ['tree', 'list']) {
      await run(async layout => {
        const p = app.plugins.plugins['git-workbench'], state = window.__qaRename, view = app.workspace.getLeavesOfType('git-workbench-source-control')[0].view;
        await app.vault.modify(app.vault.getAbstractFileByPath(state.files[0].path), state.text + layout + ' edit\n');
        await p.controller.refresh(); await view.setLayout(layout);
        if (layout === 'tree') document.querySelector('.gp-sc-expand').click();
      }, layout);
      await wait(() => [...document.querySelectorAll('.gp-sc-file[data-group="worktree"]')].some(row => row.dataset.path === `笔记库/${window.__qaRename.files[0].path}`));
      await run(() => [...document.querySelectorAll('.gp-sc-file[data-group="worktree"]')].find(row => row.dataset.path === `笔记库/${window.__qaRename.files[0].path}`).querySelector('.gp-sc-stage').click());
      await wait(() => !app.plugins.plugins['git-workbench'].controller.busy);
      check(await run(async layout => {
        const p = app.plugins.plugins['git-workbench'], state = window.__qaRename, file = state.files[0], status = p.controller.status.files.find(entry => entry.path === `笔记库/${file.path}`);
        return !p.controller.error && status?.index === 'R' && status.worktree === '.' && (await p.git.file(`笔记库/${file.path}`, { kind: 'index' })).text === state.text + layout + ' edit\n' && !(await p.git.file(`笔记库/${file.old}`, { kind: 'index' })).exists;
      }, layout), `${layout} file plus stages content after an already staged rename without a missing-path error`);
    }
    await run(async () => {
      const p = app.plugins.plugins['git-workbench'], state = window.__qaRename, view = app.workspace.getLeavesOfType('git-workbench-source-control')[0].view;
      await app.vault.modify(app.vault.getAbstractFileByPath(state.files[0].path), state.text + 'folder edit\n');
      await p.controller.refresh(); await view.setLayout('tree'); document.querySelector('.gp-sc-expand').click();
    });
    await wait(() => !!document.querySelector(`[data-folder="${window.__qaRename.prefix.slice(0, -1)}"][data-group="worktree"] .gp-sc-stage`));
    await run(() => document.querySelector(`[data-folder="${window.__qaRename.prefix.slice(0, -1)}"][data-group="worktree"] .gp-sc-stage`).click());
    await wait(() => !app.plugins.plugins['git-workbench'].controller.busy);
    check(await run(async () => {
      const p = app.plugins.plugins['git-workbench'], state = window.__qaRename;
      const files = p.controller.status.files.filter(file => file.path.startsWith(state.prefix));
      return !p.controller.error && files.length === 2 && files.every(file => file.index === 'R' && file.worktree === '.') && (await p.git.status()).head === state.head;
    }), 'folder plus restages multiple renamed files without changing HEAD');
    await run(() => document.querySelector(`[data-folder="${window.__qaRename.prefix.slice(0, -1)}"][data-group="index"] .gp-sc-stage`).click());
    await wait(() => !app.plugins.plugins['git-workbench'].controller.busy);
    check(await run(async () => {
      const p = app.plugins.plugins['git-workbench'], state = window.__qaRename;
      const otherIndex = (await p.git.runner.text(['ls-files', '--stage', '-z'])).split('\0').filter(entry => entry && !entry.split('\t')[1].startsWith(state.prefix)).join('\0');
      for (const file of state.files) {
        if ((await p.git.file(`笔记库/${file.old}`, { kind: 'index' })).text !== state.text || (await p.git.file(`笔记库/${file.path}`, { kind: 'index' })).exists) return false;
      }
      return !p.controller.error && otherIndex === state.otherIndex && (await p.git.file(`笔记库/${state.files[0].path}`, { kind: 'worktree' })).text === state.text + 'folder edit\n';
    }), 'folder minus restores both sides of renamed index entries and preserves working content and unrelated staged entries');
  } finally {
    await run(async () => {
      const p = app.plugins.plugins['git-workbench'], state = window.__qaRename, paths = [];
      for (const file of state.files) {
        paths.push(`笔记库/${file.old}`);
        if ((await p.git.file(`笔记库/${file.path}`, { kind: 'index' })).exists) paths.push(`笔记库/${file.path}`);
      }
      await p.git.unstage(paths);
      for (const file of state.files) {
        await app.vault.rename(app.vault.getAbstractFileByPath(file.path), file.old);
        await app.vault.modify(app.vault.getAbstractFileByPath(file.old), state.text);
      }
      await p.controller.refresh(); delete window.__qaRename;
    });
  }
};
