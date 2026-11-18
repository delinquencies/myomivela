import { calculateEstimate, myoConfig } from './myo-config.js';
import { locale as selectedLanguage, setLocale, t } from './i18n.js';

const { business, booking, rates, flags } = myoConfig;
const byId = id => document.getElementById(id);
const services = ['walk', 'dropIn', 'overnight'];
const petKinds = ['dog', 'cat', 'exotic'];
let language = 'en';
let submittedEstimate = false;
let submittedIntake = false;

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
  if (parent.id === 'intake-fields') {
    const hint = element('small');
    hint.id = control.id + '-hint';
    hint.dataset.copy = key + 'Hint';
    control.setAttribute('aria-describedby', hint.id + ' ' + error.id);
    wrapper.append(hint);
  }
  parent.append(wrapper);
  return control;
}

const estimateForm = byId('estimate-form');
const estimateFields = byId('estimate-fields');
const intakeForm = byId('intake-form');
const intakeFields = byId('intake-fields');
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

field(intakeFields, 'service', 'select', [['', 'selectOne'], ...options(services)]).required = true;
for (const [key, type] of myoConfig.intakeFields) {
  const choices = type === 'select' ? [['', 'selectOne'], ...options(['yes', 'no'])] : [];
  field(intakeFields, key, type, choices).required = true;
}
for (const key of ['overnightAlone', 'overnightBehavior']) field(intakeFields, key, 'textarea');
field(intakeFields, 'overnightAcknowledgment', 'checkbox');

const policyList = byId('policy-list');
for (const key of myoConfig.policyKeys) {
  const details = element('details');
  const summary = element('summary');
  const body = element('p');
  summary.dataset.copy = key === 'peak' ? 'peakTitlePolicy' : key + 'Title';
  body.dataset.copy = key + 'Body';
  details.append(summary, body);
  policyList.append(details);
}

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

function policyValues() {
  const percent = ratio => new Intl.NumberFormat(locale(), { style: 'percent' }).format(ratio);
  const hour = time => new Intl.DateTimeFormat(locale(), {
    timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: language === 'en',
  }).format(new Date('2000-01-01T' + time + ':00Z'));
  return {
    city: business.city, state: business.state, zip: business.zip, radius: business.radiusMiles,
    hours: hour(business.opens) + '–' + hour(business.closes), capacity: business.capacity,
    contact: business.contact, aloneMin: booking.aloneHoursMin, aloneMax: booking.aloneHoursMax,
    peakVisit: money(rates.peakVisit), visitMinutes: rates.visitMinutes,
    peakLong: money(rates.peakVisit + rates.extension), longMinutes: rates.longVisitMinutes,
    nightSurcharge: money(rates.overnightPeakSurcharge), peakNight: money(rates.overnight + rates.overnightPeakSurcharge),
    visitNotice: booking.visitNoticeDays, overnightNotice: booking.overnightNoticeDays,
    lastMinuteTerms: copy(flags.autoApplyLastMinuteFee ? 'lastMinuteFeeOn' : 'lastMinuteFeeOff', {lastMinute: money(rates.lastMinute)}),
    depositPercent: percent(booking.depositRatio), depositHours: booking.depositHours,
    meetPrice: money(booking.meetAndGreet), balancePercent: percent(1 - booking.depositRatio),
    cancelDays: booking.cancellationDays, retentionPercent: percent(flags.lateCancellationDepositRetentionRatio),
    retentionTotal: percent(flags.lateCancellationDepositRetentionRatio * booking.depositRatio),
    weightMin: booking.dogWeightMin, weightMax: booking.dogWeightMax, puppyAge: booking.puppyAgeYears,
  };
}

