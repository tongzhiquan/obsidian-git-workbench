import { addIcon } from 'obsidian';

export const GIT_WORKBENCH_ICON = 'git-workbench-logo';
export function registerGitWorkbenchIcon(): void {
  addIcon(GIT_WORKBENCH_ICON, '<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><circle cx="25" cy="18" r="10"/><circle cx="25" cy="82" r="10"/><circle cx="74" cy="18" r="10"/><path d="M25 28v44M74 28v8c0 16-17 18-49 18M72 58v28M58 72h28"/></g>');
}
