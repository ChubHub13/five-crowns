const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const VERSION = '2.0.15';
const PLAYER_NAMES = ['Daryl', 'Cristi', 'Cindy'];
const SUITS = ['stars', 'hearts', 'clubs', 'spades', 'diamonds'];
const RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const FINAL_ROUND = 11;
const PLAYER_TIMEOUT_MS = 12000;
const BOT_DELAY_MS = Math.max(5, Number(process.env.BOT_DELAY_MS || 550));
const sessions = new Map();
let botTimer = null;

const game = {
  version: VERSION,
  phase: 'waiting',
  round: 0,
  dealer: 2,
  turn: 0,
  turnStage: 'draw',
  scores: [0, 0, 0],
  hands: [[], [], []],
  laidDown: [[], [], []],
  stock: [],
  discard: [],
  drawnCardId: null,
  outPlayer: null,
  finalTurns: [],
  lastRound: null,
  roundHistory: [],
  winnerSeats: [],
  firstHandThreeTurns: true,
  completedTurns: [0, 0, 0],
  live: [false, false, false],
  bot: [true, true, true],
  lastSeen: [0, 0, 0],
  chat: [],
  prompt: 'Choose Daryl, Cristi, or Cindy to begin.'
};

function randomToken() {
  return crypto.randomBytes(20).toString('hex');
}

function shuffle(cards) {
  const copy = cards.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function rankLabel(rank) {
  return rank === 11 ? 'J' : rank === 12 ? 'Q' : rank === 13 ? 'K' : String(rank);
}

function buildDeck() {
  const cards = [];
  for (let deck = 0; deck < 2; deck++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push({ id: `d${deck}-${suit}-${rank}`, deck, suit, rank, joker: false });
    }
    for (let joker = 0; joker < 3; joker++) cards.push({ id: `d${deck}-joker-${joker}`, deck, suit: 'joker', rank: 0, joker: true });
  }
  return cards;
}

function wildRank(round = game.round) {
  return round + 2;
}

function isWild(card, currentWild = wildRank()) {
  return Boolean(card?.joker || card?.rank === currentWild);
}

function cardPoints(card, currentWild = wildRank()) {
  if (card.joker) return 50;
  if (card.rank === currentWild) return 20;
  return card.rank;
}

function sortHand(hand, currentWild = wildRank()) {
  const suitOrder = Object.fromEntries(SUITS.map((suit, index) => [suit, index]));
  hand.sort((a, b) => {
    const wildDifference = Number(isWild(b, currentWild)) - Number(isWild(a, currentWild));
    if (wildDifference) return wildDifference;
    const suitDifference = (suitOrder[a.suit] ?? 9) - (suitOrder[b.suit] ?? 9);
    return suitDifference || a.rank - b.rank || a.deck - b.deck;
  });
}

function meldType(cards, currentWild) {
  if (!Array.isArray(cards) || cards.length < 3) return null;
  const natural = cards.filter(card => !isWild(card, currentWild));
  if (!natural.length) return 'wild';
  if (natural.every(card => card.rank === natural[0].rank)) return 'book';
  if (!natural.every(card => card.suit === natural[0].suit)) return null;
  const ranks = natural.map(card => card.rank);
  if (new Set(ranks).size !== ranks.length) return null;
  const minimum = Math.min(...ranks);
  const maximum = Math.max(...ranks);
  const length = cards.length;
  const earliestStart = Math.max(3, maximum - length + 1);
  const latestStart = Math.min(minimum, 13 - length + 1);
  return earliestStart <= latestStart ? 'run' : null;
}

