import './public-i18n.js';
import {policyParameters} from './policy-copy.js';
import { calculateEstimate, myoConfig } from './myo-config.js';
import { locale as selectedLanguage, setLocale, t } from './i18n.js';

const { business, booking, rates, flags } = myoConfig;
const byId = id => document.getElementById(id);
const services = ['walk', 'dropIn', 'overnight'];
const petKinds = ['dog', 'cat', 'exotic'];
let language = 'en';
let submittedEstimate = false;

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function field(parent, key, type, options = [], value = '') {
  const wrapper = element('div');
  wrapper.className = 'launch-field';
  wrapper.dataset.field = key;
  const control = element(type === 'select' || type === 'textarea' ? type : 'input');
  control.id = parent.id + '-' + key;
  control.name = key;
  if (control.tagName === 'INPUT') control.type = type;
  if (type === 'number') {
    control.min = '0';
    control.step = key === 'spendingLimit' ? '0.01' : '1';
  }
  for (const [optionValue, copy] of options) {
    const option = element('option');
    option.value = optionValue;
    option.dataset.copy = copy;
    control.append(option);
  }
  const label = element('label');
  label.htmlFor = control.id;
  const caption = element('span');
  caption.dataset.copy = key;
  const error = element('span');
  error.id = control.id + '-error';
  error.className = 'field-error';
  error.hidden = true;
  control.setAttribute('aria-describedby', error.id);
  if (type === 'checkbox') {
    wrapper.classList.add('launch-checkbox');
    label.append(control, caption);
    wrapper.append(label, error);
  } else {
    label.append(caption);
    wrapper.append(label, control, error);
    control.value = value;
  }
  parent.append(wrapper);
  return control;
}

const estimateForm = byId('estimate-form');
const estimateFields = byId('estimate-fields');


const options = keys => keys.map(key => [key, key]);
field(estimateFields, 'service', 'select', options(services), 'walk');
field(estimateFields, 'date', 'date').required = true;
field(estimateFields, 'duration', 'select', [[rates.visitMinutes, 'minutes'], [rates.longVisitMinutes, 'minutes']], rates.visitMinutes);
const nightsControl = field(estimateFields, 'nights', 'number', [], '1');
nightsControl.min = '1';
nightsControl.max = '366';
field(estimateFields, 'primary', 'select', options(petKinds), 'dog');
for (const key of ['extraDogCount', 'extraCatCount', 'extraExoticCount']) {
  field(estimateFields, key, 'number', [], '0').max = '30';
}
field(estimateFields, 'puppyLabel', 'checkbox');

function locale() {
  return language === 'es' ? 'es-US' : 'en-US';
}
function money(dollars, cents = false) {
  return new Intl.NumberFormat(locale(), {
    style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0,
  }).format(dollars);
}
function copy(key, values = {}) {
  return t('launch.' + key, values, language);
}

const policyValues = () => policyParameters(language);

