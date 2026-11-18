import { locale, setLocale, t } from './i18n.js';

export function translatePage(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const attribute of ['aria-label', 'alt', 'placeholder', 'title', 'content']) {
    for (const node of root.querySelectorAll('[data-i18n-' + attribute + ']')) {
      node.setAttribute(attribute, t(node.getAttribute('data-i18n-' + attribute)));
    }
  }
  for (const button of root.querySelectorAll('[data-language]')) {
    button.setAttribute('aria-pressed', String(button.dataset.language === locale()));
  }
}
export function initializeLanguage(onChange = () => {}) {
  setLocale(locale());
  translatePage();
  for (const button of document.querySelectorAll('[data-language]')) {
    button.addEventListener('click', () => {
      if (button.dataset.language === locale()) return;
      setLocale(button.dataset.language);
      translatePage();
      onChange();
      window.dispatchEvent(new Event('myo:languagechange'));
    });
  }
}
initializeLanguage();