function analyzeHand(hand, currentWild = wildRank()) {
  const cards = hand.map(card => ({ ...card }));
  const count = cards.length;
  if (!count) return { penalty: 0, melds: [], deadwood: [] };
  const fullMask = (1 << count) - 1;
  const validMelds = [];
  for (let mask = 1; mask <= fullMask; mask++) {
    let size = 0;
    for (let bits = mask; bits; bits &= bits - 1) size++;
    if (size < 3) continue;
    const subset = cards.filter((_, index) => mask & (1 << index));
    const type = meldType(subset, currentWild);
    if (type) validMelds.push({ mask, type });
  }
  const byCard = Array.from({ length: count }, () => []);
  for (const meld of validMelds) {
    for (let index = 0; index < count; index++) if (meld.mask & (1 << index)) byCard[index].push(meld);
  }
  const memo = new Map();
  function solve(mask) {
    if (!mask) return { penalty: 0, melds: [] };
    if (memo.has(mask)) return memo.get(mask);
    let first = 0;
    while (!(mask & (1 << first))) first++;
    const withoutFirst = mask & ~(1 << first);
    const deadwoodResult = solve(withoutFirst);
    let best = { penalty: cardPoints(cards[first], currentWild) + deadwoodResult.penalty, melds: deadwoodResult.melds };
    for (const meld of byCard[first]) {
      if ((meld.mask & mask) !== meld.mask) continue;
      const result = solve(mask ^ meld.mask);
      const candidate = { penalty: result.penalty, melds: [{ ...meld }, ...result.melds] };
      if (candidate.penalty < best.penalty || (candidate.penalty === best.penalty && candidate.melds.length < best.melds.length)) best = candidate;
    }
    memo.set(mask, best);
    return best;
  }
  const solved = solve(fullMask);
  const usedMask = solved.melds.reduce((mask, meld) => mask | meld.mask, 0);
  return {
    penalty: solved.penalty,
    melds: solved.melds.map(meld => ({ type: meld.type, cards: cards.filter((_, index) => meld.mask & (1 << index)) })),
    deadwood: cards.filter((_, index) => !(usedMask & (1 << index)))
  };
}

function bestDiscard(hand, currentWild = wildRank()) {
  let best = null;
  for (let index = 0; index < hand.length; index++) {
    const card = hand[index];
    const remaining = hand.filter((_, cardIndex) => cardIndex !== index);
    const analysis = analyzeHand(remaining, currentWild);
    const candidate = { card, analysis };
    if (!best
      || analysis.penalty < best.analysis.penalty
      || (analysis.penalty === best.analysis.penalty && Number(isWild(best.card, currentWild)) > Number(isWild(card, currentWild)))
      || (analysis.penalty === best.analysis.penalty && isWild(best.card, currentWild) === isWild(card, currentWild) && cardPoints(card, currentWild) > cardPoints(best.card, currentWild))) {
      best = candidate;
    }
  }
  return best;
}

function ensureStock() {
  if (game.stock.length) return true;
  if (game.discard.length <= 1) return false;
  const top = game.discard.pop();
  game.stock = shuffle(game.discard);
  game.discard = [top];
  return true;
}

function resetToWaiting() {
  clearTimeout(botTimer);
  game.phase = 'waiting';
  game.round = 0;
  game.dealer = 2;
  game.turn = 0;
  game.turnStage = 'draw';
  game.scores = [0, 0, 0];
  game.hands = [[], [], []];
  game.laidDown = [[], [], []];
  game.stock = [];
  game.discard = [];
  game.drawnCardId = null;
  game.outPlayer = null;
  game.finalTurns = [];
  game.lastRound = null;
  game.roundHistory = [];
  game.winnerSeats = [];
  game.firstHandThreeTurns = true;
  game.completedTurns = [0, 0, 0];
  game.prompt = 'Choose Daryl, Cristi, or Cindy to begin.';
}

