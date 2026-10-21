// The numbers the page works out: lift PRs, which logged lifts count as the same lift, and the
// model weight. The page's clock is Oct 21, 2026, so it opens on the last logged day, Oct 20.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openPage } = require('./page.js');

const day = (date, more) => ({ date, calIn: 1500, calOut: 2500, ...more });
const lift = (name, weight) => ({ name, weight, sets: 3, reps: 10 });

// The rows of the open day's Lifts table, as { name, weight, pr }.
function liftRows(page) {
  const lifts = page.$$('#day .panel')[0];
  return [...lifts.querySelectorAll('tbody tr')].map((tr) => ({
    name: tr.cells[0].firstChild.textContent,
    weight: tr.cells[1].textContent,
    pr: !!tr.querySelector('.pr'),
  }));
}

test('a PR is marked when the heavier set is not the first time the lift appears that day', async () => {
  const page = await openPage({
    stored: {
      days: { '2026-10-13': day('2026-10-13'), '2026-10-20': day('2026-10-20') },
      sessions: {
        '2026-10-13': { date: '2026-10-13', focus: 'Arms', exercises: [lift('Curl', 45)] },
        '2026-10-20': { date: '2026-10-20', focus: 'Arms', exercises: [lift('Curl', 40), lift('Curl', 50)] },
      },
    },
  });
  try {
    assert.deepEqual(liftRows(page), [
      { name: 'Curl', weight: '40 lb', pr: false },
      { name: 'Curl', weight: '50 lb', pr: true },
    ]);
  } finally { page.close(); }
});

test('only the top set of a session can be its PR', async () => {
  const page = await openPage({
    stored: {
      days: { '2026-10-13': day('2026-10-13'), '2026-10-20': day('2026-10-20') },
      sessions: {
        '2026-10-13': { date: '2026-10-13', focus: 'Arms', exercises: [lift('Curl', 45)] },
        '2026-10-20': { date: '2026-10-20', focus: 'Arms', exercises: [lift('Curl', 50), lift('Curl', 55)] },
      },
    },
  });
  try {
    assert.deepEqual(liftRows(page).map((r) => r.pr), [false, true]);
  } finally { page.close(); }
});

test('the same lift typed with different capitals or spaces is one lift', async () => {
  const page = await openPage({
    stored: {
      days: { '2026-10-13': day('2026-10-13'), '2026-10-20': day('2026-10-20') },
      sessions: {
        '2026-10-13': { date: '2026-10-13', focus: 'Arms', exercises: [lift('EZ bar curl', 45)] },
        '2026-10-20': { date: '2026-10-20', focus: 'Arms', exercises: [lift(' EZ Bar  Curl', 50)] },
      },
    },
  });
  try {
    assert.equal(liftRows(page)[0].pr, true, '50 beats the 45 logged under the other spelling');
    page.$('#tab-search').click();
    const rows = page.$$('#results .lift-row');
    assert.equal(rows.length, 1, 'one entry in All lifts');
    assert.match(rows[0].textContent, /^EZ Bar Curl2 sessions/, 'shown with the latest spelling, tidied');
  } finally { page.close(); }
});

test('before the first weigh-in there is no model weight and no goal reached', async () => {
  const page = await openPage({
    stored: { days: { '2026-10-19': day('2026-10-19'), '2026-10-20': day('2026-10-20', { calIn: 1700 }) } },
  });
  try {
    assert.equal(page.text('#sd-model'), '–');
    page.$('#tab-trends').click();
    const goal = page.text('#goal');
    assert.doesNotMatch(goal, /Done/);
    assert.doesNotMatch(goal, /on pace/);
    assert.match(goal, /weigh-in/, 'says what is missing');
  } finally { page.close(); }
});

test('the model starts at the first weigh-in even when earlier days have no weight', async () => {
  const page = await openPage({
    stored: {
      days: {
        '2026-10-18': day('2026-10-18'),
        '2026-10-19': day('2026-10-19', { weight: 200 }),
        '2026-10-20': day('2026-10-20'),
      },
    },
  });
  try {
    // 200, less Oct 19's 1,000 deficit (0.29 lb) on Oct 20, less Oct 20's on the morning of Oct 21.
    assert.equal(page.text('#sd-model'), '199.4');
    page.$('#tab-trends').click();
    assert.match(page.text('#goal'), /from 200\.0 to 180/);
  } finally { page.close(); }
});
