# Three-Handed Five Crowns v2.1.6

## Run

```sh
npm start
```

The server listens on `PORT` (default `8080`) and `HOST` (default `0.0.0.0`).

## All-time scores

Each completed game's three final scores are stored in `score-history.json`. The game shows the five highest and five lowest entries, including player names and a `(Bot)` label when the seat was bot-controlled at game completion. Settings includes a confirmed **Reset High & Low Scores** action.

For durable production storage, set `SCORE_HISTORY_FILE` to a writable persistent-disk path, such as `/var/data/five-crowns-score-history.json`. The default file beside `server.js` can be lost when an ephemeral host redeploys or restarts.

## Test

```sh
npm test
```
