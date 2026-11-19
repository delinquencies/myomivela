import { t, translateLabel, formatDate, formatMoney } from './i18n.js';
const element = (tag, content) => {
  const node = document.createElement(tag);
  node.textContent = content;
  return node;
};
export async function showPriceSheet(container, { service, rate } = {}) {
  container.replaceChildren(element('p',t("Loading rates and times…")));
  try {
    const response = await fetch('/api/availability');
    if (!response.ok) throw new Error(t("Availability response failed"));
    let rows = await response.json();
    if (service) rows = rows.filter(row => row.name === service);
    if (rate && rows.some(row => String(row.id) === rate)) rows = rows.filter(row => String(row.id) === rate);
    if (!rows.length) {
      container.replaceChildren(element('p',t("Myomi hasn’t published rates yet.")));
      return;
    }
    const list = document.createElement('ul');
    list.className = 'rate-list';
    for (const row of rows) {
      const item = document.createElement('li');
      const price = formatMoney(row.cents);
      item.append(element('strong',translateLabel(row.name)),element('p',row.kind === 'overnight'
        ? t('From {price} per night',{price}) : t('From {price} / {minutes} min',{price,minutes:row.minutes})));
      if (row.kind === 'overnight') {
        item.append(element('p',t(row.nights?.length ? 'Next available nights' : 'Check stay dates in booking for overnight availability.')));
        if (row.nights?.length) {
          const nights = document.createElement('ul');
          for (const night of row.nights) nights.append(element('li',formatDate(Date.parse(night+'T12:00:00Z'),'date')));
          item.append(nights);
        }
        list.append(item);
        continue;
      }
      item.append(element('p',row.times.length ? t("Next available times") : t("No available times in the next two weeks.")));
      if (row.times.length) {
        const times = document.createElement('ul');
        for (const time of row.times) times.append(element('li',formatDate(time)));
        item.append(times);
      }
      list.append(item);
    }
    container.replaceChildren(element('p',t('Starting prices. Peak dates, short notice and extra pets may change your quote.')),list);
  } catch {
    container.replaceChildren(element('p',t("Rates and times are unavailable right now.")));
  }
}
