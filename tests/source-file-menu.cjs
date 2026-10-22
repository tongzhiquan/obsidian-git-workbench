// Exercise real Obsidian menus; intercept only the OS boundary to avoid opening Explorer during QA.
module.exports = async ({ js, check, capture }) => {
  const run = (fn, ...args) => js(`(${fn.toString()})(...${JSON.stringify(args)})`);
  const wait = async fn => { for (let i = 0; i < 120; i++) { if (await run(fn)) return; await new Promise(r => setTimeout(r, 40)); } throw new Error('Source file menu did not settle'); };
  const context = path => run(async path => {
    const list = document.querySelector('.gp-sc-list .gp-virtual');
    for (let top = 0; top <= list.scrollHeight; top += 100) {
      list.scrollTop = top; list.dispatchEvent(new Event('scroll')); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const row = [...document.querySelectorAll('.gp-sc-file')].find(row => row.dataset.path === path);
      if (row) { const rect = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left + 40, clientY: rect.top + 12 })); return; }
    }
    throw new Error('Missing source row: ' + path);
  }, path);
  const reveal = async path => {
    await context(path);
    await run(() => [...document.querySelectorAll('.menu-item')].find(n => n.textContent.includes('在系统资源管理器中显示')).click());
  };
  await run(() => {
    const shell = require('electron').shell;
    const q = window.__qaSourceMenu = { shell, show: shell.showItemInFolder, open: shell.openPath, originalBridge: window.electron, nativeDescriptor: Object.getOwnPropertyDescriptor(app, 'showInFolder'), calls: [], nativeCalls: [], rendererCalls: [] };
    const hostShell = { showItemInFolder: path => q.calls.push({ kind: 'show', path }), openPath: async path => { q.calls.push({ kind: 'open', path }); return ''; } };
    q.remote = Object.create(window.electron.remote); Object.defineProperty(q.remote, 'shell', { value: hostShell });
    q.bridge = Object.create(window.electron); Object.defineProperty(q.bridge, 'remote', { value: q.remote, writable: true }); window.electron = q.bridge;
    app.showInFolder = path => { q.nativeCalls.push(path); hostShell.showItemInFolder(app.vault.adapter.getFullPath(path)); };
    shell.showItemInFolder = path => q.rendererCalls.push({ kind: 'show', path });
    shell.openPath = async path => { q.rendererCalls.push({ kind: 'open', path }); return ''; };
  });
  try {
    await context('笔记库/目录测试/子目录/第一篇.md');
    check(await run(() => {
      const items = [...document.querySelectorAll('.menu-item')], open = items.find(n => n.textContent.includes('在 Obsidian 中打开')), reveal = items.find(n => n.textContent.includes('在系统资源管理器中显示'));
      return !!open?.querySelector('svg.lucide-external-link') && !!reveal?.querySelector('svg.lucide-folder-open');
    }), 'file context menu shows Obsidian open and Explorer reveal with their icons');
    await capture('git-workbench-source-file-menu.png');
    await run(() => [...document.querySelectorAll('.menu-item')].find(n => n.textContent.includes('在 Obsidian 中打开')).click());
    await wait(() => app.workspace.getLeavesOfType('markdown').some(l => l.view.file?.path === '目录测试/子目录/第一篇.md' && l.view.editor?.getValue().length >= 6));
    check(true, 'file menu opens a vault file in an Obsidian editor');
    check(await run(async () => {
      const p = app.plugins.plugins['git-workbench'], path = '笔记库/目录测试/子目录/第一篇.md';
      const leaf = app.workspace.getLeavesOfType('markdown').find(l => l.view.file?.path === '目录测试/子目录/第一篇.md');
      leaf.view.editor.setSelection({ line: 0, ch: 2 }, { line: 0, ch: 6 });
      const selection = JSON.stringify(leaf.view.editor.listSelections());
      await p.openWorkbench(); await p.openNote(path);
      const fromMenu = app.workspace.activeLeaf === leaf;
      await p.openWorkbench(); await p.openComparisonFile(path);
      return fromMenu && app.workspace.activeLeaf === leaf && app.workspace.getLeavesOfType('markdown').filter(l => l.view.file?.path === '目录测试/子目录/第一篇.md').length === 1 && JSON.stringify(leaf.view.editor.listSelections()) === selection;
    }), 'sidebar and comparison open actions reuse and activate the existing note without resetting its selection');
    check(await run(async () => {
      const p = app.plugins.plugins['git-workbench'], path = '笔记库/目录测试/子目录/第二篇.md';
      await Promise.all([p.openNote(path), p.openComparisonFile(path), p.openNote(path)]);
      const leaves = app.workspace.getLeavesOfType('markdown').filter(l => l.view.file?.path === '目录测试/子目录/第二篇.md');
      const ok = leaves.length === 1 && app.workspace.activeLeaf === leaves[0]; leaves.forEach(l => l.detach()); return ok;
    }), 'concurrent sidebar and comparison requests create only one note tab');
    check(await run(async () => {
      const p = app.plugins.plugins['git-workbench'], file = await app.vault.create('打开复用.canvas', '{"nodes":[],"edges":[]}');
      try {
        await p.openNote(p.git.repoPath(file.path)); const leaf = app.workspace.activeLeaf;
        await p.openWorkbench(); await p.openComparisonFile(p.git.repoPath(file.path));
        return leaf.view.getViewType() === 'canvas' && app.workspace.activeLeaf === leaf && app.workspace.getLeavesOfType('canvas').filter(l => l.view.file?.path === file.path).length === 1;
      } finally { for (const leaf of app.workspace.getLeavesOfType('canvas')) if (leaf.view.file?.path === file.path) leaf.detach(); await app.vault.delete(file); }
    }), 'file-tab reuse also supports native non-Markdown file views');
    await reveal('笔记库/目录测试/子目录/第一篇.md');
    await wait(() => window.__qaSourceMenu.calls.length === 1);
    check(await run(() => {
      const q = window.__qaSourceMenu, call = q.calls[0]; return call.kind === 'show' && call.path === app.plugins.plugins['git-workbench'].git.path('笔记库/目录测试/子目录/第一篇.md') && q.nativeCalls[0] === '目录测试/子目录/第一篇.md' && !q.rendererCalls.length;
    }), 'vault file reveal uses the built-in Obsidian action with a vault-relative path');
    await context('库外文件.md');
    check(await run(() => ![...document.querySelectorAll('.menu-item')].some(n => n.textContent.includes('在 Obsidian 中打开'))), 'outside-vault file menu offers Explorer without an unavailable Obsidian action');
    await run(() => [...document.querySelectorAll('.menu-item')].find(n => n.textContent.includes('在系统资源管理器中显示')).click());
    await wait(() => window.__qaSourceMenu.calls.length === 2);
    check(await run(() => {
      const q = window.__qaSourceMenu, call = q.calls[1]; return call.kind === 'show' && call.path === app.plugins.plugins['git-workbench'].git.path('库外文件.md') && q.nativeCalls.length === 1 && !q.rendererCalls.length;
    }), 'outside-vault reveal uses the host main-process shell without passing an outside path to the vault API');
    await run(async () => {
      const p = app.plugins.plugins['git-workbench'], fs = require('node:fs/promises'), path = require('node:path');
      const file = '系统定位/已删除/空 格#%.txt';
      await fs.mkdir(path.dirname(p.git.path(file)), { recursive: true }); await fs.writeFile(p.git.path(file), 'deleted fixture\n');
      await p.git.stage([file]); window.__qaSourceMenu.deletedStaged = true; await fs.unlink(p.git.path(file)); await fs.rmdir(path.dirname(p.git.path(file)));
      window.__qaSourceMenu.index = await p.git.runner.text(['ls-files', '--stage', '-z']); window.__qaSourceMenu.head = (await p.git.status()).head;
      await p.controller.refresh();
    });
    await reveal('系统定位/已删除/空 格#%.txt');
    await wait(() => window.__qaSourceMenu.calls.length === 3);
    check(await run(async () => {
      const p = app.plugins.plugins['git-workbench'], q = window.__qaSourceMenu, call = q.calls[2];
      return call.kind === 'open' && call.path === p.git.path('系统定位') && (await p.git.runner.text(['ls-files', '--stage', '-z'])) === q.index && (await p.git.status()).head === q.head;
    }), 'deleted files with missing parent directories reveal the nearest existing directory without changing index or HEAD');
    check(await run(async () => {
      const p = app.plugins.plugins['git-workbench'], q = window.__qaSourceMenu; app.showInFolder = undefined;
      await p.revealFile('笔记库/目录测试/子目录/第一篇.md');
      return q.calls.length === 4 && q.calls[3].kind === 'show' && q.calls[3].path === p.git.path('笔记库/目录测试/子目录/第一篇.md') && q.nativeCalls.length === 1 && !q.rendererCalls.length;
    }), 'missing built-in reveal action falls back to the host main-process shell');
    check(await run(async () => {
      const p = app.plugins.plugins['git-workbench'], q = window.__qaSourceMenu; q.bridge.remote = undefined;
      await p.revealFile('库外文件.md');
      return q.rendererCalls.length === 1 && q.rendererCalls[0].kind === 'show' && q.rendererCalls[0].path === p.git.path('库外文件.md');
    }), 'missing host bridge retains a compatible Electron fallback');
  } finally {
    await run(async () => {
      const q = window.__qaSourceMenu; q.shell.showItemInFolder = q.show; q.shell.openPath = q.open; window.electron = q.originalBridge;
      if (q.nativeDescriptor) Object.defineProperty(app, 'showInFolder', q.nativeDescriptor); else delete app.showInFolder;
      const p = app.plugins.plugins['git-workbench']; if (q.deletedStaged) await p.git.unstage(['系统定位/已删除/空 格#%.txt']); await p.controller.refresh();
      for (const leaf of app.workspace.getLeavesOfType('markdown')) if (leaf.view.file?.path === '目录测试/子目录/第一篇.md') leaf.detach();
      await p.openWorkbench('graph');
    });
  }
};
