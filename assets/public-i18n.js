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

const publicMenu = document.querySelector('.site-menu:not(.portal-menu)');
if (publicMenu) {
  const toggle = publicMenu.querySelector('summary');
  publicMenu.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !publicMenu.open) return;
    event.preventDefault();
    publicMenu.open = false;
    toggle.focus();
  });
  publicMenu.addEventListener('click', event => {
    if (event.target.closest('nav a')) publicMenu.open = false;
  });
  document.addEventListener('click', event => {
    if (!publicMenu.contains(event.target)) publicMenu.open = false;
  });
  const updateCurrentPage = () => {
    const path = location.pathname.replace(/index\.html$/, '');
    for (const link of publicMenu.querySelectorAll('nav a')) {
      const target = new URL(link.href);
      const current = target.pathname.replace(/index\.html$/, '') === path &&
        (!target.hash || target.hash === location.hash);
      if (current) link.setAttribute('aria-current',target.hash ? 'location' : 'page');
      else link.removeAttribute('aria-current');
    }
  };
  updateCurrentPage();
  window.addEventListener('hashchange',updateCurrentPage);
}
