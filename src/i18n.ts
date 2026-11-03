import zhCN from './i18n/zh-CN';
import en from './i18n/en';

export type LanguageSetting = 'auto' | 'zh-CN' | 'en';
export type Locale = Exclude<LanguageSetting, 'auto'>;
export type TranslationKey = keyof typeof zhCN;
type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? (P extends `p${number}` ? P : never) | Placeholders<Rest> : never;
type Params<K extends TranslationKey> = [Placeholders<(typeof zhCN)[K]>] extends [never]
  ? [] : [params: Record<Placeholders<(typeof zhCN)[K]>, string | number>];
type EnglishMessages = { [K in TranslationKey]:
  [Placeholders<(typeof en)[K]>] extends [Placeholders<(typeof zhCN)[K]>]
    ? [Placeholders<(typeof zhCN)[K]>] extends [Placeholders<(typeof en)[K]>] ? (typeof en)[K] : never : never };
const checkedEnglish: EnglishMessages = en;
export const messages = { 'zh-CN': zhCN, en: checkedEnglish };

export function normalizeLanguageSetting(value: unknown): LanguageSetting {
  return value === 'zh-CN' || value === 'en' ? value : 'auto';
}

export function resolveLanguage(setting: unknown, appLanguage: string): Locale {
  const value = normalizeLanguageSetting(setting);
  if (value !== 'auto') return value;
  return /^zh(?:-|$)/i.test(appLanguage) ? 'zh-CN' : 'en';
}

export function createTranslator(locale: Locale) {
  return <K extends TranslationKey>(key: K, ...args: Params<K>): string => {
    const values = args[0] as Record<string, string | number> | undefined;
    return messages[locale][key].replace(/\{(p\d+)\}/g, (match, name: string) => String(values?.[name] ?? match));
  };
}

// The active language is selected once on load. Saving a preference does not change it.
let locale: Locale = 'zh-CN';
let translate = createTranslator(locale);
export function initializeLanguage(setting: unknown, appLanguage: string): void {
  locale = resolveLanguage(setting, appLanguage); translate = createTranslator(locale);
}
export function getLocale(): Locale { return locale; }
export function t<K extends TranslationKey>(key: K, ...args: Params<K>): string { return translate(key, ...args); }
export function formatDate(value: string | number): string { return new Date(value).toLocaleDateString(locale); }
export function formatDateTime(value: string | number): string { return new Date(value).toLocaleString(locale); }
export function formatNumber(value: number): string { return value.toLocaleString(locale); }
