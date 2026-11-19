import './public-i18n.js';
import {myoConfig} from './myo-config.js';
import {policyParameters} from './policy-copy.js';
import {t,locale} from './i18n.js';

const groups = [
  ['booking','Booking, deposits & cancellations',['booking','meet','payments','clientCancel','myoCancel','peak']],
  ['care','Care, safety & emergencies',['services','eligibility','intake','backup','weather']],
  ['home','Home access & privacy',['access','security','privacy']],
  ['area','Service area & contact',['area','contact']],
];
const root = document.querySelector('#policy-list');
const node = (tag,content) => {const item=document.createElement(tag);if(content !== undefined)item.textContent=content;return item;};
function render() {
  const opened = new Set([...root.querySelectorAll('details[open]')].map(item=>item.id));
  const parameters = policyParameters(locale());
  root.replaceChildren(...groups.map(([id,title,keys])=>{
    const group=node('details');group.className='policy-group';group.id='policy-topic-'+id;group.open=opened.has(group.id);
    group.append(node('summary',t(title)));
    const contents=node('div');contents.className='policy-group-contents';
    for(const key of keys.filter(key=>myoConfig.policyKeys.includes(key))) {
      const item=node('details');item.className='policy-detail';item.id='policy-'+key;item.dataset.policy=key;item.open=opened.has(item.id);
      item.append(node('summary',t('launch.'+(key==='peak'?'peakTitlePolicy':key+'Title'),parameters)),node('p',t('launch.'+key+'Body',parameters)));
      const destinations = {intake:['../../portal/index.html#care','Open care details in your portal'],services:['../launch/index.html#rates','Services & rates'],peak:['../launch/index.html#peak','See peak dates']};
      if(destinations[key]) {
        const [href,label]=destinations[key],link=node('a',t(label));link.href=href;link.className='button button-secondary button-small';item.append(link);
      }
      contents.append(item);
    }
    group.append(contents);return group;
  }));
}
function revealHash() {
  const target=document.getElementById(location.hash.slice(1));
  if(!target || !target.closest('#policies')) return;
  for(let item=target;item;item=item.parentElement) if(item.tagName==='DETAILS') item.open=true;
  target.scrollIntoView({block:'start',behavior:'instant'});
}
render();revealHash();
window.addEventListener('myo:languagechange',render);
window.addEventListener('hashchange',revealHash);
