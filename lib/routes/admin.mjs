// Staff settings: service prices and published availability windows.
import { run } from '../db.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { serviceNames } from '../domain.mjs';

export default [
  { method:'POST', path:'/api/services', access:'staff', handler:({ data }) => {
    const name = field(data.name,80);
    requireThat(serviceNames.includes(name),'Select one of the three care services.');
    run('INSERT INTO services(name,minutes,cents) VALUES(?,?,?) ON CONFLICT(name,minutes) DO UPDATE SET cents=excluded.cents',name,integer(data.minutes,1440),integer(data.cents,1000000,0));
    return {};
  } },

  { method:'POST', path:'/api/slots', access:'staff', handler:({ data }) => {
    if (data.id !== undefined) {
      run('DELETE FROM slots WHERE id=?',integer(data.id));
    } else {
      const starts = Date.parse(field(data.starts,48));
      const ends = Date.parse(field(data.ends,48));
      requireThat(starts > Date.now() && ends > starts && ends-starts <= 86_400_000,'Choose a future window up to 24 hours.');
      run('INSERT INTO slots(starts,ends) VALUES(?,?)',starts,ends);
    }
    return {};
  } },
];
