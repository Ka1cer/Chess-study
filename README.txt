Chess Study v3.1.1 — analysis graph, settings controls, audio, pieces and Stockfish

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


 Chess Study v3.1.1 — график анализа, настройки, звуки, фигуры и Stockfish

1. Распакуйте эту папку в любое удобное место.
2. Храните `index.html`, `app.js`, `style.css`, `audio/`, `chess_pieces/` и оба файла Stockfish вместе, в одной папке.
3. Откройте `index.html` с помощью VS Code Live Server (рекомендуется).

**В комплект входит:**
- Файлы шахматного движка Stockfish 19 Lite (JS + WASM).
- Все 12 PNG-изображений шахматных фигур в папке `chess_pieces/`.
- Пять звуковых эффектов в папке `audio/`: ход, взятие, шах, рокировка и мат.
- График анализа: нажмите «Анализировать», чтобы оценить каждую позицию в текущей линии ходов и построить график оценки с точки зрения белых.
- Настройки темы оформления, Liquid Glass, силы эффекта стекла/прозрачности, фонового изображения, набора фигур, анимации и звука. Настройки сохраняются в `localStorage`.
- Воспроизведение звуков при ходах игрока, ходах Stockfish и перемещении по уже сыгранной партии.
- Индикатор оценки текущей позиции, сохранённые PGN-партии, варианты ходов и метаданные партий.

**Примечание о графике:**
- График анализирует каждую позицию в текущей выбранной линии ходов на глубине 8 Stockfish. Чем длиннее партия, тем больше времени занимает анализ.
- Анализ выполняется в отдельном Worker и не перехватывает управление игровым движком.

Если браузер блокирует воспроизведение звука, один раз нажмите на страницу, а затем сделайте ход или перейдите к другому ходу партии.
