const translations = [
  { selector: '[data-es]', attribute: null, key: 'es' },
  { selector: '[data-es-label]', attribute: 'aria-label', key: 'esLabel' },
  { selector: '[data-es-alt]', attribute: 'alt', key: 'esAlt' },
].flatMap(({ selector, attribute, key }) =>
  Array.from(document.querySelectorAll(selector), (element) => ({
    element,
    attribute,
    en: attribute ? element.getAttribute(attribute) : element.textContent,
    es: element.dataset[key],
  })),
);

const languageButtons = document.querySelectorAll('[data-language]');
const englishTitle = document.title;
const spanishTitle = document.body.dataset.esTitle || 'myo. | Cuidado de mascotas y paseos de perros en Massachusetts';

function setLanguage(language) {
  document.documentElement.lang = language;
  document.title = language === 'es' ? spanishTitle : englishTitle;
  for (const { element, attribute, en, es } of translations) {
    const value = language === 'es' ? es : en;
    if (attribute) {
      element.setAttribute(attribute, value);
    } else {
      element.textContent = value;
    }
  }
  for (const button of languageButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.language === language));
  }
}

for (const button of languageButtons) {
  button.addEventListener('click', () => {
    const language = button.dataset.language;
    setLanguage(language);
    try {
      localStorage.setItem('myo-language', language);
    } catch {
      // Language switching still works when storage is blocked.
    }
  });
}

try {
  if (localStorage.getItem('myo-language') === 'es') setLanguage('es');
} catch {
  // English is already present in the HTML.
}

const siteMenu = document.querySelector('.site-menu');
if (siteMenu) {
  const menuToggle = siteMenu.querySelector('summary');

  siteMenu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !siteMenu.open) return;
    event.preventDefault();
    siteMenu.open = false;
    menuToggle.focus();
  });

  siteMenu.addEventListener('click', (event) => {
    if (event.target.closest('nav a')) siteMenu.open = false;
  });

  document.addEventListener('click', (event) => {
    if (siteMenu.open && !siteMenu.contains(event.target)) siteMenu.open = false;
  });
}

const portrait = document.querySelector('.portrait-wrap');
if (portrait && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(([entry]) => {
    portrait.classList.toggle('is-celebrating', entry.intersectionRatio >= .4);
  }, { threshold: .4 });
  observer.observe(portrait);
}

const stickyHeader = document.querySelector('.site-header--sticky');
const intro = document.querySelector('.hero, .faq-intro');
if (stickyHeader && intro) {
  let pending = false;
  function updateHeader() {
    pending = false;
    stickyHeader.classList.toggle('is-past-intro', intro.getBoundingClientRect().bottom <= stickyHeader.getBoundingClientRect().bottom);
  }
  function scheduleHeaderUpdate() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(updateHeader);
  }
  window.addEventListener('scroll', scheduleHeaderUpdate, { passive: true });
  window.addEventListener('resize', scheduleHeaderUpdate);
  window.addEventListener('pageshow', scheduleHeaderUpdate);
  if ('ResizeObserver' in window) new ResizeObserver(scheduleHeaderUpdate).observe(intro);
  updateHeader();
}

function setupDeck(rail, controls, cardSelector, { linkServices = false, status = null } = {}) {
  const cards = [...rail.querySelectorAll(cardSelector)];
  if (cards.length < 2) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let moving = false;
  let gesture = null;

  function showCard(index) {
    current = index;
    if (status) status.textContent = (current + 1) + ' / ' + cards.length;
    cards.forEach((card, position) => {
      const depth = (position - current + cards.length) % cards.length;
      card.dataset.depth = depth;
      card.inert = depth !== 0;
    });
  }

  async function move(direction) {
    if (moving) return;
    moving = true;
    const card = cards[current];
    if (card.contains(document.activeElement)) rail.focus({ preventScroll: true });
    if (!reducedMotion.matches && typeof card.animate === 'function') {
      const animation = card.animate([
        { transform: getComputedStyle(card).transform, opacity: 1 },
        { transform: 'translateX(' + (-direction * 115) + '%) rotate(' + (-direction * 17) + 'deg)', opacity: 0 },
      ], { duration: 240, easing: 'ease-in', fill: 'forwards' });
      try { await animation.finished; } catch { /* Still restore the deck after interruption. */ }
      animation.cancel();
    }
    card.style.removeProperty('--swipe');
    if (card === cards[current]) showCard((current + direction + cards.length) % cards.length);
    moving = false;
  }

  function followServiceLink() {
    const index = cards.findIndex(card => '#' + card.id === location.hash);
    if (index >= 0) showCard(index);
  }

  rail.classList.add('is-deck');
  controls.hidden = false;
  showCard(0);
  if (linkServices) {
    followServiceLink();
    window.addEventListener('hashchange', followServiceLink);
    document.addEventListener('click', event => {
      const hash = event.target.closest('a[href^="#"]')?.getAttribute('href');
      if (hash && hash === location.hash) followServiceLink();
    });
  }

  controls.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button) move(Number(button.dataset.deckStep));
  });
  rail.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    move(event.key === 'ArrowRight' ? 1 : -1);
  });
  rail.addEventListener('dragstart', event => event.preventDefault());
  rail.addEventListener('pointerdown', event => {
    if (moving || !event.isPrimary || event.button !== 0 || event.target.closest('a, button')) return;
    if (!cards[current].contains(event.target)) return;
    gesture = { id:event.pointerId, x:event.clientX, y:event.clientY, dx:0 };
    rail.setPointerCapture(event.pointerId);
  });
  rail.addEventListener('pointermove', event => {
    if (gesture?.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    if (Math.abs(dx) < Math.abs(event.clientY - gesture.y) && !gesture.dx) return;
    gesture.dx = dx;
    if (!reducedMotion.matches) cards[current].style.setProperty('--swipe', dx + 'px');
  });
  function finishGesture(event) {
    if (gesture?.id !== event.pointerId) return;
    const dx = gesture.dx;
    gesture = null;
    if (event.type === 'pointerup' && Math.abs(dx) >= 45) move(dx < 0 ? 1 : -1);
    else cards[current].style.removeProperty('--swipe');
  }
  rail.addEventListener('pointerup', finishGesture);
  rail.addEventListener('pointercancel', finishGesture);
  rail.addEventListener('lostpointercapture', finishGesture);
}

const serviceRail = document.querySelector('.service-rail');
const serviceControls = document.querySelector('.service-controls');
if (serviceRail && serviceControls) setupDeck(serviceRail, serviceControls, '.service', { linkServices: true });

const reviewRail = document.querySelector('.review-rail');
const reviewControls = document.querySelector('.review-controls');
if (reviewRail && reviewControls) {
  setupDeck(reviewRail, reviewControls, '.review-card', { status: document.querySelector('[data-review-status]') });
}
