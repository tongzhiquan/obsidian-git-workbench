// Runs against the isolated vault, with all automatic tasks left disabled.
module.exports = async ({ js, check }) => {
  const run = fn => js(`(${fn.toString()})()`);
  check(await run(() => {
    const tab = app.setting.pluginTabs.find(tab => tab.id === 'git-workbench'); tab.display();
    const headings = [...tab.containerEl.querySelectorAll('h3')];
    const backup = headings.find(node => node.textContent === '自动备份');
    const rows = [...tab.containerEl.querySelectorAll('.setting-item-name')].map(node => node.textContent);
    return !rows.includes('Git 可执行文件') && !rows.includes('恢复自动备份') && !rows.includes('自动备份因错误暂停') &&
      headings.at(-1) === backup && backup.nextElementSibling.nextElementSibling.querySelector('.setting-item-name').textContent === '启用自动备份' &&
      tab.containerEl.querySelector('.gp-ai-prompt textarea').value.includes('BREAKING CHANGE:');
  }), 'settings hide Git path and idle recovery, place automation last, and show editable detailed AI constraints');
  check(await run(async () => {
    const p = app.plugins.plugins['git-workbench'], tab = app.setting.pluginTabs.find(tab => tab.id === 'git-workbench');
    const original = p.settings.aiPrompt;
    const input = tab.containerEl.querySelector('.gp-ai-prompt textarea');
    input.value = '自定义中文提交约束'; input.dispatchEvent(new Event('input', { bubbles: true })); await p.persistSettings();
    const saved = (await p.loadData()).settings.aiPrompt === input.value;
    tab.containerEl.querySelector('.gp-ai-prompt button').click(); await p.persistSettings();
    return saved && p.settings.aiPrompt === original && (await p.loadData()).settings.aiPrompt === original;
  }), 'AI constraints can be edited, persisted and restored to the skill-based defaults');
  check(await run(async () => {
    const p = app.plugins.plugins['git-workbench'], tab = app.setting.pluginTabs.find(tab => tab.id === 'git-workbench');
    const row = name => [...tab.containerEl.querySelectorAll('.setting-item')].find(node => node.querySelector('.setting-item-name')?.textContent === name);
    try {
      p.controller.automationPaused = true; tab.display();
      if (row('自动备份因错误暂停')) return false;
      p.settings.autoBackup = true; tab.display();
      const paused = row('自动备份因错误暂停'); if (!paused) return false;
      paused.querySelector('button').click();
      return !p.controller.automationPaused && !row('自动备份因错误暂停');
    } finally { p.settings.autoBackup = false; p.controller.automationPaused = false; p.configureAutomation(); await p.persistSettings(); tab.display(); }
  }), 'error recovery appears only for enabled paused automation and clears only the error pause');
  check(await run(() => {
    const input = document.querySelector('.gp-commit-input'), ai = document.querySelector('.gp-generate-ai-message');
    const textRect = input.getBoundingClientRect(), aiRect = ai.getBoundingClientRect();
    return ai.parentElement === input.parentElement && !!ai.querySelector('svg.lucide-wand-sparkles') &&
      aiRect.top >= textRect.top && aiRect.bottom <= textRect.bottom && aiRect.right <= textRect.right;
  }), 'AI wand button occupies the original composer position inside the message field');
};
