// Language tests run only in the isolated fixture owned by obsidian.cjs.
module.exports = async ({ window, js, check, capture }) => {
  const run = fn => js(`(${fn.toString()})()`);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (fn, label) => { for (let i = 0; i < 100; i++) { if (await run(fn)) return; await pause(60); } throw new Error('Language check timed out: ' + label); };
  await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    window.__languageOriginalPrompt = p.settings.aiPrompt;
    p.settings.aiPrompt = 'Language QA: keep this 自定义提示词 unchanged.';
    const name = '语言比较.md', repoPath = p.git.repoPath(name);
    await app.vault.create(name, '# Language fixture\n\noriginal line\n');
    await p.git.stage([repoPath]); await p.git.commit('test: seed language comparison');
    await app.vault.modify(app.vault.getAbstractFileByPath(name), '# Language fixture\n\nworking line\n');
    p.settings.diffMode = 'split'; await p.controller.refresh();
    await p.openWorkbench(); await p.openSourceControl();
    await p.openDiff(repoPath, { kind: 'index' }, { kind: 'worktree' });
  });
  await wait(() => !!document.querySelector('.cm-merge-b .cm-content'), 'comparison');
  const retained = await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    const editor = require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b'));
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: 'unsaved 语言 draft\n' }, selection: { anchor: 4 } });
    const message = document.querySelector('.gp-commit-input'); message.value = 'draft: keep 中文 commit message'; message.dispatchEvent(new Event('input', { bubbles: true }));
    window.__languageEditor = editor;
    const before = { text: editor.state.sliceDoc(), state: editor.state, scroll: editor.scrollDOM.scrollTop, cursor: editor.state.selection.main.head };
    const tab = app.setting.pluginTabs.find(tab => tab.id === 'git-workbench'); tab.display();
    const select = tab.containerEl.querySelector('.gp-language-setting select');
    const options = [...select.options].map(option => option.value);
    select.value = 'en'; select.dispatchEvent(new Event('change', { bubbles: true })); await p.persistSettings();
    const saved = await p.loadData();
    return { options, preference: saved.settings.language, prompt: saved.settings.aiPrompt,
      sameEditor: editor === require('@codemirror/view').EditorView.findFromDOM(document.querySelector('.cm-merge-b')),
      sameDocument: before.state.doc === editor.state.doc, sameSelection: before.state.selection.eq(editor.state.selection), text: before.text === editor.state.sliceDoc(), cursor: before.cursor === editor.state.selection.main.head,
      scroll: before.scroll === editor.scrollDOM.scrollTop, draft: p.worktreeEdits.get('笔记库/语言比较.md')?.text === before.text,
      message: document.querySelector('.gp-commit-input').value, unchangedLanguage: document.querySelector('.gp-sc-header strong').textContent,
      notice: [...document.querySelectorAll('.notice')].some(node => node.textContent.includes('手动重载') && node.textContent.includes('未保存')) };
  });
  console.log('Language preference state', retained);
  check(JSON.stringify(retained.options) === '["auto","zh-CN","en"]' && retained.preference === 'en', 'language dropdown has auto, Chinese and English and persists the selected preference');
  check(retained.sameEditor && retained.sameDocument && retained.sameSelection && retained.text && retained.cursor && retained.scroll && retained.draft && retained.message === 'draft: keep 中文 commit message', 'saving a language preference retains the comparison editor, document, selection and both drafts');
  check(retained.unchangedLanguage === '源代码管理' && retained.notice, 'language changes wait for manual reload and remind users to save comparison edits');
  check(retained.prompt === 'Language QA: keep this 自定义提示词 unchanged.', 'saving language preserves the custom AI prompt');

  // A conflict result is another editable surface that must not be rerendered on preference changes.
  check(await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    const path = p.git.repoPath('语言冲突.md');
    const file = text => ({ exists: true, text, size: text.length, binary: false, large: false });
    const original = p.git.conflict;
    p.git.conflict = async () => ({ path, base: file('base\n'), ours: file('ours\n'), theirs: file('theirs\n'), result: '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> topic\n', fileLevel: false, blocks: [] });
    try { await p.openConflict(path); } finally { p.git.conflict = original; }
    const result = document.querySelector('.gp-conflict-result');
    result.value = 'manually resolved 中文 content\n'; result.dispatchEvent(new Event('input', { bubbles: true }));
    const tab = app.setting.pluginTabs.find(tab => tab.id === 'git-workbench'); tab.display();
    const select = tab.containerEl.querySelector('.gp-language-setting select');
    select.value = 'zh-CN'; select.dispatchEvent(new Event('change', { bubbles: true })); await p.persistSettings();
    select.value = 'en'; select.dispatchEvent(new Event('change', { bubbles: true })); await p.persistSettings();
    return result === document.querySelector('.gp-conflict-result') && result.value === 'manually resolved 中文 content\n';
  }), 'language preference changes retain the conflict result textarea and its unsaved edits');

  // Save the comparison edit explicitly before the user-initiated reload used by this test.
  await run(async () => {
    const p = app.plugins.plugins['git-workbench'], path = '笔记库/语言比较.md';
    const draft = p.worktreeEdits.get(path);
    await p.saveWorkingFile(path, draft.text, draft.base); p.setEdit(path, 'worktree');
    await app.plugins.disablePlugin('git-workbench'); await app.plugins.enablePlugin('git-workbench');
  });
  await wait(() => document.querySelector('.gp-sc-header strong')?.textContent === 'Source Control', 'English startup');
  const english = await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    const view = await p.openWorkbench('graph');
    const tab = app.setting.pluginTabs.find(tab => tab.id === 'git-workbench'); tab.display();
    return { prompt: p.settings.aiPrompt, command: app.commands.commands['git-workbench:stage-file'].name,
      settings: tab.containerEl.querySelector('.gp-language-setting').textContent,
      aiHint: tab.containerEl.querySelector('.gp-ai-prompt .setting-item-description').textContent,
      groups: [...document.querySelectorAll('.gp-group-heading .gp-sc-row-name')].map(node => node.textContent),
      tabs: [...view.contentEl.querySelectorAll('.gp-tabs button')].map(node => node.textContent),
      savedFile: await app.vault.read(app.vault.getAbstractFileByPath('语言比较.md')) };
  });
  check(english.command.includes('Stage current note') && english.settings.includes('Follow Obsidian') && english.aiHint.includes('independently of the UI language'), 'manual reload localizes commands and settings and explains independent AI output language');
  check(english.tabs.includes('Commit Graph') && english.tabs.includes('File History') && english.groups.some(name => name === 'Unstaged') && !english.groups.some(name => /[\u3400-\u9fff]/.test(name)), 'English workbench and source-control groups use actual translated labels');
  check(english.prompt === 'Language QA: keep this 自定义提示词 unchanged.' && english.savedFile.includes('unsaved 语言 draft'), 'manual reload preserves the AI prompt and explicitly saved working content');

  check(await run(async () => {
    const p = app.plugins.plugins['git-workbench'];
    await p.openSourceControl();
    document.querySelector('.gp-sc-more').click();
    await new Promise(resolve => setTimeout(resolve, 60));
    const texts = [...document.querySelectorAll('.menu-item-title')].map(node => node.textContent);
    return texts.includes('View as list') && texts.includes('Repository actions…') && !texts.some(text => /[\u3400-\u9fff]/.test(text));
  }), 'Source Control context menu is translated in English');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await run(async () => {
    const p = app.plugins.plugins['git-workbench']; p.settings.stagingMode = 'block';
    await p.openDiff('笔记库/语言比较.md', { kind: 'index' }, { kind: 'worktree' });
  });
  await wait(() => !!document.querySelector('.gp-staging-mode'), 'English comparison');
  check(await run(() => {
    const mode = document.querySelector('.gp-staging-mode');
    const range = document.querySelector('.gp-block-stage')?.getAttribute('aria-label');
    return mode.getAttribute('aria-label') === 'Staging mode' && mode.textContent === 'LineBlock' && !!document.querySelector('[aria-label="Next change"]') && range?.includes('Left:') && !/[\u3400-\u9fff]/.test(range);
  }), 'English comparison translates navigation, staging modes and complete block ranges');

  await run(async () => {
    const file = app.vault.getAbstractFileByPath('项目笔记.md');
    await app.workspace.getLeaf('tab').openFile(file); app.workspace.activeLeaf.view.editor.setCursor({ line: 0, ch: 1 });
  });
  await wait(() => !!document.querySelector('.gp-inline-blame'), 'English attribution');
  await run(() => { const node = document.querySelector('.gp-inline-blame'), rect = node.getBoundingClientRect(); node.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: rect.left + 30, clientY: rect.top + 5 })); });
  await wait(() => document.querySelector('.gp-blame-card-diff')?.getAttribute('aria-busy') === 'false', 'English hover');
  check(await run(() => document.querySelector('.gp-blame-card-primary')?.textContent.includes('View commit') && document.querySelector('.gp-blame-card-history')?.textContent.includes('File history') && document.querySelector('.gp-blame-card-context')?.textContent.includes('Line 1')), 'English attribution hover translates controls and line context while retaining note and commit data');
  await capture('git-workbench-language-en.png');
  await run(async () => {
    document.querySelector('.gp-blame-card-close')?.click();
    const p = app.plugins.plugins['git-workbench']; p.settings.aiPrompt = window.__languageOriginalPrompt; p.settings.language = 'zh-CN'; await p.persistSettings();
    await app.plugins.disablePlugin('git-workbench'); await app.plugins.enablePlugin('git-workbench');
  });
  await wait(() => document.querySelector('.gp-sc-header strong')?.textContent === '源代码管理', 'Chinese reload');
  check(await run(() => app.commands.commands['git-workbench:stage-file'].name.includes('暂存当前笔记')), 'switching back to Chinese takes effect after manual reload');
};
