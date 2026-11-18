import { t, translateLabel, formatDate, formatMoney, locale } from './i18n.js';
import { escapeHtml as text } from './diary.js';
import { myoConfig } from './myo-config.js';
import { policyText } from './policy-copy.js';

const copy = (key) =>
  t('launch.' + key, {
    aloneMin: myoConfig.booking.aloneHoursMin,
    aloneMax: myoConfig.booking.aloneHoursMax,
  });
const button = (label, attrs = '') => '<button type="submit" ' + attrs + '>' + text(t(label)) + '</button>';
const hidden = (name, value) => '<input type="hidden" name="' + name + '" value="' + text(value) + '">';
const status = '<p data-care-status role="status" aria-live="polite"></p>';
const form = (action, body, attrs = '') =>
  '<form data-care-action="' + action + '" ' + attrs + '>' + body + status + '</form>';
const field = (label, name, value = '', attrs = '') =>
  '<label>' +
  text(t(label)) +
  '<input name="' +
  name +
  '" value="' +
  text(value) +
  '" ' +
  attrs +
  '></label>';
const area = (label, name, value = '', attrs = '') =>
  '<label>' +
  text(t(label)) +
  '<textarea name="' +
  name +
  '" ' +
  attrs +
  '>' +
  text(value) +
  '</textarea></label>';
let context;
let revealTimers = [];
let entryGeneration = 0;
let clientSearchGeneration = 0;
let searchTimer;
export function stayCalendar(nights) {
  const available = new Set(nights.map((night) => night.date));
  const first = new Date((nights[0]?.date || new Date().toISOString().slice(0, 10)) + 'T12:00Z');
  const language = locale() === 'es' ? 'es-US' : 'en-US';
  const cards = [0, 1]
    .map((offset) => {
      const month = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + offset, 1, 12));
      const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
      const heading = new Intl.DateTimeFormat(language, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(month);
      const weekdays = Array.from(
        { length: 7 },
        (_, i) =>
          '<span>' +
          new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' }).format(
            Date.UTC(2026, 10, 1 + i, 12)
          ) +
          '</span>'
      ).join('');
      let grid =
        '<div class="stay-weekdays" aria-hidden="true">' +
        weekdays +
        '</div><div class="stay-day-grid">' +
        '<span aria-hidden="true"></span>'.repeat(month.getUTCDay());
      for (let day = 1; day <= days; day++) {
        const value = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day, 12));
        const key = value.toISOString().slice(0, 10);
        const previous = new Date(value.valueOf() - 86400000).toISOString().slice(0, 10);
        const enabled = available.has(key) || available.has(previous);
        grid +=
          '<button type="button" class="secondary" data-stay-date="' +
          key +
          '" aria-pressed="false" aria-label="' +
          text(new Intl.DateTimeFormat(language, { dateStyle: 'full', timeZone: 'UTC' }).format(value)) +
          '"' +
          (enabled ? '' : ' disabled') +
          '>' +
          day +
          '</button>';
      }
      return '<div><h4>' + text(heading) + '</h4>' + grid + '</div></div>';
    })
    .join('');
  return (
    '<p data-stay-calendar-status role="status">' +
    text(t('Choose an arrival date, then a departure date.')) +
    '</p><div class="stay-calendar-months">' +
    cards +
    '</div>'
  );
}
export function syncStayCalendar(form) {
  const start = form.elements.stay_start?.value,
    end = form.elements.stay_end?.value;
  for (const button of form.querySelectorAll('[data-stay-date]')) {
    const value = button.dataset.stayDate;
    button.setAttribute('aria-pressed', String(value === start || value === end));
    button.classList.toggle('is-stay-range', Boolean(start && end && value > start && value < end));
  }
}
const profileLabels = {
  name: 'Pet name',
  species: 'Species',
  breed: 'Breed',
  sex: 'Sex',
  age: 'Age or birthday',
  weight: 'Weight (lb)',
  health: 'Health conditions',
  medication: 'Medication and schedule',
  heartworm: 'Heartworm protection',
  allergies: 'Allergies and care instructions',
  vaccinations: 'Vaccinations',
  food: 'Food and type',
  portion: 'Portion size',
  feeding: 'Feeding schedule',
  restrictions: 'Food and treat restrictions',
  vet: 'Veterinary clinic',
  vetPhone: 'Vet phone number',
  contact: 'Emergency contact name',
  contactPhone: 'Emergency contact phone number',
  behavior: 'Temperament and triggers',
  notes: 'Other care instructions',
};
export function staffComplianceSettings(data) {
  const agreement = data.agreement;
  return (
    '<h3>' +
    text(t('Booking requirements')) +
    '</h3>' +
    form(
      'vaccine-requirements',
      '<label>' +
        text(t('Species')) +
        '<select name="species">' +
        ['dog', 'cat', 'exotic']
          .map((species) => '<option value="' + species + '">' + text(t('launch.' + species)) + '</option>')
          .join('') +
        '</select></label>' +
        area(
          'Required vaccines (one per line)',
          'names',
          (data.requirements.dog || []).join('\n'),
          'maxlength="1000"'
        ) +
        '<p>' +
        text(t('Leave the list empty to remove vaccine requirements for this species.')) +
        '</p>' +
        button('Save vaccine requirements')
    ) +
    form(
      'agreements',
      field(
        'Agreement title',
        'title',
        agreement?.title || t('Service agreement'),
        'required maxlength="120"'
      ) +
        area(
          'Agreement in English',
          'body_en',
          agreement?.body_en || policyText('en'),
          'required maxlength="20000"'
        ) +
        area(
          'Agreement in Spanish',
          'body_es',
          agreement?.body_es || policyText('es'),
          'required maxlength="20000"'
        ) +
        '<p>' +
        text(t('Publishing a new agreement asks clients to accept it before booking.')) +
        '</p>' +
        button('Publish agreement')
    )
  );
}

