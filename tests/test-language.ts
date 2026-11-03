import { initializeLanguage } from '../src/i18n';

// Existing regression expectations are Chinese, independently of the host locale.
initializeLanguage('zh-CN', 'en');
