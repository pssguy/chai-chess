# Chai Chess

Famous chess games with beginner and expert commentary, Stockfish analysis in the browser, puzzles, guess-the-move and play-the-engine. A static site: no server, no build step.

## Files
- `index.html` – the page
- `app.js` – the app
- `intro.js` – the opening animation with piano notes (once per visit)
- `data.js` – the ten games, engine analysis, commentary and puzzles
- `chess.js` – move rules (chess.js 0.10.3, BSD licence)
- `stockfish.js`, `stockfish.wasm` – Stockfish 18 lite, single-threaded WebAssembly build (GPLv3, see `COPYING-stockfish.txt`; source: https://github.com/official-stockfish/Stockfish and https://github.com/nmrugg/stockfish.js)

## Run locally
Browsers block the engine when a page is opened straight from disk, so serve the folder:
`python3 -m http.server` then open http://localhost:8000
