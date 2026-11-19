// Codex-owned care form presentation. Rules and draft policy come from CUX-03.
import {intakeFields, intakeGroups, validateIntake} from './intake-model.js';
import {t, formatDate} from './i18n.js';
import {escapeHtml as text} from './diary.js';
import {myoConfig} from './myo-config.js';

const titles = ['Your pets and routines','Health details','Household emergency contacts'];
const shortTitles = ['Routines','Health','Contacts'];
const copy = key => t('launch.'+key,{aloneMin:myoConfig.booking.aloneHoursMin,aloneMax:myoConfig.booking.aloneHoursMax});
const definitions = new Map(intakeFields.map(field => [field.key,field]));
const draftNote = 'Routine notes stay in this tab. Save health and emergency details before reloading.';

export function intakeDefaults(data) {
  const pets = data.pets.map(pet => {
    try {return {pet,profile:JSON.parse(pet.details || '{}')};}
    catch {return {pet,profile:{notes:pet.details}};}
  });
  return Object.fromEntries(intakeFields.map(field => {
    const saved = data.intake?.[field.key];
    if (saved !== undefined && saved !== null && saved !== '') return [field.key,saved];
    const value = pets.map(({pet,profile}) => {
      const values = field.profileKeys.map(key => profile[key]).filter(Boolean);
      if (field.key === 'pets') values.unshift(pet.species);
      return values.length ? pet.name+' — '+values.join(' · ') : '';
    }).filter(Boolean).join('\n');
    return [field.key,value];
  }).concat([['service',data.intake?.service || '']]));
}

function fieldMarkup(field, saved) {
  const {key,type,draft,maxLength} = field;
  const id = 'care-intake-'+key;
  const attrs = ' name="'+key+'" data-draft-policy="'+draft+'" aria-required="true" aria-describedby="'+id+'-hint '+id+'-error"';
  const value = saved[key] ?? '';
  let control;
  if (type === 'select') {
    control = '<fieldset class="tap-choices"><legend>'+text(copy(key))+'</legend><div>'+
      ['yes','no'].map(answer => '<label><input type="radio"'+attrs+' value="'+answer+'"'+(value === answer ? ' checked' : '')+'><span>'+text(t(answer === 'yes' ? 'Authorize' : 'Do not authorize'))+'</span></label>').join('')+'</div></fieldset>';
  } else if (type === 'boolean') {
    control = '<label class="check-row"><input type="checkbox" id="'+id+'"'+attrs+(value === true ? ' checked' : '')+'>'+text(copy(key))+'</label>';
  } else {
    const input = type === 'number' ? '<input type="number" inputmode="decimal" min="0" max="1000000" step=".01" id="'+id+'"'+attrs+' value="'+text(value)+'">'
      : type === 'text' ? '<input id="'+id+'"'+attrs+' maxlength="'+maxLength+'" value="'+text(value)+'">'
      : '<textarea id="'+id+'"'+attrs+' maxlength="'+maxLength+'" rows="3">'+text(value)+'</textarea>';
    control = '<label for="'+id+'">'+text(copy(key))+'</label>'+input;
  }
  return '<div class="intake-field" data-intake-field="'+key+'"'+(field.required === 'overnight' ? ' data-care-overnight' : '')+'>'+control+
    '<small id="'+id+'-hint">'+text(copy(key+'Hint'))+'</small><p class="pet-field-error" id="'+id+'-error" data-intake-error hidden></p></div>';
}

