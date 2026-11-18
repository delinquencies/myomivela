import { myoConfig } from './myo-config.js';
import { t } from './i18n.js';

export function policyParameters(language = 'en') {
  const { business, booking, rates, flags } = myoConfig;
  const locale = language === 'es' ? 'es-US' : 'en-US';
  const money = (value) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(
      value
    );
  const percent = (value) => new Intl.NumberFormat(locale, { style: 'percent' }).format(value);
  const hour = (value) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: '2-digit',
      hour12: language === 'en',
    }).format(new Date('2000-01-01T' + value + ':00Z'));
  return {
    city: business.city,
    state: business.state,
    zip: business.zip,
    radius: business.radiusMiles,
    hours: hour(business.opens) + '–' + hour(business.closes),
    capacity: business.capacity,
    contact: business.contact,
    aloneMin: booking.aloneHoursMin,
    aloneMax: booking.aloneHoursMax,
    peakVisit: money(rates.peakVisit),
    visitMinutes: rates.visitMinutes,
    peakLong: money(rates.peakVisit + rates.extension),
    longMinutes: rates.longVisitMinutes,
    nightSurcharge: money(rates.overnightPeakSurcharge),
    peakNight: money(rates.overnight + rates.overnightPeakSurcharge),
    visitNotice: booking.visitNoticeDays,
    overnightNotice: booking.overnightNoticeDays,
    lastMinuteTerms: t(
      'launch.' + (flags.autoApplyLastMinuteFee ? 'lastMinuteFeeOn' : 'lastMinuteFeeOff'),
      { lastMinute: money(rates.lastMinute) },
      language
    ),
    depositPercent: percent(booking.depositRatio),
    depositHours: booking.depositHours,
    meetPrice: money(booking.meetAndGreet),
    balancePercent: percent(1 - booking.depositRatio),
    cancelDays: booking.cancellationDays,
    retentionPercent: percent(flags.lateCancellationDepositRetentionRatio),
    retentionTotal: percent(flags.lateCancellationDepositRetentionRatio * booking.depositRatio),
    weightMin: booking.dogWeightMin,
    weightMax: booking.dogWeightMax,
    puppyAge: booking.puppyAgeYears,
  };
}
export function policyText(language = 'en') {
  const parameters = policyParameters(language);
  const { rates, booking, flags } = myoConfig;
  const money = (value) =>
    new Intl.NumberFormat(language === 'es' ? 'es-US' : 'en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value);
  const date = new Intl.DateTimeFormat(language === 'es' ? 'es-US' : 'en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
  return myoConfig.policyKeys
    .map((key) => {
      const title = t('launch.' + (key === 'peak' ? 'peakTitlePolicy' : key + 'Title'), parameters, language);
      let body = t('launch.' + key + 'Body', parameters, language);
      if (key === 'services') {
        body += '\n' + myoConfig.excluded.map((excluded) => t('launch.' + excluded, {}, language)).join('\n');
        body +=
          '\n' +
          ['walk', 'dropIn']
            .map(
              (service) =>
                t('launch.' + service, {}, language) +
                ' · ' +
                t(
                  'launch.visitRate',
                  { minutes: rates.visitMinutes, regular: money(rates.visit), peak: money(rates.peakVisit) },
                  language
                ) +
                ' · ' +
                t(
                  'launch.longVisitRate',
                  {
                    minutes: rates.longVisitMinutes,
                    regular: money(rates.visit + rates.extension),
                    peak: money(rates.peakVisit + rates.extension),
                  },
                  language
                )
            )
            .join('\n');
        body +=
          '\n' +
          t('launch.overnight', {}, language) +
          ' · ' +
          t(
            'launch.overnightRate',
            { regular: money(rates.overnight), peak: money(rates.overnight + rates.overnightPeakSurcharge) },
            language
          );
        body +=
          '\n' +
          t(
            'launch.addons',
            {
              extraDog: money(rates.additionalDog),
              extraCat: money(rates.additionalCat),
              puppyAge: booking.puppyAgeYears,
              puppy: money(rates.puppy),
              peakPuppy: money(flags.peakPuppyRate),
            },
            language
          );
        body +=
          '\n' +
          t(
            'launch.overnightAddons',
            {
              nightDog: money(flags.overnightAdditionalPetRates.dog),
              nightCat: money(flags.overnightAdditionalPetRates.cat),
            },
            language
          );
        body +=
          '\n' +
          t(
            'launch.exoticRate',
            {
              exoticBase: money(flags.smallExoticPetRate.base),
              exoticExtra: money(flags.smallExoticPetRate.additional),
            },
            language
          );
      }
      if (key === 'peak')
        body +=
          '\n' +
          myoConfig.peakPeriods
            .map(
              ([name, start, end]) =>
                t('launch.' + name, {}, language) +
                ' · ' +
                date.format(Date.parse(start + 'T12:00Z')) +
                ' – ' +
                date.format(Date.parse(end + 'T12:00Z'))
            )
            .join('\n');
      return title + '\n' + body;
    })
    .join('\n\n');
}
