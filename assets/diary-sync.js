// @ts-check
// Diary freshness (CUX-06): keeps an open Pet Diary (or staff publishing view) up to date without the reader pressing
// Refresh. Pure controller: no DOM, no announcements, no scrolling. The portal (Codex) starts it when a diary screen
// is shown, tells it when the tab is hidden or shown, stops it on navigation and sign-out, and renders what it reports.
//
// Budget (a proposed product budget, not a measured service level): one GET /api/diary/changes every 30 seconds while
// a diary screen is visible: about 120 small requests an hour per open tab, none while hidden. Errors back off
// 30 s → 60 s → 2 min → 4 min → 5 min (cap). An unchanged answer is under 200 bytes.

/**
 * @typedef {'idle'|'checking'|'current'|'new_data'|'stale'|'disconnected'} SyncState
 * @typedef {{ revision:string, changed:boolean, latest_published_at:number|null, checked_at:number, events:object[], visit_ids:number[], truncated?:boolean }} Changes
 * @typedef {{ state:SyncState, revision:string|null, checkedAt:number|null, latestPublishedAt:number|null, events:object[], visitIds:number[], truncated:boolean }} SyncReport
 */

/**
 * @param {{
 *   fetchChanges:(since:string|null) => Promise<Changes>,
 *   onReport:(report:SyncReport) => void,
 *   intervalMs?:number, maxBackoffMs?:number,
 *   now?:() => number, setTimer?:(fn:() => void, ms:number) => any, clearTimer?:(handle:any) => void,
 * }} options
 */
export function createDiarySync({ fetchChanges, onReport, intervalMs = 30_000, maxBackoffMs = 300_000,
  now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = handle => clearTimeout(handle) }) {
  let generation = 0;          // bumps on start/stop/account change, so late answers from before are ignored
  let running = false;
  let visible = true;
  let timer = null;
  let inFlight = null;         // the current request, shared by overlapping refresh() calls
  let revision = null;
  let checkedAt = null;
  let latestPublishedAt = null;
  let failures = 0;
  /** @type {SyncState} */
  let state = 'idle';

  const report = (/** @type {SyncState} */ next, extra = {}) => {
    state = next;
    onReport({ state, revision, checkedAt, latestPublishedAt, events:[], visitIds:[], truncated:false, ...extra });
  };
  const delay = () => failures ? Math.min(maxBackoffMs, intervalMs * 2 ** (failures - 1)) : intervalMs;
  function schedule() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (running && visible) timer = setTimer(() => { timer = null; check(); }, delay());
  }
  function check() {
    if (!running) return Promise.resolve();
    if (inFlight) return inFlight;
    const mine = generation;
    report('checking');
    inFlight = fetchChanges(revision).then(changes => {
      if (mine !== generation) return; // a newer start/stop happened: this answer belongs to a previous screen or account
      failures = 0;
      const first = revision === null;
      revision = changes.revision;
      checkedAt = changes.checked_at ?? now();
      latestPublishedAt = changes.latest_published_at ?? latestPublishedAt;
      const fresh = !first && changes.changed && (changes.events.length > 0 || changes.visit_ids.length > 0 || Boolean(changes.truncated));
      report(fresh ? 'new_data' : 'current', fresh ? { events:changes.events, visitIds:changes.visit_ids, truncated:Boolean(changes.truncated) } : {});
    }, () => {
      if (mine !== generation) return;
      failures++;
      // Data older than two intervals is stale; a failed check means we can't reach the server right now.
      report(checkedAt !== null && now() - checkedAt > 2 * intervalMs ? 'stale' : 'disconnected');
    }).finally(() => {
      if (mine === generation) { inFlight = null; schedule(); }
    });
    return inFlight;
  }

  return {
    /** Starts checking for this account and screen (a new generation; answers for the previous one are ignored). */
    start(/** @type {{ revision?:string|null }} */ { revision:known = null } = {}) {
      generation++;
      running = true;
      inFlight = null;
      revision = known;
      failures = 0;
      return check();
    },
    /** Stops checking (navigation away, sign-out, account change). */
    stop() {
      generation++;
      running = false;
      inFlight = null;
      if (timer !== null) clearTimer(timer);
      timer = null;
      report('idle');
    },
    /** The tab was hidden or shown. Hidden: no requests. Shown again: check at once. */
    setVisible(/** @type {boolean} */ value) {
      visible = value;
      if (!running) return;
      if (!visible) { if (timer !== null) clearTimer(timer); timer = null; return; }
      check();
    },
    /** Checks now (the reader pressed Refresh). Overlapping calls share one request. */
    refresh() { failures = 0; return check(); },
    /** The current state, for a "checked a moment ago" line. */
    get status() { return { state, revision, checkedAt, latestPublishedAt, running, visible }; },
  };
}
