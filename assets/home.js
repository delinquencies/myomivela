import { t } from './i18n.js';

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
if (stickyHeader) {
  const booking = stickyHeader.querySelector('.header-booking');
  const shape = stickyHeader.querySelector('.wordmark-shape');
  const path = shape.querySelector('path');
  const particles = [...stickyHeader.querySelectorAll('.wordmark-burst > span')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const dot = [12,8,14.2,8,16,9.8,16,12,16,14.2,14.2,16,12,16,9.8,16,8,14.2,8,12,8,9.8,9.8,8,12,8];
  const heart = [12,6.4,15.6,1.6,22,3.4,22,8.6,22,13.4,15,18,12,21,9,18,2,13.4,2,8.6,2,3.4,8.4,1.6,12,6.4];
  let mark = dot;
  let scrolled = false;
  let bookingAnimation;
  let markAnimation;
  let morphFrame;
  let scrollFrame;

  function drawMark(points) {
    mark = points;
    path.setAttribute('d', 'M ' + points.slice(0, 2).join(' ') + ' C ' + points.slice(2).join(' ') + ' Z');
  }

  function animateMark(target) {
    const start = mark;
    const started = performance.now();
    function step(now) {
      const progress = Math.min(1, (now - started) / 320);
      const eased = 1 - (1 - progress) ** 3;
      drawMark(start.map((value, i) => value + (target[i] - value) * eased));
      if (progress < 1) morphFrame = requestAnimationFrame(step);
    }
    morphFrame = requestAnimationFrame(step);
    markAnimation = shape.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.55)', offset: .44 }, { transform: 'scale(1)' }],
      { duration: 430, easing: 'ease-in-out' },
    );
    if (scrolled) {
      const offsets = [[-14,-14],[0,-24],[15,-18],[23,0]];
      particles.forEach((particle, i) => {
        const [x,y] = offsets[i];
        particle.animate([
          { opacity: 0, transform: 'translate(-50%, -50%) scale(.5)' },
          { opacity: 1, offset: .26 },
          { opacity: 0, transform: 'translate(calc(-50% + '+x+'px), calc(-50% + '+y+'px)) scale(1)' },
        ], { duration: 510, delay: 145 + i * 22, easing: 'ease-out' });
      });
    }
  }

  function updateHeader(animate = true) {
    scrollFrame = undefined;
    const next = window.scrollY > 0;
    if (next === scrolled) return;
    const moving = animate && !reducedMotion.matches && typeof booking.animate === 'function';
    const from = moving ? booking.getBoundingClientRect() : null;
    bookingAnimation?.cancel();
    markAnimation?.cancel();
    cancelAnimationFrame(morphFrame);
    scrolled = next;
    stickyHeader.classList.toggle('is-scrolled', scrolled);
    if (!moving) {
      drawMark(scrolled ? heart : dot);
      return;
    }
    const to = booking.getBoundingClientRect();
    bookingAnimation = booking.animate([
      { transform: 'translate('+(from.left-to.left)+'px, '+(from.top-to.top)+'px)', width: from.width+'px', height: from.height+'px' },
      { transform: 'translate(0, 0)', width: to.width+'px', height: to.height+'px' },
    ], { duration: 950, easing: 'cubic-bezier(.3,.15,.25,1)' });
    animateMark(scrolled ? heart : dot);
  }

  window.addEventListener('scroll', () => {
    if (scrollFrame === undefined) scrollFrame = requestAnimationFrame(() => updateHeader());
  }, { passive: true });
  window.addEventListener('pageshow', () => updateHeader(false));
  updateHeader(false);
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
    if (index < 0) return;
    showCard(index);
    rail.scrollIntoView({block:'start',behavior:reducedMotion.matches ? 'instant' : 'smooth'});
  }

  rail.classList.add('is-deck');
  controls.hidden = false;
  showCard(0);
  if (linkServices) {
    followServiceLink();
    window.addEventListener('hashchange', followServiceLink);
    document.querySelector('.service-pills')?.addEventListener('click', event => {
      const hash = event.target.closest('a[href^="#"]')?.getAttribute('href');
      if (!hash || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (location.hash !== hash) history.pushState(null,'',hash);
      followServiceLink();
      rail.focus({preventScroll:true});
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
const reviewGalleryLink = document.querySelector('[data-google-reviews]');
if (reviewGalleryLink) {
  import('./review-links.js').then(({googleReviewLinks}) => {
    if (!googleReviewLinks.read) return;
    reviewGalleryLink.href = googleReviewLinks.read;
    reviewGalleryLink.removeAttribute('aria-disabled');
  });
}
const priceTags = document.querySelectorAll('[data-service-price]');
if (priceTags.length) {
  fetch('/api/catalog').then(response => response.ok ? response.json() : []).then(rows => {
    if (!Array.isArray(rows) || !rows.length) return;
    const showPrices = () => {
      const spanish = document.documentElement.lang === 'es';
      for (const tag of priceTags) {
        const rates = rows.filter(row => row.name === tag.dataset.servicePrice).sort((a,b) => a.cents-b.cents);
        if (!rates.length) continue;
        const {cents,minutes} = rates[0];
        const price = new Intl.NumberFormat(spanish ? 'es-US' : 'en-US',{
          style:'currency',currency:'USD',minimumFractionDigits:cents % 100 ? 2 : 0,
        }).format(cents/100);
        tag.textContent = rates.length > 1 ? t('From {price}', {price}) : t('{price} / {minutes} min', {price, minutes});
        tag.hidden = false;
      }
    };
    showPrices();
    new MutationObserver(showPrices).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  }).catch(() => { /* Service links are available when the catalog is offline. */ });
}
