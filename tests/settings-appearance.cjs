// Uses the real settings window in an isolated Obsidian profile.
const { BrowserWindow } = require('electron');
const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');

module.exports = async ({ js, check, root }) => {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  let settingsWindow;
  const openSettings = async () => {
    await js("app.setting.open(); app.setting.openTabById('git-workbench'); void 0");
    for (let attempt = 0; attempt < 100; attempt++) {
      for (const candidate of BrowserWindow.getAllWindows()) {
        if (await candidate.webContents.executeJavaScript("!!document.querySelector('.gp-settings')").catch(() => false)) {
          settingsWindow = candidate; settingsWindow.removeAllListeners('show'); return;
        }
      }
      await pause(50);
    }
    throw new Error('Git Workbench settings did not mount');
  };
  const evaluate = code => settingsWindow.webContents.executeJavaScript(code);
  const measure = () => evaluate(`(() => {
    const root = document.querySelector('.gp-settings');
    return [...root.querySelectorAll('.gp-settings-heading')].map(heading => {
      const description = heading.nextElementSibling, row = description.nextElementSibling;
      const h = heading.getBoundingClientRect(), d = description.getBoundingClientRect(), r = row.getBoundingClientRect();
      return { title: heading.textContent, headingLeft: h.left, descriptionLeft: d.left, rowLeft: r.left,
        headingRight: h.right, descriptionRight: d.right, rowRight: r.right, icon: !!heading.querySelector('svg') };
    });
  })()`);
  const screenshot = async name => {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await pause(100);
    await writeFile(join(root, '.qa', name), (await settingsWindow.webContents.capturePage()).toPNG());
  };
  await openSettings(); settingsWindow.show(); settingsWindow.focus();
  for (const width of [1000, 700]) {
    settingsWindow.setSize(width, 900); await pause(250);
    for (const theme of ['light', 'dark']) {
      await evaluate(`document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add('theme-${theme}')`);
      const measurements = await measure();
      console.log('Settings alignment', { width, theme, measurements });
      check(measurements.length === 2 && measurements.every(row => row.icon &&
        Math.abs(row.headingLeft - row.descriptionLeft) < 1 && Math.abs(row.headingLeft - row.rowLeft) < 1 &&
        Math.abs(row.headingRight - row.descriptionRight) < 1 && Math.abs(row.headingRight - row.rowRight) < 1),
      `settings headings, descriptions and rows align at ${width}px in ${theme} theme`);
      check(await evaluate(`(() => {
        const root = document.querySelector('.gp-settings'), prompt = root.querySelector('.gp-ai-prompt textarea');
        const row = prompt.closest('.setting-item').getBoundingClientRect(), field = prompt.getBoundingClientRect();
        return field.left >= row.left - 1 && field.right <= row.right + 1 && root.scrollWidth <= root.clientWidth + 1;
      })()`), `settings and prompt fit without horizontal overflow at ${width}px in ${theme} theme`);
      await evaluate("document.querySelector('.gp-settings-heading').scrollIntoView({block:'start'})");
      await screenshot(`git-workbench-settings-zh-${width}-${theme}.png`);
    }
  }
  check(await evaluate(`(() => {
    const root = document.querySelector('.gp-settings');
    const key = [...root.querySelectorAll('.setting-item')].find(row => row.querySelector('.setting-item-name')?.textContent === 'API Key');
    return key.querySelector('.setting-item-description').textContent.includes('点击生成时') &&
      !/data\\.json|SecretStorage|git-commit-message/.test(root.textContent);
  })()`), 'settings show the send notice below API Key without implementation details');
  await js(`(async () => {
    app.setting.close(); const plugin = app.plugins.plugins['git-workbench'];
    plugin.settings.language = 'en'; await plugin.persistSettings();
    await app.plugins.disablePlugin('git-workbench'); await app.plugins.enablePlugin('git-workbench');
  })()`);
  await openSettings(); settingsWindow.setSize(1000, 900); settingsWindow.show(); settingsWindow.focus(); await pause(250);
  check(await evaluate(`(() => {
    const root = document.querySelector('.gp-settings');
    return root.textContent.includes('Set the language, format, and content') &&
      root.textContent.includes('only when you click Generate') && !/data\\.json|SecretStorage|git-commit-message/.test(root.textContent);
  })()`), 'English settings use the same concise descriptions and API Key notice');
  const english = await measure();
  check(english.every(row => Math.abs(row.headingLeft - row.descriptionLeft) < 1 && Math.abs(row.headingLeft - row.rowLeft) < 1), 'English settings retain section alignment');
  await evaluate("document.querySelector('.gp-settings-heading').scrollIntoView({block:'start'})");
  await screenshot('git-workbench-settings-en.png');
};
