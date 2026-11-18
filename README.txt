Chess Study v3.1 — analysis graph, settings controls, audio, pieces and Stockfish

1. Extract this folder anywhere.
2. Keep index.html, app.js, style.css, audio/, chess_pieces/, and both Stockfish files together.
3. Open index.html with VS Code Live Server (recommended).

Included:
- Stockfish 19 Lite JS + WASM engine files.
- All 12 chess piece PNGs in chess_pieces/.
- Five audio effects in audio/: move, capture, check, castle, mate.
- Analysis graph: click “Анализировать” to evaluate the current line position-by-position and plot the evaluation from White's perspective.
- Settings for theme, Liquid Glass, glass strength/opacity, background, piece set, animation and sound. Settings are saved in localStorage.
- Audio playback for moves, Stockfish moves and navigating through an existing game.
- Current position evaluation bar, saved PGN games, variations and game metadata.

Graph note:
- The graph analyses every position in the currently selected line at Stockfish depth 8. Longer games take longer to finish.
- Analysis runs in a separate worker and does not take over the game-playing engine.

If browser audio is blocked, click/tap once on the page and then make or navigate a move.