function renderRates() {
  const open = new Set([...byId('rate-cards').querySelectorAll('details[open]')].map(card => card.dataset.service));
  const cards = services.map(service => {
    const card = element('details');
    card.dataset.service = service;card.open = open.has(service);
    const summary = element('summary');
    const title = element('span');title.className = 'rate-summary-title';
    const icon = element('span',{walk:'🐾',dropIn:'🏡',overnight:'🌙'}[service]);icon.setAttribute('aria-hidden','true');
    title.append(icon,element('strong',copy(service)));
    const price = element('span',service === 'overnight' ? t('From {price} per night',{price:money(rates.overnight)}) : t('From {price} / {minutes} min',{price:money(rates.visit),minutes:rates.visitMinutes}));
    price.className = 'rate-summary-price';summary.append(title,price);
    const body = element('div');body.className = 'rate-details';
    if (service === 'overnight') {
      body.append(element('p', copy('overnightRate', {
        regular: money(rates.overnight), peak: money(rates.overnight + rates.overnightPeakSurcharge),
      })), element('p', copy('overnightAddons', {
        nightDog: money(flags.overnightAdditionalPetRates.dog), nightCat: money(flags.overnightAdditionalPetRates.cat),
      })));
    } else {
      body.append(element('p', copy('visitRate', {
        minutes: rates.visitMinutes, regular: money(rates.visit), peak: money(rates.peakVisit),
      })), element('p', copy('longVisitRate', {
        minutes: rates.longVisitMinutes, regular: money(rates.visit + rates.extension), peak: money(rates.peakVisit + rates.extension),
      })), element('p', copy(service === 'walk' ? 'walkAddons' : 'addons', {
        extraDog: money(rates.additionalDog), extraCat: money(rates.additionalCat), puppyAge: booking.puppyAgeYears,
        puppy: money(rates.puppy), peakPuppy: money(flags.peakPuppyRate),
      })));
      if (service === 'dropIn') body.append(element('p', flags.smallExoticPetRate.requiresCustomQuote ? copy('estimateCustom') : copy('exoticRate', {
        exoticBase: money(flags.smallExoticPetRate.base), exoticExtra: money(flags.smallExoticPetRate.additional),
      })));
    }
    const choose = element('a',t('Choose this service'));choose.className = 'button button-small';
    choose.href = '../../portal/index.html?service='+{walk:'dog-walking',dropIn:'drop-in',overnight:'pet-sitting'}[service]+'#book';
    body.append(choose);card.append(summary,body);
    return card;
  });
  byId('rate-cards').replaceChildren(...cards);
  byId('excluded-services').replaceChildren(...myoConfig.excluded.map(key => element('li', copy(key))));
}

function renderCalendar() {
  const dates = new Intl.DateTimeFormat(locale(),{dateStyle:'medium',timeZone:'UTC'});
  byId('peak-dates').replaceChildren(...myoConfig.peakPeriods.map(([key,start,end]) => {
    const row = element('li');
    const range = element('span',dates.formatRange(new Date(start+'T12:00:00Z'),new Date(end+'T12:00:00Z')));
    row.append(element('strong',copy(key)),range);
    return row;
  }));
}
function setVisibility(fields, key, show, required = false) {
  const wrapper = fields.querySelector('[data-field="' + key + '"]');
  const control = wrapper.querySelector('input,textarea,select');
  wrapper.hidden = !show;
  control.disabled = !show;
  control.required = show && required;
}

function updateEstimateFields() {
  const {service, primary} = estimateForm.elements;
  const overnight = service.value === 'overnight';
  const walk = service.value === 'walk';
  for (const option of primary.options) option.disabled = walk && option.value !== 'dog';
  if (walk) primary.value = 'dog';
  setVisibility(estimateFields, 'duration', !overnight);
  setVisibility(estimateFields, 'nights', overnight, true);
  setVisibility(estimateFields, 'extraCatCount', !walk);
  setVisibility(estimateFields, 'extraExoticCount', !walk);
  setVisibility(estimateFields, 'puppyLabel', !overnight && primary.value === 'dog');
}

