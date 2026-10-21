// Getting data in: Import JSON, and data that is already saved. The rule: nothing that's saved is
// lost without the person saying yes, and one bad row never takes the page down.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openPage } = require('./page.js');

const DAY = { date: '2026-10-20', weight: 190, calIn: 1500, calOut: 2500 };

async function withSample(fn) {
  const page = await openPage();
  try {
    await page.click('Load sample data');
    assert.equal(page.count('days'), 45, 'the sample should start with 45 days');
    await fn(page);
  } finally { page.close(); }
}

test('a file with no ledger data in it leaves saved data alone and says why', () => withSample(async (page) => {
  await page.importJSON({ hello: 'world' });
  assert.equal(page.count('days'), 45);
  assert.equal(page.count('sessions'), 39);
  assert.equal(page.count('runs'), 24);
  assert.equal(page.alerts.length, 1, 'the person is told nothing was imported');
  assert.match(page.alerts[0], /no days, sessions or runs/);
}));

test('a good file asks before replacing saved data, and Cancel keeps the old data', () => withSample(async (page) => {
  page.confirmAnswer = false;
  await page.importJSON({ days: [DAY] }, 'other.json');
  assert.equal(page.confirms.length, 1, 'asked before replacing');
  assert.match(page.confirms[0], /45 days/, 'the question says what would be replaced');
  assert.equal(page.count('days'), 45);
}));

test('a good file replaces saved data once the person says yes', () => withSample(async (page) => {
  await page.importJSON({ days: [DAY] });
  assert.equal(page.count('days'), 1);
  assert.equal(page.text('#sd-scale'), '190.0');
}));

test('the sample-data.json in this repo passes the import checks', async () => {
  const page = await openPage();
  try {
    const text = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'sample-data.json'), 'utf8');
    await page.importJSON(text, 'sample-data.json');
    assert.deepEqual(page.alerts, []);
    assert.equal(page.count('days'), 45);
    assert.deepEqual(page.errors, []);
  } finally { page.close(); }
});

test('a file with one bad row is refused whole, and nothing is saved', () => withSample(async (page) => {
  await page.importJSON({
    days: [DAY],
    sessions: [{ date: '2026-10-20', focus: 'Arms', exercises: [{ weight: 40, sets: 3, reps: 10 }] }],
  });
  assert.equal(page.count('days'), 45, 'the saved data is untouched');
  assert.equal(page.alerts.length, 1);
  assert.match(page.alerts[0], /exercise 1 has no name/, 'the message names the bad row');
  assert.deepEqual(page.errors, []);
}));

// The same bad row, already saved (by an older version of the page, or by an assistant writing to
// the artifact's database). The page should show everything else and say what it skipped.
const BAD_ROW = {
  days: { '2026-10-20': DAY },
  sessions: { '2026-10-20': { date: '2026-10-20', focus: 'Arms', exercises: [{ weight: 40, sets: 3, reps: 10 }, { name: 'Curl', weight: 30, sets: 3, reps: 10 }] } },
  runs: { 'no-date': { miles: 2 } },
};

test('a bad row already saved in this browser does not break the page', async () => {
  const page = await openPage({ stored: BAD_ROW });
  try {
    assert.deepEqual(page.errors, []);
    assert.equal(page.text('#sd-scale'), '190.0');
    assert.match(page.text('#day'), /Curl/, 'the good lift on that day still shows');
    assert.match(page.text('#data-note'), /exercise 1 has no name/);
    assert.match(page.text('#data-note'), /needs a date/);
  } finally { page.close(); }
});

test('a bad row in the claude.ai database does not break the page either', async () => {
  const page = await openPage({ hostedDb: BAD_ROW });
  try {
    assert.deepEqual(page.errors, []);
    assert.equal(page.text('#sd-scale'), '190.0');
    assert.match(page.text('#day'), /Curl/);
  } finally { page.close(); }
});

test('numbers saved as text are read as numbers, and a word in a number field is reported', async () => {
  const page = await openPage({
    stored: {
      days: { '2026-10-20': { date: '2026-10-20', weight: '190.5', calIn: '1500', calOut: 2500 } },
      sessions: { '2026-10-20': { date: '2026-10-20', focus: 'Arms', exercises: [{ name: 'Curl', weight: 'BW', sets: '3', reps: 10 }] } },
    },
  });
  try {
    assert.deepEqual(page.errors, []);
    assert.equal(page.text('#sd-scale'), '190.5');
    assert.match(page.text('#day'), /1,000\s*Deficit/, '"1500" counted as 1,500 calories in');
    assert.match(page.text('#data-note'), /weight “BW” isn’t a number/);
  } finally { page.close(); }
});

test('two runs on the same day are both kept when a file lists them', async () => {
  const page = await openPage();
  try {
    await page.importJSON({
      days: [DAY],
      runs: [{ date: '2026-10-20', miles: 3, pace: '9:00' }, { date: '2026-10-20', miles: 2, pace: '8:30' }],
    });
    assert.equal(page.count('runs'), 2);
    assert.match(page.text('#day'), /5\.00 mi/, 'the day adds up both runs');
  } finally { page.close(); }
});

test('two entries for the same day in one file are refused, not silently merged', async () => {
  const page = await openPage();
  try {
    await page.importJSON({ days: [DAY, { ...DAY, weight: 189 }] });
    assert.equal(page.count('days'), 0);
    assert.match(page.alerts[0] || '', /2026-10-20 is listed twice in days/);
  } finally { page.close(); }
});
