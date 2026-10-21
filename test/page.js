// Opens index.html in jsdom (a browser simulated in Node) so the tests drive the real page: its
// buttons, its storage and what it shows. LEDGER_HTML points the tests at another copy of the page,
// which is how each test was first seen failing on the original version.

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PAGE = process.env.LEDGER_HTML || path.join(__dirname, '..', 'index.html');
const HTML = fs.readFileSync(PAGE, 'utf8');
const STORE_KEY = 'workout-ledger:v1';

// Uncaught errors from inside the page, including rejected promises, which reach Node itself.
let pageErrors = null;
process.on('unhandledRejection', (e) => { if (pageErrors) pageErrors.push(e); else throw e; });

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));

// now: the page's clock, as [year, monthIndex, day, hour, minute, second] in local time.
// stored: what localStorage holds before the page loads. hostedDb: collections served the way
// a claude.ai artifact's database serves them, instead of localStorage.
async function openPage({ now = [2026, 9, 21, 12, 0, 0], stored = null, hostedDb = null } = {}) {
  const errors = [];
  pageErrors = errors;
  const alerts = [];
  const confirms = [];
  const clock = {};
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e));
  virtualConsole.on('error', (...a) => errors.push(a.join(' ')));

  const dom = new JSDOM(HTML, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      const RealDate = window.Date;
      clock.set = (parts) => { clock.ms = new RealDate(...parts).getTime(); };
      clock.set(now);
      window.Date = class extends RealDate {
        constructor(...a) { super(...(a.length ? a : [clock.ms])); }
        static now() { return clock.ms; }
      };
      window.alert = (m) => alerts.push(String(m));
      window.confirm = (m) => { confirms.push(String(m)); return page.confirmAnswer; };
      window.scrollTo = () => {};
      if (stored) window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
      if (hostedDb) window.claude = { use: async () => fakeDb(hostedDb) };
    },
  });

  const { window } = dom;
  const page = {
    window,
    document: window.document,
    errors,
    alerts,
    confirms,
    confirmAnswer: true,
    $: (sel) => window.document.querySelector(sel),
    $$: (sel) => [...window.document.querySelectorAll(sel)],
    text: (sel) => window.document.querySelector(sel).textContent,
    // Reads a top-level name from the page's script, e.g. page.get('catOf').
    get: (name) => window.eval(name),
    stored: () => JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}'),
    count: (col) => Object.keys(page.stored()[col] || {}).length,
    setClock: clock.set,
    button: (label) => page.$$('button').find((b) => b.textContent.trim() === label),
    async click(label) { page.button(label).click(); await wait(); },
    // Picks a file in the "Import JSON" box, as a person would.
    async importJSON(content, name = 'import.json') {
      const input = page.$('#toolbar input[type=file]');
      const text = typeof content === 'string' ? content : JSON.stringify(content);
      const file = new window.File([text], name, { type: 'application/json' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new window.Event('change'));
      await wait(50);
    },
    close() { pageErrors = null; window.close(); },
  };
  await wait();
  return page;
}

// The page's storage interface (collection().onSnapshot / doc().set / delete), backed by plain
// objects: { days: { id: doc }, sessions: {...}, runs: {...} }.
function fakeDb(data) {
  return {
    collection(name) {
      return {
        onSnapshot(fn) {
          fn({ docs: Object.entries(data[name] || {}).map(([id, v]) => ({ id, data: () => v })) });
          return () => {};
        },
        doc() { return { async set() {}, async delete() {} }; },
      };
    },
  };
}

module.exports = { openPage, wait, PAGE, HTML };
