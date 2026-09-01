# Three-Handed Five Crowns v2.0.8

A local three-player Five Crowns game for Daryl, Cristi, and Cindy. It preserves the fixed-player, live-seat, bot-fallback, chat, settings, table, sound, animation, and score-popup structure of the earlier three-handed card game while replacing the Rook rules and deck.

## Start locally

```text
npm start
```

Open `http://127.0.0.1:8080/` in a browser. Each person chooses Daryl, Cristi, or Cindy. Any unclaimed player becomes a bot when the game starts.

## Implemented rules

- Two 58-card decks: five suits numbered 3 through King, plus three Jokers per deck.
- Eleven rounds, dealing 3 cards in Round 1 and increasing to 13 cards in Round 11.
- Jokers are always wild. The rank matching the cards dealt is also wild, from 3s through Kings.
- A turn draws from the stock or takes the top discard, then discards one card.
- Books contain at least three cards of one rank. Runs contain at least three consecutive cards of one suit. Wilds can fill either.
- A player goes out when every card left after the discard can be arranged into books and/or runs.
- The other two players each receive one final turn.
- The game automatically finds each player's lowest legal unmatched-card score.
- Number cards score face value, Jacks 11, Queens 12, Kings 13, rotating wilds 20, and Jokers 50.
- The lowest cumulative score after Round 11 wins.
- When the stock is exhausted, the discard pile is shuffled while its top card stays in place.

Rules were checked against the [published Five Crowns rules](https://www.ultraboardgames.com/five-crowns/game-rules.php) and [Five Crowns support guidance](https://bonfit.helpshift.com/hc/en/6-five-crowns-kingdom-quest/).

## Files

- `index.html` — responsive game table, cards, controls, chat, settings, rules, animations, and score details.
- `server.js` — authoritative deck, turns, melding, scoring, sessions, bots, and round progression.
- `test.js` — rule-engine checks for deck composition, books, runs, wilds, scoring, and discards.

This is a local, unofficial adaptation created for personal play. Five Crowns is a trademark of its respective owner.
