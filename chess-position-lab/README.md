# Chess Position Lab

## Run in VS Code
1. Install Node.js 20 or newer.
2. Open this folder in VS Code.
3. Open Terminal → New Terminal.
4. Run `npm start`.
5. Open http://localhost:3000 in your browser.

No API key or separately installed Windows Stockfish executable is needed. The included Stockfish 19 lite engine runs in a browser Web Worker using WebAssembly.

## Use
- Settings control board appearance and board coordinates. The board and palette use Lichess's Staunty SVG chess pieces; see [the piece attribution and license notice](./dist/pieces/staunty/ATTRIBUTION.txt).
- The board is a freeform position editor outside a game. Drag pieces from the palette onto the board, or click a palette piece then a square. Click that palette piece again to select and move board pieces by clicking a destination. Drop a board piece outside the board or drag it to the trash button to remove it; clicking a selected board piece's trash button also removes it.
- Choose whose turn it is, and enable castling only when that side retains the right to castle. Find a move analyzes the current edited position; Play suggested move applies Stockfish's suggestion to the board.
- Start game validates the edited position and plays a normal legal-move game. Choose which color Stockfish plays; you control the other color. Move by clicking a piece and destination, or drag and drop. Return to analysis to edit again. Promotion asks for queen, rook, bishop, or knight.
- Load FEN accepts all six fields, including en passant. Editing a position resets en passant and move counters; load a FEN if these need preserving.
- A positive evaluation favors White; a negative evaluation favors Black. Stockfish gives its strongest move found within the chosen thinking time, not a mathematical guarantee of the best move.

The editor permits custom arrangements but analysis requires a chess position that passes basic legality checks. Both kings must exist, kings cannot be adjacent, pawns cannot be on the first/last rank, and the side that just moved cannot have left its king in check. It does not prove that every position can be reached from a real game's starting position.

## Edit
`dist/app.js` contains the app logic, `dist/style.css` its appearance, and `dist/index.html` the UI. `server.cjs` is the local static server. Assets are vendored, so npm start works without installing packages.

## Open-source notices
Stockfish.js: https://github.com/nmrugg/stockfish.js (GPLv3). Engine version and license are included under dist/vendor. Corresponding engine source: https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.0 (see upstream release/build instructions).
chess.js: https://github.com/jhlywa/chess.js (BSD-2-Clause). Its license is included under dist/vendor.
