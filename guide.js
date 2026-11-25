import { LANGUAGE_KEY, english, getLanguage, setLanguage, t } from './i18n.js';

const language = document.getElementById('guideLanguage');
const copy = document.getElementById('copyMcp');
const status = document.getElementById('copyMcpStatus');
const primary = document.getElementById('primaryMcp');
const original = [...document.querySelectorAll('[data-en]')].map(el => [el, el.textContent]);
const labels = [...document.querySelectorAll('[data-en-label]')].map(el => [el, el.getAttribute('aria-label')]);

try {
  setLanguage(localStorage.getItem(LANGUAGE_KEY));
  const theme = localStorage.getItem('cal:theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch { /* preferences are optional */ }

function render() {
  document.documentElement.lang = getLanguage();
  document.title = t('使用指南 · 摸鱼日历', 'Guide · Moyu Calendar');
  for (const [el, zh] of original) el.textContent = t(zh, el.dataset.en);
  for (const [el, zh] of labels) el.setAttribute('aria-label', t(zh, el.dataset.enLabel));
  language.textContent = t('English', '简体中文');
  language.lang = t('en', 'zh-CN');
  status.textContent = '';
}
render();
language.hidden = false;
language.addEventListener('click', () => {
  setLanguage(english() ? 'zh-CN' : 'en');
  try { localStorage.setItem(LANGUAGE_KEY, getLanguage()); } catch { /* optional preference */ }
  render();
});

if (navigator.clipboard?.writeText) {
  copy.hidden = false;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(primary.textContent.trim());
      status.textContent = t('已复制地址', 'URL copied');
    } catch {
      status.textContent = t('复制失败，请手动选中上方地址复制。', 'Copy failed. Select the URL above to copy it manually.');
    }
  });
}