function renderRates() {
  const cards = services.map(service => {
    const card = element('article');
    card.className = 'launch-card';
    card.append(element('h3', copy(service)));
    if (service === 'overnight') {
      card.append(element('p', copy('overnightRate', {
        regular: money(rates.overnight), peak: money(rates.overnight + rates.overnightPeakSurcharge),
      })), element('p', copy('overnightAddons', {
        nightDog: money(flags.overnightAdditionalPetRates.dog), nightCat: money(flags.overnightAdditionalPetRates.cat),
      })));
    } else {
      card.append(element('p', copy('visitRate', {
        minutes: rates.visitMinutes, regular: money(rates.visit), peak: money(rates.peakVisit),
      })), element('p', copy('longVisitRate', {
        minutes: rates.longVisitMinutes, regular: money(rates.visit + rates.extension), peak: money(rates.peakVisit + rates.extension),
      })), element('p', copy(service === 'walk' ? 'walkAddons' : 'addons', {
        extraDog: money(rates.additionalDog), extraCat: money(rates.additionalCat), puppyAge: booking.puppyAgeYears,
        puppy: money(rates.puppy), peakPuppy: money(flags.peakPuppyRate),
      })));
      if (service === 'dropIn') card.append(element('p', flags.smallExoticPetRate.requiresCustomQuote ? copy('estimateCustom') : copy('exoticRate', {
        exoticBase: money(flags.smallExoticPetRate.base), exoticExtra: money(flags.smallExoticPetRate.additional),
      })));
    }
    return card;
  });
  byId('rate-cards').replaceChildren(...cards);
  byId('excluded-services').replaceChildren(...myoConfig.excluded.map(key => element('li', copy(key))));
}

function renderCalendar() {
  const dateFormat = new Intl.DateTimeFormat(locale(), {dateStyle: 'medium', timeZone: 'UTC'});
  byId('peak-dates').replaceChildren(...myoConfig.peakPeriods.map(([key, start, end]) => {
    const listItem = element('li');
    listItem.append(element('strong', copy(key)), element('br'));
    for (const date of [start, end]) {
      const time = element('time', dateFormat.format(new Date(date + 'T00:00:00Z')));
      time.dateTime = date;
      if (date === end) listItem.append(' – ');
      listItem.append(time);
    }
    return listItem;
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

function updateIntakeFields() {
  const overnight = intakeForm.elements.service.value === 'overnight';
  for (const key of ['overnightAlone', 'overnightBehavior', 'overnightAcknowledgment']) setVisibility(intakeFields, key, overnight, true);
}

function renderEstimate(focus = false) {
  if (!submittedEstimate) return;
  const result = byId('estimate-result');
  const form = estimateForm.elements;
  const {service, date, primary, duration, nights, puppyLabel} = form;
  const counts = [form.extraDogCount, form.extraCatCount, form.extraExoticCount];
  const invalid = [date, nights, ...counts].find(control => !control.disabled && !control.validity.valid);
  const today = new Intl.DateTimeFormat('sv-SE', {timeZone: business.timeZone, dateStyle: 'short'}).format();
  const leadDays = (Date.parse(date.value) - Date.parse(today)) / 86_400_000;
  const lastMinute = leadDays < (service.value === 'overnight' ? booking.overnightNoticeDays : booking.visitNoticeDays);
  result.replaceChildren();
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

function renderIntakeStatus(focus = false) {
  if (!submittedIntake) return;
  let firstInvalid;
  for (const control of intakeForm.querySelectorAll('input, select, textarea')) {
    const error = byId(control.id + '-error');
    const missing = control.required && (control.type === 'checkbox' ? !control.checked : !control.value.trim()) && !control.validity.badInput;
    const invalid = !control.disabled && (missing || !control.validity.valid);
    error.hidden = !invalid;
    if (invalid) {
      error.textContent = copy(missing ? 'required' : 'invalidNumber');
      control.setAttribute('aria-invalid', 'true');
      firstInvalid ??= control;
    } else {
      control.removeAttribute('aria-invalid');
    }
  }
  byId('intake-result').textContent = firstInvalid ? copy('intakeErrors') : copy('intakeDone');
  if (focus) firstInvalid?.focus();
}

function setLanguage(next) {
  language = next;
  setLocale(next);
  document.title = copy('title');
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
  renderIntakeStatus();
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
intakeForm.addEventListener('input', () => {
  updateIntakeFields();
  renderIntakeStatus();
});
intakeForm.addEventListener('submit', event => {
  event.preventDefault();
  submittedIntake = true;
  renderIntakeStatus(true);
});
for (const button of document.querySelectorAll('[data-language]')) {
  button.addEventListener('click', () => setLanguage(button.dataset.language));
}
updateEstimateFields();
updateIntakeFields();
setLanguage(selectedLanguage());
