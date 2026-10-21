// Smaller things that still matter before the page goes public: it makes no outside requests, food
// and exercises are sorted into the right groups, and "today" moves on at midnight.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { openPage, HTML } = require('./page.js');

test('the page loads nothing from other sites (the README says nothing is sent anywhere)', () => {
  const { document } = new JSDOM(HTML).window;
  const outside = (u) => /^(https?:)?\/\//i.test(u || '');
  const urls = [
    ...[...document.querySelectorAll('link[href]')].map((e) => e.getAttribute('href')),
    ...[...document.querySelectorAll('script[src], img[src]')].map((e) => e.getAttribute('src')),
  ];
  assert.deepEqual(urls.filter(outside), []);
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  assert.doesNotMatch(css, /@import|url\(\s*['"]?(https?:)?\/\//i);
});

test('foods land in the group a person would expect', async () => {
  const page = await openPage();
  try {
    const catOf = page.get('catOf');
    assert.equal(catOf('Cottage cheese, 1 cup'), 'Dairy & eggs');
    assert.equal(catOf('Sweet potato'), 'Grains & starches');
    assert.equal(catOf('Chocolate chip cookie'), 'Sweets');
    assert.equal(catOf('Milkshake'), 'Sweets');
    assert.equal(catOf('Chocolate protein shake'), 'Protein shakes & bars');
    assert.equal(catOf('Cheeseburger'), 'Takeout & fast food');
  } finally { page.close(); }
});

test('every food in the sample data lands in a named group, not Other', async () => {
  const page = await openPage();
  try {
    await page.click('Load sample data');
    const catOf = page.get('catOf');
    const items = new Set(Object.values(page.stored().days).flatMap((d) => d.food.map((f) => f.item)));
    assert.deepEqual([...items].filter((i) => catOf(i) === 'Other'), []);
  } finally { page.close(); }
});

test('a person can add their own food words in config, keeping them out of the code', async () => {
  const page = await openPage();
  try {
    page.get('applyConfig')({ foodWords: { Sweets: ['froyo'], 'Late night': ['midnight snack'] } });
    const catOf = page.get('catOf');
    assert.equal(catOf('Froyo, small'), 'Sweets');
    assert.equal(catOf('Midnight snack'), 'Late night', 'a new group can be added too');
    assert.equal(catOf('Banana'), 'Fruit & veg', 'the built-in groups still apply');
  } finally { page.close(); }
});

// Which exercise-library card a logged lift counts toward ("Done" on the card, and its history).
// The arrays are copied out of the page so deepEqual compares plain Node arrays.
async function cardsFor(names) {
  const page = await openPage();
  try {
    const LIB = page.get('LIB');
    return Object.fromEntries(names.map((n) => [n, [...LIB.filter((x) => x.m.test(n.toLowerCase())).map((x) => x.n)]]));
  } finally { page.close(); }
}

test('each library exercise, logged by its own name, counts toward its own card only', async () => {
  const page = await openPage();
  const names = page.get('LIB').map((x) => x.n);
  page.close();
  const cards = await cardsFor(names);
  assert.deepEqual(Object.entries(cards).filter(([n, c]) => c.length !== 1 || c[0] !== n), []);
});

test('lifts with similar names count toward the right card', async () => {
  const expected = {
    'Hanging knee raise': 'Hanging knee raise',
    'Dead hang': 'Dead hang',
    'Face pull (rope)': 'Face pull',
    'Cable tricep pushdown': 'Rope pushdown',
    'Lateral raise (per arm)': 'Lateral raise',
    'Cable lateral raise': 'Cable lateral raise',
    'Bayesian cable curl': 'Bayesian cable curl',
    'Incline DB curl': 'Incline dumbbell curl',
    'Reverse EZ bar curl': 'Reverse curl',
    'Wide-grip lat pulldown': 'Lat pulldown',
  };
  const cards = await cardsFor(Object.keys(expected));
  assert.deepEqual(cards, Object.fromEntries(Object.entries(expected).map(([n, c]) => [n, [c]])));
});

test('"today" moves on at midnight when the page was left open', async () => {
  const page = await openPage({
    now: [2026, 9, 20, 23, 59, 30],
    stored: { days: { '2026-10-20': { date: '2026-10-20', calIn: 1500, calOut: 2500 }, '2026-10-21': { date: '2026-10-21', calIn: 1400, calOut: 2400 } } },
  });
  try {
    assert.match(page.$('.cell.today').getAttribute('aria-label'), /October 20/);
    page.setClock([2026, 9, 21, 0, 0, 30]);
    page.document.dispatchEvent(new page.window.Event('visibilitychange'));
    assert.match(page.$('.cell.today').getAttribute('aria-label'), /October 21/);
  } finally { page.close(); }
});