export function intakeForm(data) {
  const saved = intakeDefaults(data);
  const services = ['walk','dropIn','overnight'].map(service => '<label><input type="radio" name="service" value="'+service+'" aria-required="true" aria-describedby="care-intake-service-error"'+
    (saved.service === service ? ' checked' : '')+'><span>'+text(copy(service))+'</span></label>').join('');
  return '<form data-care-action="intake" novalidate>'+
    '<p data-intake-intro>'+text(t('We’ve brought over saved pet details. Review each pet’s notes, then add your household contacts.'))+'</p>'+
    '<div data-intake-field="service"><fieldset class="tap-choices"><legend>'+text(copy('service'))+'</legend><div>'+services+'</div></fieldset><p id="care-intake-service-error" class="pet-field-error" data-intake-error hidden></p></div>'+
    '<div class="intake-service-summary" hidden><p data-intake-selected-service></p><button type="button" class="secondary" data-intake-go="0">'+text(t('Change service'))+'</button></div>'+
    '<ol class="intake-progress" aria-label="'+text(t('Care details progress'))+'">'+intakeGroups.map((group,index) => '<li><button type="button" class="secondary" data-intake-go="'+index+'"><span aria-hidden="true">'+(index+1)+'</span> '+text(t(shortTitles[index]))+' <small data-intake-complete="'+group.id+'"></small></button></li>').join('')+'</ol>'+
    '<p data-intake-step-count role="status"></p><p class="pet-field-error" data-intake-error-summary role="alert" hidden></p>'+
    intakeGroups.map((group,index) => '<fieldset class="intake-step" data-intake-step="'+index+'"'+(index ? ' hidden' : '')+'><legend tabindex="-1">'+text(t(titles[index]))+'</legend><div class="intake-fields">'+group.fields.map(key => fieldMarkup(definitions.get(key),saved)).join('')+'</div></fieldset>').join('')+
    '<p class="intake-draft-note">'+text(t(draftNote))+'</p><p data-intake-last-saved>'+ (data.intake ? text(t('Last saved'))+' '+text(formatDate(data.intake.updated)) : '')+'</p>'+
    '<p data-care-status role="status" aria-live="polite"></p><div class="intake-actions"><button type="button" class="secondary" data-intake-back>← '+text(t('Previous section'))+'</button><button type="submit" data-intake-save>🐾 '+text(t('Save and continue'))+'</button></div></form>';
}

function valuesFor(form) {
  const values = Object.fromEntries(new FormData(form));
  if (values.spendingLimit === '') delete values.spendingLimit;
  else if (values.spendingLimit !== undefined) values.spendingLimit = Number(values.spendingLimit);
  values.overnightAcknowledgment = values.overnightAcknowledgment === 'on';
  return values;
}

export function syncIntake(form, step = Number(form.dataset.draftStep || 0), focus = false) {
  step = Math.min(2,Math.max(0,step));
  form.dataset.draftStep = step;
  form.querySelector('[data-intake-intro]').hidden = step > 0;
  const overnight = form.elements.service.value === 'overnight';
  const service = form.querySelector('[data-intake-field="service"]');
  const summary = form.querySelector('.intake-service-summary');
  service.hidden = step > 0 && Boolean(form.elements.service.value);
  summary.hidden = !service.hidden;
  form.querySelector('[data-intake-selected-service]').textContent = copy(form.elements.service.value || 'service');
  for (const wrapper of form.querySelectorAll('[data-care-overnight]')) {
    wrapper.hidden = !overnight;
    if (!overnight) {
      wrapper.querySelector('[data-intake-error]').hidden = true;
      delete wrapper.dataset.errorCode;
      for (const control of wrapper.querySelectorAll('[aria-invalid]')) control.removeAttribute('aria-invalid');
    }
    for (const control of wrapper.querySelectorAll('input,textarea')) control.disabled = !overnight;
  }
  for (const panel of form.querySelectorAll('[data-intake-step]')) panel.hidden = Number(panel.dataset.intakeStep) !== step;
  for (const button of form.querySelectorAll('.intake-progress [data-intake-go]')) {
    if (Number(button.dataset.intakeGo) === step) button.setAttribute('aria-current','step');
    else button.removeAttribute('aria-current');
  }
  form.querySelector('[data-intake-step-count]').textContent = t('Care details: section {current} of {total}',{current:step+1,total:3});
  form.querySelector('[data-intake-back]').hidden = step === 0;
  form.querySelector('[data-intake-save]').textContent = '🐾 '+t(step === 2 ? 'Save care details' : 'Save and continue');
  if (!form.querySelector('[aria-invalid]')) form.querySelector('[data-intake-error-summary]').hidden = true;
  if (focus) form.querySelector('[data-intake-step="'+step+'"] legend').focus();
}

export function updateIntakeProgress(form, saved) {
  const current = valuesFor(form);
  const {missing,fieldErrors} = validateIntake({...saved,service:current.service});
  for (const group of intakeGroups) {
    const complete = Boolean(saved) && group.fields.every(key => !missing.includes(key) && !fieldErrors.some(error => error.field === key));
    const changed = group.fields.filter(key => definitions.get(key).required !== 'overnight' || current.service === 'overnight')
      .some(key => String(current[key] ?? '').trim() !== String(saved?.[key] ?? '').trim());
    form.querySelector('[data-intake-complete="'+group.id+'"]').textContent = complete ? (changed ? t('Unsaved') : '✓ '+t('Saved')) : t('To review');
  }
}