function dealRound() {
  clearTimeout(botTimer);
  if (game.round >= FINAL_ROUND) return false;
  if (game.round > 0) game.dealer = (game.dealer + 1) % 3;
  game.round += 1;
  const cardsPerPlayer = game.round + 2;
  game.stock = shuffle(buildDeck());
  game.hands = [[], [], []];
  game.laidDown = [[], [], []];
  for (let card = 0; card < cardsPerPlayer; card++) {
    for (let offset = 1; offset <= 3; offset++) game.hands[(game.dealer + offset) % 3].push(game.stock.pop());
  }
  game.hands.forEach(hand => sortHand(hand));
  game.discard = [game.stock.pop()];
  game.turn = (game.dealer + 1) % 3;
  game.turnStage = 'draw';
  game.drawnCardId = null;
  game.outPlayer = null;
  game.finalTurns = [];
  game.lastRound = null;
  game.winnerSeats = [];
  game.completedTurns = [0, 0, 0];
  game.phase = 'playing';
  game.prompt = `${PLAYER_NAMES[game.turn]} draws first. ${rankLabel(wildRank())}s are wild.`;
  scheduleBot();
  return true;
}

function startGame() {
  game.scores = [0, 0, 0];
  game.round = 0;
  game.dealer = 2;
  game.roundHistory = [];
  game.lastRound = null;
  game.winnerSeats = [];
  game.completedTurns = [0, 0, 0];
  return dealRound();
}

const SAVE_FIELDS = ['phase', 'round', 'dealer', 'turn', 'turnStage', 'scores', 'hands', 'laidDown', 'stock', 'discard', 'drawnCardId', 'outPlayer', 'finalTurns', 'lastRound', 'roundHistory', 'winnerSeats', 'bot', 'chat', 'prompt'];

function createSaveCode() {
  const snapshot = { saveVersion: 1, gameVersion: VERSION, savedAt: Date.now() };
  for (const field of SAVE_FIELDS) snapshot[field] = game[field];
  return Buffer.from(JSON.stringify(snapshot), 'utf8').toString('base64url');
}

function decodeSaveCode(saveCode) {
  if (typeof saveCode !== 'string' || !saveCode || saveCode.length > 100000) return null;
  try {
    const snapshot = JSON.parse(Buffer.from(saveCode, 'base64url').toString('utf8'));
    const validPhase = ['playing', 'roundEnd', 'gameover'].includes(snapshot?.phase);
    const validRound = Number.isInteger(snapshot?.round) && snapshot.round >= 1 && snapshot.round <= FINAL_ROUND;
    const threeHands = Array.isArray(snapshot?.hands) && snapshot.hands.length === 3 && snapshot.hands.every(Array.isArray);
    const threeScores = Array.isArray(snapshot?.scores) && snapshot.scores.length === 3 && snapshot.scores.every(Number.isFinite);
    const threeBots = Array.isArray(snapshot?.bot) && snapshot.bot.length === 3 && snapshot.bot.every(value => typeof value === 'boolean');
    const validTurn = Number.isInteger(snapshot?.turn) && snapshot.turn >= 0 && snapshot.turn < 3;
    if (snapshot?.saveVersion !== 1 || !validPhase || !validRound || !threeHands || !threeScores || !threeBots || !validTurn || !Array.isArray(snapshot.stock) || !Array.isArray(snapshot.discard)) return null;
    return snapshot;
  } catch (error) {
    return null;
  }
}

function restoreSavedGame(saveCode, loadingSeat) {
  const snapshot = decodeSaveCode(saveCode);
  if (!snapshot) return false;
  clearTimeout(botTimer);
  const restored = JSON.parse(JSON.stringify(snapshot));
  for (const field of SAVE_FIELDS) game[field] = restored[field];
  game.live = [false, false, false];
  game.lastSeen = [0, 0, 0];
  game.live[loadingSeat] = true;
  game.bot[loadingSeat] = false;
  game.lastSeen[loadingSeat] = Date.now();
  scheduleBot();
  return true;
}

function drawCard(seat, source) {
  if (game.phase !== 'playing' || game.turn !== seat || game.turnStage !== 'draw') return false;
  let card = null;
  if (source === 'discard') {
    if (!game.discard.length) return false;
    card = game.discard.pop();
  } else {
    if (!ensureStock()) return false;
    card = game.stock.pop();
  }
  game.hands[seat].push(card);
  sortHand(game.hands[seat]);
  game.drawnCardId = card.id;
  game.turnStage = 'discard';
  game.prompt = `${PLAYER_NAMES[seat]} chooses a discard.`;
  return true;
}

