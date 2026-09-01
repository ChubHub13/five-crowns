const assert = require('assert');
const fs = require('fs');
const { buildDeck, meldType, analyzeHand, bestDiscard, cardPoints, isWild, decodeSaveCode } = require('./server');

const card = (id, suit, rank, joker = false) => ({ id, suit: joker ? 'joker' : suit, rank: joker ? 0 : rank, joker, deck: 0 });

const deck = buildDeck();
assert.strictEqual(deck.length, 116, 'Two complete 58-card decks are required.');
assert.strictEqual(deck.filter(item => item.joker).length, 6, 'The combined deck must contain six Jokers.');
for (const suit of ['stars', 'hearts', 'clubs', 'spades', 'diamonds']) {
  assert.strictEqual(deck.filter(item => item.suit === suit).length, 22, `${suit} must contain two copies of every rank.`);
}

assert.strictEqual(meldType([card('a','stars',7),card('b','hearts',7),card('c','clubs',7)],3),'book');
assert.strictEqual(meldType([card('a','hearts',5),card('b','hearts',6),card('c','hearts',7)],3),'run');
assert.strictEqual(meldType([card('a','hearts',5),card('wild','clubs',4),card('c','hearts',7)],4),'run');
assert.strictEqual(meldType([card('a','hearts',5),card('b','clubs',6),card('c','hearts',7)],3),null);
assert.strictEqual(meldType([card('j1','',0,true),card('j2','',0,true),card('w','clubs',4)],4),'wild');

const perfect = [
  card('s5','spades',5),card('s6','spades',6),card('s7','spades',7),
  card('d9','diamonds',9),card('h9','hearts',9),card('c9','clubs',9)
];
assert.strictEqual(analyzeHand(perfect,3).penalty,0,'A complete run and book should go out.');

const withWildGap = [card('s5','stars',5),card('s7','stars',7),card('wild6','hearts',6)];
assert.strictEqual(analyzeHand(withWildGap,6).penalty,0,'A rotating wild should fill a run gap.');

const deadwood = [...perfect,card('queen','clubs',12),card('joker','',0,true)];
const scored = analyzeHand(deadwood,3);
assert.strictEqual(scored.penalty,12,'A Joker should be absorbed into an existing meld, leaving only the Queen.');
assert.strictEqual(scored.deadwood.length,1);
assert.strictEqual(analyzeHand([card('queen2','clubs',12),card('joker2','',0,true)],3).penalty,62,'Unmatched Queen and Joker score 62.');

assert.strictEqual(cardPoints(card('wild','hearts',8),8),20);
assert.strictEqual(cardPoints(card('joker','',0,true),8),50);
assert.strictEqual(isWild(card('king','stars',13),13),true);

const discardChoice = bestDiscard([...perfect,card('king','clubs',13)],3);
assert.strictEqual(discardChoice.card.id,'king','The bot should discard isolated high deadwood.');
assert.strictEqual(discardChoice.analysis.penalty,0);

const client = fs.readFileSync(require.resolve('./index.html'), 'utf8');
assert.match(client,/button\.onmousedown=/,'Human cards must support direct mouse dragging.');
assert.match(client,/moveDraggedCard\(drag\.targetId/,'A completed pointer drag must update the saved hand order.');
assert.match(client,/HAND_ORDER_KEY/,'The chosen card order must survive normal state polling.');
assert.match(client,/button\.card:hover[^}]+transform:none/,'Hovering a hand card must not move it.');
assert.match(client,/button\.card\.selected:hover[^}]+translateY\(-16px\)/,'A selected card must stay steady when hovered.');
assert.doesNotMatch(client,/finalTurnAlert/,'The duplicate red final-turn banner must stay removed.');
assert.match(client,/round-event-pop 3s/,'The last-turn popup animation must last three seconds.');
assert.match(client,/classList\.remove\("show"\);},3000\)/,'The last-turn popup must close after three seconds.');
assert.match(client,/round-event[^}]+rgba\(18,102,64,\.84\)[^}]+rgba\(8,43,30,\.84\)/,'The last-turn popup must be translucent enough to see the discard pile beneath it.');
assert.match(client,/innerHTML=`LAST TURN/,'The went-out announcement must clearly say LAST TURN.');
assert.match(client,/choose your player\/i\.test\(error\.message\)/,'An expired saved session must return the visitor to player selection.');
assert.match(client,/id="saveGameButton"/,'The sidebar must provide a Save Game button.');
assert.match(client,/id="loadGameButton"/,'The sidebar must provide a Resume Game button.');
assert.match(client,/drawn&&!isWild\(drawn,state\.data\)\?drawn\.id:null/,'A newly drawn normal card must start selected while a wild card stays down.');
assert.doesNotMatch(client,/add\("Sort Cards"/,'Sorting must happen automatically without a Sort Cards button.');
assert.match(client,/if\(aWild!==bWild\)return aWild\?1:-1/,'Sorting must place wild cards on the right.');
assert.match(client,/if\(newRound\)\{sortHandOrder/,'The full hand must sort only at the start of a round.');
assert.match(client,/else if\(newDraw\)\{insertDrawnCardOrder/,'A draw must insert only the new card without sorting the existing cards.');
assert.match(client,/const existingIds=state\.handOrder\.filter/,'A player\'s custom card order must remain intact after drawing.');
assert.match(client,/id="handPoints"/,'The player hand must include a private current-points display.');
assert.match(client,/desired=card\.right-zone\.left\+card\.width/,'The hand-points badge must sit one card width to the right of the cards.');
assert.match(client,/requestAnimationFrame\(positionHandPoints\)/,'The hand-points position must update after every hand render.');
assert.doesNotMatch(client,/Review Table/,'The final score popup must not offer Review Table.');
assert.match(client,/async function animateDiscard\(cardId\)/,'Discarding must animate the selected card toward the discard pile.');
assert.match(client,/if\(action\.action==="discard"\)await animateDiscard\(action\.cardId\)/,'The discard animation must complete before the server updates the hand.');
assert.doesNotMatch(client,/Selected discard|Select one card to discard|Waiting for/,'The bottom controls must not include instructional status text.');
const serverSource = fs.readFileSync(require.resolve('./server.js'), 'utf8');
assert.match(serverSource,/handPoints: seat >= 0 && game\.round \? analyzeHand\(ownHand, wildRank\(\)\)\.penalty : null/,'The server must expose only the requesting player\'s current hand points.');
assert.doesNotMatch(serverSource,/handPoints:\s*game\.hands\.map/,'The server must never expose every player\'s private hand points.');
assert.strictEqual(decodeSaveCode('not-a-save'),null,'Invalid save codes must be rejected.');

console.log('Five Crowns rule-engine tests passed.');
