'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'five-crowns-test-'));
const historyFile = path.join(temporaryDirectory, 'score-history.json');
const scores = [10, 20, 30, 40, 50, 60].map((score, index) => ({
  name: ['Daryl', 'Cristi', 'Cindy'][index % 3],
  score,
  bot: index % 2 === 1,
  playedAt: new Date(2026, 0, index + 1).toISOString()
}));
fs.writeFileSync(historyFile, JSON.stringify(scores));
process.env.SCORE_HISTORY_FILE = historyFile;

const game = require('./server');

async function request(baseUrl, pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  assert.equal(response.ok, true, body.message);
  return body;
}

async function run() {
  assert.equal(game.buildDeck().length, 116, 'The standard two-deck shoe should remain intact.');
  assert.equal(game.rankLabel(11), 'J');
  assert.equal(game.rankLabel(13), 'K');

  await new Promise((resolve, reject) => {
    game.server.once('error', reject);
    game.server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = game.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const joined = await request(baseUrl, '/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Daryl' })
  });

  assert.deepEqual(joined.state.allTime.high.map(entry => entry.score), [60, 50, 40, 30, 20]);
  assert.deepEqual(joined.state.allTime.low.map(entry => entry.score), [10, 20, 30, 40, 50]);
  assert.equal(joined.state.allTime.high[0].bot, true);

  const renamed = await request(baseUrl, '/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: joined.token, action: 'rename', name: '  Daryl   Guest  ' })
  });
  assert.equal(renamed.state.seats[0].name, 'Daryl Guest');

  const reset = await request(baseUrl, '/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: joined.token, action: 'resetScores' })
  });
  assert.deepEqual(reset.state.allTime, { high: [], low: [] });
  assert.deepEqual(JSON.parse(fs.readFileSync(historyFile, 'utf8')), []);
}

run()
  .then(() => console.log('Five Crowns tests passed.'))
  .finally(() => {
    game.server.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