function mayGoOutAfterThisTurn(seat) {
  if (!game.firstHandThreeTurns || game.round !== 1) return true;
  return game.completedTurns.every((turns, player) => player === seat ? turns >= 2 : turns >= 3);
}

function goOutDiscardIds(seat) {
  if (game.phase !== 'playing' || game.turn !== seat || game.turnStage !== 'discard' || game.outPlayer !== null) return [];
  if (!mayGoOutAfterThisTurn(seat)) return [];
  return game.hands[seat]
    .filter(card => analyzeHand(game.hands[seat].filter(item => item.id !== card.id), wildRank()).penalty === 0)
    .map(card => card.id);
}

function nextFinalPlayer(afterSeat) {
  for (let step = 1; step <= 3; step++) {
    const seat = (afterSeat + step) % 3;
    if (game.finalTurns.includes(seat)) return seat;
  }
  return null;
}

function discardCard(seat, cardId, declareOut = false) {
  if (game.phase !== 'playing' || game.turn !== seat || game.turnStage !== 'discard') return false;
  const index = game.hands[seat].findIndex(card => card.id === cardId);
  if (index < 0) return false;
  if (declareOut && !goOutDiscardIds(seat).includes(cardId)) return false;
  const [discarded] = game.hands[seat].splice(index, 1);
  game.discard.push(discarded);
  game.drawnCardId = null;
  game.completedTurns[seat] += 1;

  if (declareOut && game.outPlayer === null) {
    const analysis = analyzeHand(game.hands[seat], wildRank());
    game.laidDown[seat] = analysis.melds;
    game.hands[seat] = [];
    game.outPlayer = seat;
    game.finalTurns = [0, 1, 2].filter(player => player !== seat);
    game.prompt = `${PLAYER_NAMES[seat]} went out. Everyone else gets one final turn.`;
  } else if (game.outPlayer !== null) {
    game.finalTurns = game.finalTurns.filter(player => player !== seat);
  }

  if (game.outPlayer !== null && !game.finalTurns.length) {
    scoreRound();
    return true;
  }

  game.turn = game.outPlayer === null ? (seat + 1) % 3 : nextFinalPlayer(seat);
  game.turnStage = 'draw';
  game.prompt = game.outPlayer === null
    ? `${PLAYER_NAMES[game.turn]}'s turn to draw.`
    : `${PLAYER_NAMES[game.turn]} takes a final turn.`;
  scheduleBot();
  return true;
}

function scoreRound() {
  clearTimeout(botTimer);
  const results = [0, 1, 2].map(seat => {
    if (seat === game.outPlayer) {
      return { seat, name: PLAYER_NAMES[seat], points: 0, melds: game.laidDown[seat], deadwood: [] };
    }
    const analysis = analyzeHand(game.hands[seat], wildRank());
    return { seat, name: PLAYER_NAMES[seat], points: analysis.penalty, melds: analysis.melds, deadwood: analysis.deadwood };
  });
  for (const result of results) game.scores[result.seat] += result.points;
  game.lastRound = {
    round: game.round,
    cardsPerPlayer: game.round + 2,
    wildRank: wildRank(),
    outPlayer: game.outPlayer,
    results,
    totals: game.scores.slice()
  };
  game.roundHistory.push(game.lastRound);
  game.hands = [[], [], []];
  if (game.round >= FINAL_ROUND) {
    const lowScore = Math.min(...game.scores);
    game.winnerSeats = game.scores.map((score, seat) => score === lowScore ? seat : -1).filter(seat => seat >= 0);
    game.phase = 'gameover';
    game.prompt = game.winnerSeats.length === 1
      ? `${PLAYER_NAMES[game.winnerSeats[0]]} wins with ${lowScore} points.`
      : `${game.winnerSeats.map(seat => PLAYER_NAMES[seat]).join(' and ')} tie with ${lowScore} points.`;
  } else {
    game.phase = 'roundEnd';
    game.prompt = `Round ${game.round} complete. ${rankLabel(wildRank(game.round + 1))}s are wild next.`;
  }
}

