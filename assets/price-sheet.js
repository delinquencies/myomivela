const money = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const date = new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'});
const element = (tag, content) => {
  const node = document.createElement(tag);
  node.textContent = content;
  return node;
};
export async function showPriceSheet(container, { service, rate } = {}) {
  container.replaceChildren(element('p','Loading rates and times…'));
  try {
    const response = await fetch('/api/availability');
    if (!response.ok) throw new Error('Availability response failed');
    let rows = await response.json();
    if (service) rows = rows.filter(row => row.name === service);
    if (rate && rows.some(row => String(row.id) === rate)) rows = rows.filter(row => String(row.id) === rate);
    if (!rows.length) {
      container.replaceChildren(element('p','Myomi hasn’t published rates yet.'));
      return;
    }
    const list = document.createElement('ul');
    list.className = 'rate-list';
    for (const row of rows) {
      const item = document.createElement('li');
      item.append(element('strong',row.name),element('p',row.minutes+' min · '+money.format(row.cents/100)));
      item.append(element('p',row.times.length ? 'Next available times' : 'No available times in the next two weeks.'));
      if (row.times.length) {
        const times = document.createElement('ul');
        for (const time of row.times) times.append(element('li',date.format(time)));
        item.append(times);
      }
      list.append(item);
    }
    container.replaceChildren(list);
  } catch {
    container.replaceChildren(element('p','Rates and times are unavailable right now.'));
  }
}