function intakeDefaults(data) {
  if (data.intake) return data.intake;
  const saved = data.pets.map((pet) => {
    try {
      return { pet, profile: JSON.parse(pet.details || '{}') };
    } catch {
      return { pet, profile: { notes: pet.details } };
    }
  });
  const combined = (keys) =>
    saved
      .map(({ pet, profile }) => {
        const values = keys.map((key) => profile[key]).filter(Boolean);
        return values.length ? pet.name + ' — ' + values.join(' · ') : '';
      })
      .filter(Boolean)
      .join('\n');
  return {
    pets: saved
      .map(({ pet, profile }) => [pet.name, profile.age, pet.species].filter(Boolean).join(', '))
      .join('\n'),
    feeding: combined(['food', 'portion', 'feeding', 'restrictions']),
    health: combined(['health', 'allergies']),
    medication: combined(['medication']),
    behavior: combined(['behavior', 'notes']),
    vaccines: combined(['vaccinations']),
    vet: combined(['vet', 'vetPhone']),
    emergency: combined(['contact', 'contactPhone']),
  };
}
export function careSettings(data) {
  const saved = intakeDefaults(data);
  const services = ['walk', 'dropIn', 'overnight']
    .map(
      (service) =>
        '<label><input required type="radio" name="service" value="' +
        service +
        '"' +
        (saved.service === service ? ' checked' : '') +
        '><span>' +
        text(copy(service)) +
        '</span></label>'
    )
    .join('');
  const fields = myoConfig.intakeFields.map(([key, type]) => {
    const label = text(copy(key));
    let control;
    if (type === 'select')
      control =
        '<select required name="' +
        key +
        '">' +
        [
          ['', 'selectOne'],
          ['yes', 'yes'],
          ['no', 'no'],
        ]
          .map(
            ([value, key]) =>
              '<option value="' +
              value +
              '"' +
              (saved.vetAuthorization === value ? ' selected' : '') +
              '>' +
              text(copy(key)) +
              '</option>'
          )
          .join('') +
        '</select>';
    else if (type === 'number')
      control =
        '<input required type="number" min="0" max="1000000" step=".01" name="' +
        key +
        '" value="' +
        text(saved[key] ?? '') +
        '">';
    else
      control =
        '<textarea required name="' +
        key +
        '" maxlength="' +
        myoConfig.intakeMaxLength +
        '">' +
        text(saved[key] || '') +
        '</textarea>';
    return '<label>' + label + control + '<small>' + text(copy(key + 'Hint')) + '</small></label>';
  });
  const groups = [
    ['Your pets and routines', fields.slice(0, 5)],
    ['Health and emergency contacts', fields.slice(5, 9)],
    ['Emergency authorization', fields.slice(9)],
  ]
    .map(
      ([title, fields]) =>
        '<details open><summary>' + text(t(title)) + '</summary>' + fields.join('') + '</details>'
    )
    .join('');
  const overnight =
    '<div data-care-overnight' +
    (saved.service === 'overnight' ? '' : ' hidden') +
    '>' +
    ['overnightAlone', 'overnightBehavior']
      .map(
        (key) =>
          '<label>' +
          text(copy(key)) +
          '<textarea maxlength="' +
          myoConfig.intakeMaxLength +
          '" name="' +
          key +
          '"' +
          (saved.service === 'overnight' ? ' required' : ' disabled') +
          '>' +
          text(saved[key] || '') +
          '</textarea></label>'
      )
      .join('') +
    '<label><input type="checkbox" name="overnightAcknowledgment"' +
    (saved.overnightAcknowledgment ? ' checked' : '') +
    (saved.service === 'overnight' ? ' required' : ' disabled') +
    '>' +
    text(copy('overnightAcknowledgment')) +
    '</label></div>';
  return (
    agreementPanel(data.agreement) +
    '<h3>' +
    text(t('Care intake')) +
    '</h3><p>' +
    text(t('Save your care and emergency details here. Myomi can review them in your customer record.')) +
    '</p>' +
    form(
      'intake',
      '<fieldset class="tap-choices"><legend>' +
        text(copy('service')) +
        '</legend><div>' +
        services +
        '</div></fieldset>' +
        groups +
        overnight +
        (data.intake ? '<p>' + text(t('Last saved')) + ' ' + formatDate(data.intake.updated) + '</p>' : '') +
        button('Save care intake')
    ) +
    '<h3>' +
    text(t('Home access')) +
    '</h3><p>' +
    text(t('Entry instructions are encrypted and available to Myomi only around your visit.')) +
    '</p>' +
    '<button type="button" class="secondary" data-load-access>' +
    text(t('Open entry instructions')) +
    '</button><div data-access-editor></div>'
  );
}
function agreementPanel(agreement) {
  if (!agreement) return '';
  if (agreement.accepted_at)
    return '<p>' + text(t('Agreement accepted')) + ' ' + formatDate(agreement.accepted_at) + '</p>';
  return (
    '<article id="care-agreement"><h3>' +
    text(t('Service agreement')) +
    '</h3><h4>' +
    text(agreement.title) +
    '</h4><p class="preserve">' +
    text(locale() === 'es' ? agreement.body_es : agreement.body_en) +
    '</p>' +
    form(
      'agreement/accept',
      hidden('version', agreement.version) +
        '<label><input type="checkbox" name="accepted" required>' +
        text(t('I have read and agree')) +
        '</label>' +
        button('Accept agreement')
    ) +
    '</article>'
  );
}
export function vaccineTools(pet, admin = false) {
  const rows = (pet.vaccines || [])
    .map((record) => {
      const badge =
        record.status === 'due_soon'
          ? t('Due {date}', { date: record.expires })
          : t('vaccine.' + record.status);
      const summary =
        '<h4>' +
        text(record.name) +
        ' · ' +
        text(badge) +
        '</h4>' +
        (record.verified ? '<p>' + text(t('Verified by Myomi')) + '</p>' : '') +
        (record.has_document
          ? '<a class="tap-link" href="/api/vaccines/' +
            record.id +
            '/document" download>' +
            text(t('Download vaccine record')) +
            '</a>'
          : '');
      if (admin)
        return (
          '<article>' +
          summary +
          (record.id && !record.verified
            ? form('vaccines/verify', hidden('id', record.id) + button('Mark verified'))
            : '') +
          '</article>'
        );
      return '<article>' + summary + vaccineForm(pet.id, record) + '</article>';
    })
    .join('');
  return (
    '<details class="care-vaccines"><summary>' +
    text(t('Vaccine records')) +
    '</summary>' +
    rows +
    (!admin ? vaccineForm(pet.id) : '') +
    '</details>'
  );
}
function vaccineForm(pet, record = {}) {
  return form(
    'vaccines',
    hidden('pet', pet) +
      (record.id ? hidden('record', record.id) : '') +
      field('Vaccine name', 'name', record.name || '', 'required maxlength="60"') +
      field('Given date', 'given', record.given || '', 'type="date"') +
      field('Expiry date', 'expires', record.expires || '', 'type="date" required') +
      '<label>' +
      text(t('Vaccine document (PDF or image, up to 5 MB)')) +
      '<input type="file" name="document" accept="application/pdf,image/*"></label>' +
      button('Save vaccine record')
  );
}
export function blockerHtml(blockers = [], data) {
  return blockers
    .map((item) => {
      const pet = data.pets.find((pet) => pet.id === item.pet_id);
      const params = { pet: pet?.name || '', vaccine: item.vaccine || '', date: item.expires || '' };
      const label = t('blocker.' + item.code, params);
      const href = item.code.startsWith('vaccine_')
        ? '#pets'
        : item.code === 'meet_required'
          ? '?service=meet#book'
          : '#care';
      return (
        '<p>' +
        text(label) +
        ' <a class="text-link" href="' +
        href +
        '">' +
        text(t('Resolve this requirement')) +
        '</a></p>'
      );
    })
    .join('');
}
export function staffCareTools(booking, pets) {
  const vaccines = pets.map((pet) => vaccineTools(pet, true)).join('');
  const profiles = (booking.pet_profiles || [])
    .map(
      (profile) =>
        '<p>' +
        text(pets.find((pet) => pet.id === profile.pet)?.name || '') +
        (profile.updated_since ? ' · ' + text(t('Profile changed since this visit was confirmed.')) : '') +
        '</p>' +
        '<button type="button" class="secondary" data-profile-version="' +
        profile.version +
        '">' +
        text(t('View saved care profile')) +
        '</button><div data-profile-snapshot></div>'
    )
    .join('');
  const access = booking.home_access;
  return (
    vaccines +
    profiles +
    (access
      ? '<p>' +
        text(t('Home access')) +
        ' · ' +
        text(t('access.' + access.method)) +
        ' · ' +
        text(t('key.' + access.key_status)) +
        '</p>' +
        '<button type="button" class="secondary" data-reveal-access="' +
        booking.id +
        '">' +
        text(t('Show entry details')) +
        '</button><div data-entry-details></div>' +
        form(
          'keys',
          hidden('owner', booking.owner) +
            '<label>' +
            text(t('Key custody')) +
            '<select name="key_status">' +
            ['with_client', 'with_myomi', 'returned']
              .map(
                (value) =>
                  '<option value="' +
                  value +
                  '"' +
                  (value === access.key_status ? ' selected' : '') +
                  '>' +
                  text(t('key.' + value)) +
                  '</option>'
              )
              .join('') +
            '</select></label>' +
            button('Save key status')
        )
      : '')
  );
}
export function feedbackTool(visit) {
  if (visit.status !== 'Completed') return '';
  return (
    '<details><summary>' +
    text(t('How did the visit go?')) +
    '</summary>' +
    form(
      'feedback',
      hidden('booking', visit.id) +
        '<fieldset class="tap-choices"><legend>' +
        text(t('Your private feedback')) +
        '</legend><div>' +
        [
          [1, '🙂', 'Happy'],
          [0, '😐', 'Okay'],
          [-1, '🙁', 'Needs attention'],
        ]
          .map(
            ([value, icon, key]) =>
              '<label><input type="radio" required name="score" value="' +
              value +
              '"' +
              (visit.feedback?.score === value ? ' checked' : '') +
              '><span>' +
              icon +
              ' ' +
              text(t(key)) +
              '</span></label>'
          )
          .join('') +
        '</div></fieldset>' +
        area('Comment (optional)', 'comment', visit.feedback?.comment || '', 'maxlength="1000"') +
        button('Save feedback')
    ) +
    '</details>'
  );
}
export function reportInputs(template = [], saved = {}) {
  return template
    .map((def) => {
      const name = 'report_' + def.id;
      if (def.type === 'count')
        return field(
          translateLabel(def.label),
          name,
          saved[def.id] ?? '',
          'type="number" min="' + (def.min ?? 0) + '" max="' + (def.max ?? 1000) + '" step="1"'
        );
      const options =
        def.type === 'yesno'
          ? [
              [true, 'Yes'],
              [false, 'No'],
            ]
          : def.options.map((value) => [value, value]);
      return (
        '<fieldset class="tap-choices"><legend>' +
        text(translateLabel(def.label)) +
        '</legend><div>' +
        options
          .map(
            ([value, label]) =>
              '<label><input type="radio" name="' +
              name +
              '" value="' +
              value +
              '"' +
              (String(saved[def.id]) === String(value) ? ' checked' : '') +
              '><span>' +
              text(translateLabel(label)) +
              '</span></label>'
          )
          .join('') +
        '</div></fieldset>'
      );
    })
    .join('');
}
export function reportPayload(form, template) {
  const data = {};
  for (const def of template) {
    const value = new FormData(form).get('report_' + def.id);
    if (value === null || value === '') continue;
    data[def.id] = def.type === 'yesno' ? value === 'true' : def.type === 'count' ? Number(value) : value;
  }
  return data;
}
function accessEditor(saved = {}) {
  return form(
    'home-access',
    '<fieldset class="tap-choices"><legend>' +
      text(t('Entry method')) +
      '</legend><div>' +
      ['key', 'lockbox', 'code', 'doorman', 'other']
        .map(
          (method) =>
            '<label><input required type="radio" name="method" value="' +
            method +
            '"' +
            (method === saved.method ? ' checked' : '') +
            '><span>' +
            text(t('access.' + method)) +
            '</span></label>'
        )
        .join('') +
      '</div></fieldset>' +
      area(
        'Entry instructions',
        'instructions',
        saved.instructions || '',
        'maxlength="1000" autocomplete="off" data-no-draft'
      ) +
      field(
        'Key label (optional)',
        'key_label',
        saved.key_label || '',
        'maxlength="40" autocomplete="off" data-no-draft'
      ) +
      (saved.key_status ? '<p>' + text(t('key.' + saved.key_status)) + '</p>' : '') +
      button('Save entry instructions')
  );
}
export function timelineSection(pet) {
  return (
    '<section id="pet-' +
    pet.id +
    '" hidden><h2>' +
    text(t('Care history for {pet}', { pet: pet.name })) +
    '</h2><a class="tap-link" href="#pets">' +
    text(t('Back to my pets')) +
    '</a>' +
    '<div data-timeline="' +
    pet.id +
    '"><p>' +
    text(t('Loading…')) +
    '</p></div></section>'
  );
}
export function clientSection() {
  return (
    '<section id="clients" hidden><h2>' +
    text(t('Clients')) +
    '</h2>' +
    form(
      'search-clients',
      field('Search by name or email', 'query', '', 'type="search" maxlength="100"') + button('Search')
    ) +
    '<div data-client-list></div><div data-client-record></div></section>'
  );
}
function timelineRows(entries) {
  let month = '';
  return entries
    .map((entry) => {
      const label = new Intl.DateTimeFormat(locale() === 'es' ? 'es-US' : 'en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'America/New_York',
      }).format(entry.at);
      const title =
        entry.type === 'visit'
          ? translateLabel(entry.service_name)
          : entry.type === 'event'
            ? translateLabel(entry.kind)
            : entry.type === 'vaccine'
              ? entry.name
              : t('Profile updated');
      const details =
        entry.summary ||
        entry.notes ||
        entry.changed?.map((key) => t(profileLabels[key] || 'Other care details updated')).join(', ') ||
        '';
      const heading = month !== label ? '<h3>' + text(label) + '</h3>' : '';
      month = label;
      return (
        heading +
        '<article><h4>' +
        text(title) +
        '</h4><time>' +
        formatDate(entry.at) +
        '</time>' +
        '<p class="preserve">' +
        text(details) +
        '</p>' +
        (entry.fields?.length
          ? '<ul class="diary-fields">' +
            entry.fields
              .map(
                (field) =>
                  '<li' +
                  (field.hidden ? ' class="diary-field-hidden"' : '') +
                  '>' +
                  text(translateLabel(field.label)) +
                  ' · ' +
                  text(
                    field.type === 'yesno'
                      ? t(field.value ? 'Yes' : 'No')
                      : field.type === 'choice'
                        ? translateLabel(field.value)
                        : field.value
                  ) +
                  '</li>'
              )
              .join('') +
            '</ul>'
          : '') +
        (entry.expires
          ? '<p>' +
            text(t('Expiry date')) +
            ' ' +
            formatDate(Date.parse(entry.expires + 'T12:00Z'), 'date') +
            '</p>'
          : '') +
        (entry.has_photo
          ? '<a class="tap-link" href="/api/photos/' + entry.id + '">' + text(t('Open visit photo')) + '</a>'
          : '') +
        '</article>'
      );
    })
    .join('');
}
async function loadTimeline(panel, more = false) {
  if (panel.getAttribute('aria-busy') === 'true') return;
  panel.setAttribute('aria-busy', 'true');
  try {
    const result = await context.api(
      'pets/' +
        panel.dataset.timeline +
        '/timeline' +
        (more && panel.dataset.cursor ? '?before=' + encodeURIComponent(panel.dataset.cursor) : '')
    );
    if (!panel.isConnected) return;
    const html = timelineRows(result.entries);
    if (!more) panel.innerHTML = html || '<p>' + text(t('No care history yet.')) + '</p>';
    else {
      panel.querySelector('[data-more-timeline]')?.remove();
      panel.insertAdjacentHTML('beforeend', html);
    }
    panel.dataset.loaded = '1';
    panel.dataset.cursor = result.next || '';
    if (result.next)
      panel.insertAdjacentHTML(
        'beforeend',
        '<button type="button" data-more-timeline>' + text(t('Show older history')) + '</button>'
      );
  } catch (error) {
    panel.innerHTML =
      '<p>' +
      text(error.message) +
      '</p><button type="button" data-more-timeline>' +
      text(t('Try again')) +
      '</button>';
  } finally {
    panel.setAttribute('aria-busy', 'false');
  }
}
async function clients(query = '', cursor = '', append = false) {
  const panel = document.querySelector('[data-client-list]');
  const generation = ++clientSearchGeneration;
  const result = await context.api(
    'clients?q=' + encodeURIComponent(query) + (cursor ? '&before=' + encodeURIComponent(cursor) : '')
  );
  if (!panel?.isConnected || generation !== clientSearchGeneration) return;
  const rows = result.clients
    .map(
      (client) =>
        '<article><button type="button" class="secondary" data-client="' +
        client.id +
        '">' +
        text(client.name) +
        '</button><p>' +
        text(client.email) +
        '</p><p>' +
        text(client.pets.map((p) => p.name).join(', ')) +
        '</p></article>'
    )
    .join('');
  if (append) {
    panel.querySelector('[data-more-clients]')?.remove();
    panel.insertAdjacentHTML('beforeend', rows);
  } else panel.innerHTML = rows || '<p>' + text(t('No customers found.')) + '</p>';
  panel.dataset.query = query;
  panel.dataset.cursor = result.next || '';
  if (result.next)
    panel.insertAdjacentHTML(
      'beforeend',
      '<button type="button" data-more-clients>' + text(t('Show more customers')) + '</button>'
    );
  panel.dataset.loaded = '1';
}
async function clientRecord(id) {
  const panel = document.querySelector('[data-client-record]');
  const result = await context.api('clients/' + id);
  if (!panel?.isConnected) return;
  const { client, pets, intake, notes } = result;
  panel.innerHTML =
    '<h3>' +
    text(client.name) +
    '</h3><p>' +
    text(client.email) +
    '</p>' +
    (intake
      ? '<details><summary>' +
        text(t('Care intake')) +
        '</summary><dl>' +
        myoConfig.intakeFields
          .map(
            ([key]) =>
              '<dt>' +
              text(copy(key)) +
              '</dt><dd class="preserve">' +
              text(key === 'vetAuthorization' ? copy(intake[key]) : intake[key]) +
              '</dd>'
          )
          .join('') +
        (intake.overnightAcknowledgment
          ? ['overnightAlone', 'overnightBehavior']
              .map(
                (key) => '<dt>' + text(copy(key)) + '</dt><dd class="preserve">' + text(intake[key]) + '</dd>'
              )
              .join('')
          : '') +
        '</dl></details>'
      : '') +
    pets
      .map(
        (pet) =>
          '<article><h4>' +
          text(pet.name) +
          '</h4>' +
          vaccineTools(pet, true) +
          '<div data-timeline="' +
          pet.id +
          '"><button type="button" data-more-timeline>' +
          text(t('Care history')) +
          '</button></div></article>'
      )
      .join('') +
    '<h4>' +
    text(t('Booking history')) +
    '</h4>' +
    result.bookings
      .map(
        (visit) =>
          '<p>' +
          text(translateLabel(visit.service_name)) +
          ' · ' +
          text(translateLabel(visit.status)) +
          ' · ' +
          formatDate(visit.starts) +
          ' · ' +
          formatMoney(visit.cents) +
          '</p>'
      )
      .join('') +
    '<h4>' +
    text(t('Private staff notes')) +
    '</h4>' +
    notes
      .map((note) =>
        form(
          'staff-notes',
          hidden('id', note.id) +
            hidden('subject_type', note.subject_type) +
            hidden('subject_id', note.subject_id) +
            area('Note', 'body', note.body, 'required maxlength="3000"') +
            button('Save note') +
            '<button type="button" class="secondary" data-delete-note="' +
            note.id +
            '" data-client-owner="' +
            client.id +
            '">' +
            text(t('Delete note')) +
            '</button>',
          'data-client-owner="' + client.id + '"'
        )
      )
      .join('') +
    form(
      'staff-notes',
      '<label>' +
        text(t('Note about')) +
        '<select name="subject">' +
        '<option value="client:' +
        client.id +
        '">' +
        text(client.name) +
        '</option>' +
        pets.map((pet) => '<option value="pet:' + pet.id + '">' + text(pet.name) + '</option>').join('') +
        '</select></label>' +
        area('Note', 'body', '', 'required maxlength="3000"') +
        button('Add private note'),
      'data-client-owner="' + client.id + '"'
    );
}
async function documentData(file) {
  if (file.size > 5000000) throw new Error(t('Choose a document smaller than 5 MB.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(t('Could not read the document.')));
    reader.readAsDataURL(file);
  });
}
export function clearEntryDetails() {
  entryGeneration++;
  revealTimers.forEach(clearTimeout);
  revealTimers = [];
  for (const panel of document.querySelectorAll('[data-entry-details],[data-access-editor]'))
    panel.replaceChildren();
}
export function loadCareSection(id) {
  clearEntryDetails();
  const timeline = document.querySelector('#' + CSS.escape(id) + ' [data-timeline]');
  if (timeline && !timeline.dataset.loaded) loadTimeline(timeline);
  const list = document.querySelector('#' + CSS.escape(id) + ' [data-client-list]');
  if (list && !list.dataset.loaded)
    clients().catch((error) => {
      list.textContent = error.message;
    });
}
export function configureCareUi(next) {
  context = next;
}
export function bindCareUi(root) {
  root.addEventListener('input', (event) => {
    if (event.target.form?.dataset.careAction !== 'search-clients') return;
    clearTimeout(searchTimer);
    const query = event.target.value;
    searchTimer = setTimeout(() => clients(query).catch((error) => context.notify(error.message)), 300);
  });
  root.addEventListener(
    'invalid',
    (event) => {
      for (let node = event.target.parentElement; node && node !== root; node = node.parentElement)
        if (node.tagName === 'DETAILS') node.open = true;
    },
    true
  );
  root.addEventListener('change', (event) => {
    if (event.target.form?.dataset.careAction === 'vaccine-requirements' && event.target.name === 'species') {
      event.target.form.elements.names.value = (context.data.requirements[event.target.value] || []).join(
        '\n'
      );
    }
    const form = event.target.closest('[data-care-action="intake"]');
    if (!form || event.target.name !== 'service') return;
    const overnight = event.target.value === 'overnight';
    const panel = form.querySelector('[data-care-overnight]');
    panel.hidden = !overnight;
    panel.querySelectorAll('input,textarea').forEach((input) => {
      input.disabled = !overnight;
      input.required = overnight;
    });
  });
  root.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-care-action]');
    if (!form) return;
    event.preventDefault();
    const action = form.dataset.careAction;
    const control = event.submitter;
    const message = form.querySelector('[data-care-status]');
    control.disabled = true;
    const languageControls = [...document.querySelectorAll('[data-language]')];
    languageControls.forEach((button) => {
      button.disabled = true;
    });
    message.textContent = t('Saving…');
    const values = Object.fromEntries(new FormData(form));
    try {
      if (action === 'search-clients') {
        await clients(values.query);
        message.textContent = '';
        return;
      }
      const payload = { ...values };
      if (action === 'vaccine-requirements')
        payload.names = values.names
          .split(/\r?\n/)
          .map((name) => name.trim())
          .filter(Boolean);
      if (action === 'staff-notes' && values.subject) {
        const [type, id] = values.subject.split(':');
        payload.subject_type = type;
        payload.subject_id = Number(id);
        delete payload.subject;
      }
      if (action === 'intake') {
        payload.spendingLimit = Number(values.spendingLimit);
        payload.overnightAcknowledgment = values.overnightAcknowledgment === 'on';
      }
      if (action === 'agreement/accept') payload.version = Number(values.version);
      if (['vaccines', 'vaccines/verify', 'feedback', 'keys', 'staff-notes'].includes(action)) {
        for (const key of ['pet', 'id', 'booking', 'score', 'owner', 'subject_id'])
          if (key in payload) payload[key] = Number(payload[key]);
      }
      let file;
      if (action === 'vaccines') {
        file = values.document;
        delete payload.document;
        delete payload.record;
        if (file?.size > 5000000) throw new Error(t('Choose a document smaller than 5 MB.'));
      }
      const requestBody = JSON.stringify(payload);
      if (form.dataset.requestBody !== requestBody) form.dataset.requestKey = crypto.randomUUID();
      form.dataset.requestBody = requestBody;
      const savedResult = await context.api(action, payload, form.dataset.requestKey);
      delete form.dataset.requestKey;
      delete form.dataset.requestBody;
      if (action === 'vaccines' && file?.size) {
        await context.api('vaccines/document', { id: savedResult.id, document: await documentData(file) });
      }
      message.textContent = t('Saved.');
      if (action === 'home-access') {
        form.elements.instructions.value = '';
        clearEntryDetails();
        return;
      }
      if (form.dataset.clientOwner) {
        await clientRecord(form.dataset.clientOwner);
        return;
      }
      await context.refresh();
      context.notify(t('Saved.'));
    } catch (error) {
      if (message.isConnected) message.textContent = error.message;
    } finally {
      if (control.isConnected) control.disabled = false;
      languageControls.forEach((button) => {
        button.disabled = false;
      });
    }
  });
  root.addEventListener('click', async (event) => {
    const control = event.target.closest(
      '[data-load-access],[data-reveal-access],[data-more-timeline],[data-client],[data-more-clients],[data-delete-note],[data-profile-version],[data-stay-date]'
    );
    if (!control) return;
    control.disabled = true;
    try {
      if (control.dataset.stayDate) {
        const form = control.closest('[data-action="bookings"]'),
          start = form.elements.stay_start,
          end = form.elements.stay_end;
        const available = new Set(context.data.overnight_nights.map((night) => night.date));
        const value = control.dataset.stayDate;
        const status = form.querySelector('[data-stay-calendar-status]');
        if (!start.value || end.value || value <= start.value) {
          if (!available.has(value)) {
            status.textContent = t('Choose an available arrival date.');
            return;
          }
          start.value = value;
          end.value = '';
          status.textContent = t('Choose a departure date.');
        } else {
          for (
            let at = Date.parse(start.value + 'T12:00Z');
            at < Date.parse(value + 'T12:00Z');
            at += 86400000
          ) {
            if (!available.has(new Date(at).toISOString().slice(0, 10))) {
              status.textContent = t('Myomi is unavailable for part of this stay. Choose different dates.');
              return;
            }
          }
          end.value = value;
          status.textContent = '';
        }
        syncStayCalendar(form);
        start.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (control.dataset.profileVersion) {
        const saved = await context.api('profile-versions/' + control.dataset.profileVersion);
        let fields;
        try {
          fields = JSON.parse(saved.details);
        } catch {
          fields = { notes: saved.details };
        }
        if (control.isConnected)
          control.nextElementSibling.innerHTML =
            '<h4>' +
            text(saved.name) +
            ' · ' +
            text(saved.species) +
            '</h4><dl>' +
            Object.entries(fields)
              .filter(([key]) => key !== 'profileVersion')
              .map(
                ([key, value]) =>
                  '<dt>' +
                  text(t(profileLabels[key] || 'Other care details updated')) +
                  '</dt><dd class="preserve">' +
                  text(value) +
                  '</dd>'
              )
              .join('') +
            '</dl>';
      } else if (control.matches('[data-load-access]')) {
        const generation = entryGeneration;
        const saved = await context.api('home-access');
        const panel = document.querySelector('[data-access-editor]');
        if (panel?.isConnected && generation === entryGeneration && !control.closest('section')?.hidden)
          panel.innerHTML = accessEditor(saved || {});
      } else if (control.dataset.revealAccess) {
        const generation = entryGeneration;
        const saved = await context.api('home-access/booking/' + control.dataset.revealAccess);
        const panel = control.nextElementSibling;
        if (panel.isConnected && generation === entryGeneration && !control.closest('section')?.hidden) {
          panel.textContent = saved.instructions;
          revealTimers.push(setTimeout(() => panel.replaceChildren(), 60000));
        }
      } else if (control.matches('[data-more-timeline]'))
        await loadTimeline(control.closest('[data-timeline]'), true);
      else if (control.dataset.client) {
        location.hash = 'clients';
        await clientRecord(control.dataset.client);
      } else if (control.dataset.deleteNote) {
        await context.api('staff-notes/delete', { id: Number(control.dataset.deleteNote) });
        await clientRecord(control.dataset.clientOwner);
      } else {
        const list = control.closest('[data-client-list]');
        await clients(list.dataset.query, list.dataset.cursor, true);
      }
    } catch (error) {
      context.notify(error.message);
    } finally {
      if (control.isConnected) control.disabled = false;
    }
  });
}