function renderEstimate(focus = false) {
  if (!submittedEstimate) return;
  const result = byId('estimate-result');
  const form = estimateForm.elements;
  const {service, date, primary, duration, nights, puppyLabel} = form;
  const counts = [form.extraDogCount, form.extraCatCount, form.extraExoticCount];
  const controls = [date, nights, ...counts];
  const invalid = controls.find(control => !control.disabled && !control.validity.valid);
  const today = new Intl.DateTimeFormat('sv-SE', {timeZone: business.timeZone, dateStyle: 'short'}).format();
  const leadDays = (Date.parse(date.value) - Date.parse(today)) / 86_400_000;
  const lastMinute = leadDays < (service.value === 'overnight' ? booking.overnightNoticeDays : booking.visitNoticeDays);
  result.replaceChildren();
  for (const control of controls) {
    const message = !control.disabled && (!control.validity.valid || (control === date && leadDays < 0)) ? copy(control === date && leadDays < 0 ? 'estimatePast' : 'estimateInvalid') : '';
    const error = byId(control.id + '-error');
    error.textContent = message;
    error.hidden = !message;
    if (message) control.setAttribute('aria-invalid','true');
    else control.removeAttribute('aria-invalid');
  }
  if (invalid || leadDays < 0) {
    result.append(element('p', copy(leadDays < 0 ? 'estimatePast' : 'estimateInvalid')));
    if (focus) (invalid ?? date).focus();
    return;
  }

  const pets = [{kind: primary.value, ageYears: !puppyLabel.disabled && puppyLabel.checked ? 0 : undefined}];
  counts.forEach((control, index) => {
    if (!control.disabled) for (let i = 0; i < Number(control.value); i++) pets.push({kind: petKinds[index]});
  });
  const estimate = calculateEstimate({
    service: service.value, date: date.value, pets, duration: Number(duration.value),
    nights: Number(nights.value), lastMinute,
  });
  if (estimate.requiresCustomQuote) {
    result.append(element('p', copy('estimateCustom')));
    return;
  }
  const lineLabels = {
    base: 'estimateBase', peakNights: 'estimatePeakNights', extension: 'estimateExtension',
    extraPets: 'estimateExtraPets', lastMinute: 'estimateLastMinute',
  };
  const lines = estimate.lines.map(({code, cents}) => [lineLabels[code], cents]);
  lines.push(['estimateTotal', estimate.totalCents], ['estimateDeposit', estimate.depositCents], ['estimateBalance', estimate.balanceCents]);
  const list = element('dl');
  for (const [key, cents] of lines) {
    const row = element('div');
    row.className = 'launch-result-line' + (key === 'estimateTotal' ? ' launch-result-total' : '');
    row.append(element('dt', copy(key, policyValues())), element('dd', money(cents / 100, true)));
    list.append(row);
  }
  result.append(list);
  if (lastMinute) result.append(element('p', copy('estimateShortNotice')));
}

function setLanguage(next) {
  language = next;
  setLocale(next);
  document.title = t('Services & rates | myo.');
  const values = policyValues();
  for (const node of document.querySelectorAll('[data-copy]')) {
    node.textContent = copy(node.dataset.copy, {...values, minutes: node.value});
  }
  for (const node of document.querySelectorAll('[data-label]')) node.setAttribute('aria-label', copy(node.dataset.label));
  for (const button of document.querySelectorAll('[data-language]')) {
    button.setAttribute('aria-pressed', String(button.dataset.language === language));
  }
  renderRates();
  renderCalendar();
  renderEstimate();

}

estimateForm.addEventListener('change', () => {
  updateEstimateFields();
  renderEstimate();
});
estimateForm.addEventListener('submit', event => {
  event.preventDefault();
  submittedEstimate = true;
  renderEstimate(true);
});
const dialog = byId('estimate-dialog');
const openEstimate = document.querySelector('[data-open-estimate]');
openEstimate.addEventListener('click', () => {dialog.showModal();byId('estimate-title').focus();});
document.querySelector('[data-close-estimate]').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => openEstimate.focus({preventScroll:true}));
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const box = dialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
});
window.addEventListener('myo:languagechange', () => setLanguage(selectedLanguage()));
// Keep previously shared fragments useful after moving policies and retiring the preview intake.
if (location.hash === '#policies') location.replace('../safety_first_faq/index.html#policies');
if (location.hash === '#intake') location.replace('../../portal/index.html#care');
const revealPeak = () => {if (location.hash === '#peak') document.querySelector('.peak-calendar').open = true;};
revealPeak();
window.addEventListener('hashchange',revealPeak);
updateEstimateFields();
setLanguage(selectedLanguage());