function botDraw(seat) {
  if (game.phase !== 'playing' || game.turn !== seat || game.turnStage !== 'draw') return;
  const currentPenalty = analyzeHand(game.hands[seat], wildRank()).penalty;
  const top = game.discard.at(-1);
  let source = 'stock';
  if (top) {
    const candidate = bestDiscard([...game.hands[seat], top], wildRank());
    if (candidate && (candidate.analysis.penalty < currentPenalty || isWild(top, wildRank()))) source = 'discard';
  }
  drawCard(seat, source);
  botTimer = setTimeout(() => botDiscard(seat), Math.max(20, BOT_DELAY_MS * 0.7));
}

function botDiscard(seat) {
  if (game.phase !== 'playing' || game.turn !== seat || game.turnStage !== 'discard') return;
  const choice = bestDiscard(game.hands[seat], wildRank());
  if (!choice) return;
  const declareOut = game.outPlayer === null && choice.analysis.penalty === 0;
  discardCard(seat, choice.card.id, declareOut);
}

function scheduleBot() {
  clearTimeout(botTimer);
  if (game.phase !== 'playing' || !game.bot[game.turn]) return;
  botTimer = setTimeout(() => botDraw(game.turn), BOT_DELAY_MS);
}

function touchSession(token) {
  const session = sessions.get(token);
  if (!session) return null;
  session.lastSeen = Date.now();
  game.lastSeen[session.seat] = session.lastSeen;
  if (!game.live[session.seat]) {
    game.live[session.seat] = true;
    game.bot[session.seat] = false;
  }
  return session;
}

function publicState(seat) {
  const ownHand = seat >= 0 ? game.hands[seat] || [] : [];
  const discardTop = game.discard.at(-1) || null;
  return {
    version: VERSION,
    phase: game.phase,
    round: game.round,
    finalRound: FINAL_ROUND,
    cardsPerPlayer: game.round ? game.round + 2 : 0,
    wildRank: game.round ? wildRank() : null,
    dealer: game.dealer,
    turn: game.turn,
    turnStage: game.turnStage,
    scores: game.scores,
    hands: [0, 1, 2].map(player => player === seat ? ownHand : []),
    handPoints: seat >= 0 && game.round ? analyzeHand(ownHand, wildRank()).penalty : null,
    handCounts: game.hands.map((hand, player) => player === game.outPlayer ? 0 : hand.length),
    stockCount: game.stock.length,
    discardTop,
    discardCount: game.discard.length,
    drawnCardId: game.turn === seat ? game.drawnCardId : null,
    outPlayer: game.outPlayer,
    finalTurns: game.finalTurns,
    goOutDiscardIds: goOutDiscardIds(seat),
    lastRound: game.lastRound,
    roundHistory: game.roundHistory.map(round => ({ round: round.round, totals: round.totals, results: round.results.map(result => ({ seat: result.seat, points: result.points })) })),
    winnerSeats: game.winnerSeats,
    firstHandThreeTurns: game.firstHandThreeTurns,
    completedTurns: game.completedTurns,
    seats: PLAYER_NAMES.map((name, player) => ({ seat: player, name, connected: game.live[player], bot: game.bot[player] })),
    chat: game.chat,
    prompt: game.prompt
  };
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 100000) request.destroy();
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