function clearErrors(form) {
  form.querySelector('[data-intake-error-summary]').hidden = true;
  for (const wrapper of form.querySelectorAll('[data-intake-field]')) {
    wrapper.querySelector('[data-intake-error]').hidden = true;
    delete wrapper.dataset.errorCode;
    for (const control of wrapper.querySelectorAll('[aria-invalid]')) control.removeAttribute('aria-invalid');
  }
}

export function showIntakeErrors(form, errors, focus = true) {
  clearErrors(form);
  for (const error of errors) {
    const wrapper = form.querySelector('[data-intake-field="'+CSS.escape(error.field)+'"]');
    if (!wrapper) continue;
    const key = 'intake.error.'+error.code;
    const note = wrapper.querySelector('[data-intake-error]');
    note.textContent = t(key,error.params || {});
    note.hidden = false;
    wrapper.dataset.errorCode = error.code;
    wrapper.dataset.errorParams = JSON.stringify(error.params || {});
    for (const control of wrapper.querySelectorAll('input,textarea')) control.setAttribute('aria-invalid','true');
  }
  const first = form.querySelector('[aria-invalid]');
  if (!first) return;
  const group = first.closest('[data-intake-step]');
  if (group) syncIntake(form,Number(group.dataset.intakeStep));
  const summary = form.querySelector('[data-intake-error-summary]');
  summary.textContent = t('Please check the highlighted answers. Your other details are still here.');
  summary.hidden = false;
  if (focus) first.focus();
}

export function intakeChanged(form, target, saved) {
  const wrapper = target.closest('[data-intake-field]');
  if (wrapper) {
    wrapper.querySelector('[data-intake-error]').hidden = true;
    delete wrapper.dataset.errorCode;
    for (const control of wrapper.querySelectorAll('[aria-invalid]')) control.removeAttribute('aria-invalid');
  }
  form.querySelector('[data-care-status]').textContent = t('Unsaved changes.');
  if (target.name === 'service') syncIntake(form);
  updateIntakeProgress(form,saved);
}

export async function saveIntake(form, context) {
  const step = Number(form.dataset.draftStep || 0);
  const keys = intakeGroups[step].fields;
  const values = valuesFor(form);
  const errors = validateIntake(values).fieldErrors.filter(error => error.field === 'service' || keys.includes(error.field));
  if (errors.length) {showIntakeErrors(form,errors);return;}
  clearErrors(form);
  const payload = {service:values.service,partial:true};
  for (const key of keys) if (values[key] !== undefined && !form.querySelector('[name="'+key+'"]').disabled) payload[key] = values[key];
  const controls = [...form.elements,...document.querySelectorAll('[data-language]')].map(control => [control,control.disabled]);
  const message = form.querySelector('[data-care-status]');
  const request = JSON.stringify(payload);
  if (form.dataset.requestBody !== request) form.dataset.requestKey = crypto.randomUUID();
  form.dataset.requestBody = request;
  form.setAttribute('aria-busy','true');
  controls.forEach(([control]) => {control.disabled = true;});
  message.textContent = t('Saving…');
  try {
    const result = await context.api('intake',payload,form.dataset.requestKey);
    delete form.dataset.requestBody;
    delete form.dataset.requestKey;
    context.data.intake = {...context.data.intake,...payload,complete:result.complete,updated:result.updated};
    delete context.data.intake.partial;
    for (const key of ['service',...keys]) for (const control of form.querySelectorAll('[name="'+key+'"]')) {
      if (['radio','checkbox'].includes(control.type)) control.defaultChecked = control.checked;
      else control.defaultValue = control.value;
    }
    controls.forEach(([control,disabled]) => {control.disabled = disabled;});
    const next = step < 2 ? step+1 : result.status.groups.findIndex(group => !group.complete);
    syncIntake(form,next < 0 ? step : next,true);
    updateIntakeProgress(form,context.data.intake);
    form.querySelector('[data-intake-last-saved]').textContent = t('Last saved')+' '+formatDate(result.updated);
    message.textContent = t(result.complete ? 'Your care details are saved.' : 'Section saved. You can come back to finish the rest.');
    context.drafts.capture(form.closest('#app'));
    if (result.complete) context.notify(t('Saved.'));
  } catch (error) {
    controls.forEach(([control,disabled]) => {control.disabled = disabled;});
    if (error.fieldErrors?.length) showIntakeErrors(form,error.fieldErrors);
    message.textContent = t('Your changes weren’t saved. Your answers are still here; try again.')+' '+error.message;
  } finally {
    controls.forEach(([control,disabled]) => {control.disabled = disabled;});
    form.setAttribute('aria-busy','false');
  }
}