async function handleApi(request, response, url) {
  try {
    if (request.method === 'POST' && url.pathname === '/api/join') {
      const data = await readBody(request);
      const seat = PLAYER_NAMES.indexOf(String(data.name || ''));
      if (seat < 0) return json(response, 400, { ok: false, message: 'Choose Daryl, Cristi, or Cindy.' });
      const existing = data.token && sessions.get(data.token);
      const token = existing?.seat === seat ? data.token : randomToken();
      sessions.set(token, { token, seat, name: PLAYER_NAMES[seat], lastSeen: Date.now() });
      game.live[seat] = true;
      game.bot[seat] = false;
      game.lastSeen[seat] = Date.now();
      return json(response, 200, { ok: true, token, seat, name: PLAYER_NAMES[seat], state: publicState(seat) });
    }

    if (request.method === 'GET' && url.pathname === '/api/state') {
      const session = touchSession(url.searchParams.get('token'));
      if (!session) return json(response, 401, { ok: false, message: 'Choose your player again.' });
      return json(response, 200, { ok: true, state: publicState(session.seat) });
    }

    if (request.method === 'POST' && url.pathname === '/api/heartbeat') {
      const data = await readBody(request);
      const session = touchSession(data.token);
      return json(response, session ? 200 : 401, { ok: Boolean(session) });
    }

    if (request.method === 'POST' && url.pathname === '/api/save') {
      const data = await readBody(request);
      const session = touchSession(data.token);
      if (!session) return json(response, 401, { ok: false, message: 'Choose your player again.' });
      if (!['playing', 'roundEnd', 'gameover'].includes(game.phase)) return json(response, 400, { ok: false, message: 'Start a game before saving.' });
      return json(response, 200, { ok: true, saveCode: createSaveCode(), savedAt: Date.now(), state: publicState(session.seat) });
    }

    if (request.method === 'POST' && url.pathname === '/api/load') {
      const data = await readBody(request);
      const session = touchSession(data.token);
      if (!session) return json(response, 401, { ok: false, message: 'Choose your player again.' });
      if (!restoreSavedGame(data.saveCode, session.seat)) return json(response, 400, { ok: false, message: 'That saved game cannot be loaded.' });
      return json(response, 200, { ok: true, state: publicState(session.seat) });
    }

    if (request.method === 'POST' && url.pathname === '/api/action') {
      const data = await readBody(request);
      const session = touchSession(data.token);
      if (!session) return json(response, 401, { ok: false, message: 'Choose your player again.' });
      let ok = false;
      if (data.action === 'start' || data.action === 'newGame') {
        game.firstHandThreeTurns = data.firstHandThreeTurns !== false;
        ok = startGame();
      }
      else if (data.action === 'nextRound' && game.phase === 'roundEnd') ok = dealRound();
      else if (data.action === 'draw') ok = drawCard(session.seat, data.source === 'discard' ? 'discard' : 'stock');
      else if (data.action === 'discard') ok = discardCard(session.seat, String(data.cardId || ''), Boolean(data.goOut));
      else if (data.action === 'chat') {
        const text = String(data.text || '').trim().slice(0, 240);
        if (text) {
          game.chat.push({ name: session.name, text, time: Date.now() });
          game.chat = game.chat.slice(-60);
          ok = true;
        }
      }
      if (!ok) return json(response, 400, { ok: false, message: 'That move is not available now.' });
      return json(response, 200, { ok: true, state: publicState(session.seat) });
    }

    return json(response, 404, { ok: false, message: 'Not found.' });
  } catch (error) {
    return json(response, 500, { ok: false, message: error.message || 'Server error.' });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600'
    });
    return response.end();
  }
  if (url.pathname.startsWith('/api/')) return handleApi(request, response, url);
  const requested = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const filePath = path.resolve(__dirname, requested);
  if (!filePath.startsWith(path.resolve(__dirname))) {
    response.writeHead(403);
    return response.end('Forbidden');
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      return response.end('Not found');
    }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
    const type = types[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(data);
  });
});

setInterval(() => {
  const now = Date.now();
  for (let seat = 0; seat < 3; seat++) {
    if (game.live[seat] && now - game.lastSeen[seat] > PLAYER_TIMEOUT_MS) {
      game.live[seat] = false;
      game.bot[seat] = true;
      if (game.phase === 'playing' && game.turn === seat) scheduleBot();
    }
  }
}, 3000).unref();

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`Three-Handed Five Crowns v${VERSION} running at http://${HOST}:${PORT}`));
}

module.exports = { buildDeck, meldType, analyzeHand, bestDiscard, cardPoints, isWild, rankLabel, createSaveCode, decodeSaveCode, server };
