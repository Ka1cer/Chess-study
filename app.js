/* Chess Study — improved version

   Requires chess.js 0.10.3 and the existing HTML interface.

*/



(() => {

  "use strict";

  if (typeof Chess !== "function") {
    const board = document.getElementById("board");
    if (board) {
      board.innerHTML = '<div class="chess-load-error">Не удалось загрузить шахматный движок. Проверь подключение к интернету и перезагрузи страницу.</div>';
    }
    console.error("Chess Study: chess.js did not load.");
    return;
  }

  const $ = id => document.getElementById(id);



  // Chess piece illustrations (transparent PNGs in ./chess_pieces/).
  // Unicode symbols remain as a fallback if an image file cannot be loaded.
  const pieceNames = {
    k: "king",
    q: "queen",
    r: "rook",
    b: "bishop",
    n: "knight",
    p: "pawn"
  };

  const glyph = {
    w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
    b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" }
  };



  const STORE = "chess-study-games-v1";



  let game = new Chess();

  let lines = [{ id: "main", name: "Основная линия", moves: [] }];

  let currentLineId = "main";

  let history = [];

  let cursor = 0;



  let selected = null;

  let legalTargets = [];

  let flipped = false;

  let currentId = null;



  let dragFrom = null;

  let rightMouseFrom = null;

  let arrows = [];

  let toastTimer = null;

  let variationNumber = 1;

  // ---------- Stockfish game mode ----------
  let engineWorker = null;
  let evaluationWorker = null;
  let evaluationRequestId = 0;
  let engineMode = false;
  let engineColor = "b"; // The computer plays Black by default.
  let engineThinking = false;
  let engineRequest = 0;
  let engineAnalysisOnly = false;
  let lastEvaluation = 0;
  let ignoreNextBestmove = false;
  let evaluationTurn = "w";




  // ---------- General helpers ----------



  function readGames() {

    try {

      return JSON.parse(localStorage.getItem(STORE) || "[]");

    } catch {

      return [];

    }

  }



  function writeGames(items) {

    localStorage.setItem(STORE, JSON.stringify(items));

  }



  function notify(message) {

    const toast = $("toast");



    if (!toast) {

      console.log(message);

      return;

    }



    toast.textContent = message;

    toast.classList.add("show");



    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {

      toast.classList.remove("show");

    }, 2400);

  }



  function getLine() {

    return lines.find(line => line.id === currentLineId) || lines[0];

  }



  function sameMove(a, b) {

    return Boolean(a && b) &&

      a.from === b.from &&

      a.to === b.to &&

      (a.promotion || "") === (b.promotion || "");

  }



  function sameMoves(a, b) {

    return a.length === b.length &&

      a.every((move, i) => sameMove(move, b[i]));

  }



  function makeId() {

    return "variation-" + Date.now() + "-" +

      Math.random().toString(36).slice(2, 8);

  }



  function squareName(file, rank) {

    return "abcdefgh"[file] + (rank + 1);

  }



  // ---------- Additional styling ----------



  function installStyles() {

    if ($("chessStudyEnhancements")) return;



    const style = document.createElement("style");

    style.id = "chessStudyEnhancements";



    style.textContent = `

      #board {
        position: relative;
        transition: none !important;
        animation: none !important;
      }



      #board .piece {

        display: inline-flex;

        align-items: center;

        justify-content: center;

        width: 100%;

        height: 100%;

        cursor: grab;

        user-select: none;

        -webkit-user-select: none;

        animation: none !important;

        transition: none !important;

      }



      #board .piece img {
        display: block;
        width: 90%;
        height: 90%;
        object-fit: contain;
        pointer-events: none;
        user-select: none;
        -webkit-user-drag: none;
      }

      #board .piece:active {

        cursor: grabbing;

      }



      #board .square {

        position: relative;

        min-width: 0;

        min-height: 0;

        padding: 0;

        touch-action: manipulation;

      }



      #board .square.selected {

        box-shadow: inset 0 0 0 4px rgba(246, 220, 70, .85);

      }



      #board .square.legal::after {

        content: "";

        position: absolute;

        width: 26%;

        height: 26%;

        border-radius: 50%;

        background: rgba(20, 20, 20, .27);

        pointer-events: none;

      }



      #board .square.legal.has-piece::after {

        width: 88%;

        height: 88%;

        background: transparent;

        border: 5px solid rgba(20, 20, 20, .25);

        box-sizing: border-box;

      }



      #board .square.last-move {

        background-image: linear-gradient(

          rgba(246, 220, 70, .32),

          rgba(246, 220, 70, .32)

        );

      }

      .chess-board-frame {
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) 22px;
        width: 100%;
        max-width: 582px;
        margin: 0 auto;
        align-items: stretch;
      }
      .chess-board-frame #board {
        grid-column: 2;
        grid-row: 1;
        width: 100%;
        max-width: 560px;
        min-width: 0;
        height: auto;
        aspect-ratio: 1 / 1;
        box-sizing: border-box;
      }
      .chess-load-error {
        grid-column: 1 / -1;
        padding: 24px 16px;
        color: #ffb5aa;
        text-align: center;
        background: #201f1c;
        border-radius: 8px;
      }
      .chess-outside-ranks {
        grid-column: 1; grid-row: 1;
        display: grid; grid-template-rows: repeat(8, minmax(0, 1fr));
        align-items: center; justify-items: center; font-size: 12px;
        color: var(--muted, #999); user-select: none;
      }
      .chess-outside-files {
        grid-column: 2; grid-row: 2;
        display: grid; grid-template-columns: repeat(8, minmax(0, 1fr));
        align-items: center; justify-items: center; font-size: 12px;
        color: var(--muted, #999); user-select: none;
      }



      #board svg.chess-arrow-layer {

        position: absolute;

        inset: 0;

        width: 100%;

        height: 100%;

        pointer-events: none;

        overflow: visible;

        z-index: 5;

      }



      .chess-variation-tools {

        display: flex;

        flex-wrap: wrap;

        gap: 8px;

        align-items: center;

        margin: 8px 0 12px;

      }



      .chess-variation-tools select,

      .chess-variation-tools button,

      .chess-rating-field input {

        border: 1px solid rgba(255,255,255,.15);

        border-radius: 7px;

        padding: 8px 10px;

        color: inherit;

        background: #302e2b;

        font: inherit;

      }



      .chess-variation-tools button {

        cursor: pointer;

      }



      .chess-variation-tools button:disabled {

        opacity: .45;

        cursor: not-allowed;

      }



      .chess-rating-fields {

        display: grid;

        grid-template-columns: 1fr 1fr;

        gap: 10px;

        margin: 10px 0;

      }



      .chess-rating-field {

        display: flex;

        flex-direction: column;

        gap: 5px;

        font-size: 12px;

      }



      .chess-rating-field input {

        box-sizing: border-box;

        width: 100%;

      }



      @media (prefers-reduced-motion: reduce) {

        #board, #board .piece {

          animation: none !important;

          transition: none !important;

        }

      }



      @media (max-width: 600px) {

        .chess-rating-fields {

          grid-template-columns: 1fr;

        }

      }

    `;



    document.head.appendChild(style);

  }



  // ---------- Ratings ----------



  function installRatingFields() {

    if (!$("whiteRatingInput") && $("whiteInput")) {

      const wrapper = document.createElement("div");

      wrapper.className = "chess-rating-fields";

      wrapper.innerHTML = `

        <label class="chess-rating-field">

          White rating (Elo)

          <input id="whiteRatingInput" type="number"

                 min="0" max="4000" step="1"

                 placeholder="e.g. 1800">

        </label>

        <label class="chess-rating-field">

          Black rating (Elo)

          <input id="blackRatingInput" type="number"

                 min="0" max="4000" step="1"

                 placeholder="e.g. 1750">

        </label>

      `;



      const notes = $("notesInput");



      if (notes && notes.parentElement) {

        notes.parentElement.insertAdjacentElement("afterend", wrapper);

      } else {

        $("blackInput").parentElement.insertAdjacentElement(

          "afterend", wrapper

        );

      }



      wrapper.querySelectorAll("input").forEach(input => {

        input.addEventListener("input", updateHeading);

      });

    }

  }



  function getRating(id) {

    const input = $(id);

    if (!input || input.value.trim() === "") return "";



    const value = Number(input.value);



    if (!Number.isFinite(value) || value < 0 || value > 4000) {

      return "";

    }



    return String(Math.round(value));

  }



  function metaFromInputs() {

    return {

      white: $("whiteInput").value.trim() || "White",

      black: $("blackInput").value.trim() || "Black",

      whiteElo: getRating("whiteRatingInput"),

      blackElo: getRating("blackRatingInput"),

      event: $("eventInput").value.trim() || "Casual game",

      date: $("dateInput").value || "",

      notes: $("notesInput").value.trim()

    };

  }



  function loadMeta(m = {}) {

    $("whiteInput").value = m.white || "White";

    $("blackInput").value = m.black || "Black";

    $("eventInput").value = m.event || "Casual game";

    $("dateInput").value = m.date || "";

    $("notesInput").value = m.notes || "";



    if ($("whiteRatingInput")) {

      $("whiteRatingInput").value = m.whiteElo || "";

    }



    if ($("blackRatingInput")) {

      $("blackRatingInput").value = m.blackElo || "";

    }



    updateHeading();

  }



  function updateHeading() {

    const m = metaFromInputs();



    if ($("whiteName")) {

      $("whiteName").textContent =

        m.white + (m.whiteElo ? " (" + m.whiteElo + ")" : "");

    }



    if ($("blackName")) {

      $("blackName").textContent =

        m.black + (m.blackElo ? " (" + m.blackElo + ")" : "");

    }



    if ($("gameTitle")) {

      $("gameTitle").textContent = m.event || "Untitled game";

    }



    if ($("gameMeta")) {

      $("gameMeta").textContent =

        `${m.white} vs ${m.black}` +

        (m.date ? " · " + m.date : "");

    }

  }



  // ---------- Position and lines ----------



  function replayPosition(n) {

    const line = getLine();



    game = new Chess();



    for (let i = 0; i < n && i < line.moves.length; i++) {

      const move = line.moves[i];



      const result = game.move({

        from: move.from,

        to: move.to,

        promotion: move.promotion || "q"

      });



      if (!result) {

        console.error("Could not replay move:", move);

        break;

      }

    }



    history = line.moves;

    cursor = Math.max(0, Math.min(n, history.length));

  }



  function goTo(n) {

    replayPosition(n);

    selected = null;

    legalTargets = [];

    renderAll();
    requestPositionEvaluation();

  }



  function getCurrentLineResult() {

    const temp = new Chess();



    for (const move of history) {

      temp.move({

        from: move.from,

        to: move.to,

        promotion: move.promotion || "q"

      });

    }



    if (temp.in_checkmate()) {

      return temp.turn() === "w" ? "0-1" : "1-0";

    }



    return "*";

  }



  function gameResult() {

    return getCurrentLineResult();

  }



  // ---------- Board rendering ----------



  function ensureBoardFrame() {
    const board = $("board");
    if (!board) return;
    let frame = board.parentElement && board.parentElement.classList.contains("chess-board-frame")
      ? board.parentElement : null;
    if (!frame) {
      frame = document.createElement("div");
      frame.className = "chess-board-frame";
      board.parentNode.insertBefore(frame, board);
      frame.appendChild(board);
    }
    let ranks = frame.querySelector(".chess-outside-ranks");
    let files = frame.querySelector(".chess-outside-files");
    if (!ranks) {
      ranks = document.createElement("div");
      ranks.className = "chess-outside-ranks";
      frame.insertBefore(ranks, board);
    }
    if (!files) {
      files = document.createElement("div");
      files.className = "chess-outside-files";
      frame.appendChild(files);
    }
    ranks.innerHTML = "";
    files.innerHTML = "";
    for (let row = 0; row < 8; row++) {
      const label = document.createElement("span");
      label.textContent = String(flipped ? row + 1 : 8 - row);
      ranks.appendChild(label);
    }
    for (let col = 0; col < 8; col++) {
      const label = document.createElement("span");
      label.textContent = "abcdefgh"[flipped ? 7 - col : col];
      files.appendChild(label);
    }
  }

  // Move the full player rows with the board orientation. This keeps each
  // player's avatar, name, and WHITE/BLACK tag together when the board flips.
  function updatePlayerRows() {
    const board = $("board");
    const frame = board && board.parentElement;
    const panel = frame && frame.parentElement;
    if (!board || !frame || !panel || !frame.classList.contains("chess-board-frame")) return;

    const blackRow = panel.querySelector(".black-player");
    const whiteRow = panel.querySelector(".white-player");
    if (!blackRow || !whiteRow) return;

    const topRow = flipped ? whiteRow : blackRow;
    const bottomRow = flipped ? blackRow : whiteRow;

    panel.insertBefore(topRow, frame);
    frame.insertAdjacentElement("afterend", bottomRow);
  }

  function renderBoard() {

    const board = $("board");

    if (!board) return;

    ensureBoardFrame();
    updatePlayerRows();



    board.innerHTML = "";



    const lastMove = cursor > 0 ? history[cursor - 1] : null;

    const lastSquares = lastMove ? [lastMove.from, lastMove.to] : [];



    for (let row = 0; row < 8; row++) {

      for (let col = 0; col < 8; col++) {

        const file = flipped ? 7 - col : col;

        const rank = flipped ? row : 7 - row;

        const sq = squareName(file, rank);



        const pieceAtSquare = game.get(sq);

        const square = document.createElement("button");



        square.type = "button";

        square.className = "square " +

          (((file + rank) % 2 === 0) ? "dark" : "light");



        square.dataset.square = sq;

        square.setAttribute(

          "aria-label",

          sq + (pieceAtSquare

            ? " " + pieceAtSquare.color + " " + pieceAtSquare.type

            : "")

        );



        if (lastSquares.includes(sq)) {

          square.classList.add("last-move");

        }



        if (selected === sq) {

          square.classList.add("selected");

        }



        if (legalTargets.includes(sq)) {

          square.classList.add("legal");



          if (pieceAtSquare) {

            square.classList.add("has-piece");

          }

        }



        if (pieceAtSquare) {

          const piece = document.createElement("span");

          piece.className = "piece " +

            (pieceAtSquare.color === "w" ? "white" : "black");



          const colorName = pieceAtSquare.color === "w" ? "white" : "black";
          const pieceName = pieceNames[pieceAtSquare.type];
          const pieceImage = document.createElement("img");
          pieceImage.src = `chess_pieces/${colorName}-${pieceName}.png`;
          pieceImage.alt = `${colorName} ${pieceName}`;
          pieceImage.draggable = false;
          pieceImage.setAttribute("aria-hidden", "true");
          pieceImage.addEventListener("error", () => {
            // Keep the board playable even if the asset folder is moved or renamed.
            piece.textContent = glyph[pieceAtSquare.color][pieceAtSquare.type];
          }, { once: true });
          piece.appendChild(pieceImage);


          piece.draggable = true;

          piece.dataset.from = sq;



          piece.addEventListener("dragstart", e => {

            if (e.button !== 0) {

              e.preventDefault();

              return;

            }



            dragFrom = sq;

            selected = sq;

            legalTargets = game.moves({

              square: sq,

              verbose: true

            }).map(move => move.to);



            e.dataTransfer.setData("text/plain", sq);

            e.dataTransfer.effectAllowed = "move";

          });



          piece.addEventListener("dragend", () => {

            dragFrom = null;

          });



          square.appendChild(piece);

        }
square.addEventListener("click", event => {

          if (event.button !== 0) return;

          onSquareClick(sq);

        });



        square.addEventListener("dragover", event => {

          if (dragFrom) {

            event.preventDefault();

            event.dataTransfer.dropEffect = "move";

          }

        });



        square.addEventListener("drop", event => {

          event.preventDefault();



          const from =

            event.dataTransfer.getData("text/plain") || dragFrom;



          if (from) tryMove(from, sq);

          dragFrom = null;

        });



        square.addEventListener("contextmenu", event => {

          event.preventDefault();

        });



        board.appendChild(square);

      }

    }



    renderArrows();

  }



  function onSquareClick(sq) {

    const piece = game.get(sq);



    if (selected && legalTargets.includes(sq)) {

      tryMove(selected, sq);

      return;

    }



    if (piece && piece.color === game.turn()) {

      selected = sq;

      legalTargets = game.moves({

        square: sq,

        verbose: true

      }).map(move => move.to);



      renderBoard();

    } else {

      selected = null;

      legalTargets = [];

      renderBoard();

    }

  }



  function renderEvaluation(score, mate = null) {
    const valueEl = $("evaluationValue");
    const whiteEl = $("evalWhite");
    const blackEl = $("evalBlack");
    if (mate !== null) {
      const whiteMate = mate > 0;
      if (valueEl) valueEl.textContent = `M${Math.abs(mate)}`;
      const whiteShare = whiteMate ? 0.96 : 0.04;
      if (whiteEl) whiteEl.style.height = `${whiteShare * 100}%`;
      if (blackEl) blackEl.style.height = `${(1 - whiteShare) * 100}%`;
      return;
    }
    const pawns = Math.max(-10, Math.min(10, score / 100));
    lastEvaluation = pawns;
    if (valueEl) valueEl.textContent = `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
    const whiteShare = 1 / (1 + Math.exp(-pawns * 0.55));
    if (whiteEl) whiteEl.style.height = `${whiteShare * 100}%`;
    if (blackEl) blackEl.style.height = `${(1 - whiteShare) * 100}%`;
  }

  function renderMaterial() {
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let white = 0, black = 0;
    game.board().flat().forEach(piece => {
      if (!piece) return;
      if (piece.color === "w") white += values[piece.type] || 0;
      else black += values[piece.type] || 0;
    });
    const diff = white - black;
    const whiteEl = $("whiteMaterial"), blackEl = $("blackMaterial");
    if (whiteEl) whiteEl.textContent = diff > 0 ? `+${diff}` : "";
    if (blackEl) blackEl.textContent = diff < 0 ? `+${Math.abs(diff)}` : "";
  }

  function updateEvaluationFromInfo(message) {
    const scoreMatch = message.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
    if (!scoreMatch) return;
    const type = scoreMatch[1];
    const raw = Number(scoreMatch[2]);
    // UCI score is expressed from the side-to-move perspective.
    const whitePerspective = evaluationTurn === "w" ? raw : -raw;
    renderEvaluation(type === "mate" ? 0 : whitePerspective, type === "mate" ? whitePerspective : null);
  }

  function setEngineStatus(message) {
    const element = $("engineStatus");
    if (element) element.textContent = message;
  }

  function stopEngineSearch() {
    engineRequest++;
    if (engineWorker && (engineThinking || engineAnalysisOnly)) {
      ignoreNextBestmove = true;
      try { engineWorker.postMessage("stop"); } catch {}
    }
    engineThinking = false;
    engineAnalysisOnly = false;
  }

  function closeEngine() {
    stopEngineSearch();
    engineAnalysisOnly = false;
    ignoreNextBestmove = false;
    if (engineWorker) {
      try { engineWorker.terminate(); } catch {}
      engineWorker = null;
    }
  }

  function createEngine() {
    if (engineWorker) return true;
    ignoreNextBestmove = false;
    try {
      // This is the same single-threaded browser build tested locally.
      engineWorker = new Worker("./stockfish-19-lite-single.js");
      engineWorker.addEventListener("message", event => {
        const message = String(event.data || "").trim();
        if (!message) return;

        if (message.startsWith("info ")) {
          return; // Position evaluation is handled by the dedicated analysis worker.
        }
        if (message === "uciok") {
          engineWorker.postMessage("isready");
          return;
        }
        if (message === "readyok") {
          setEngineStatus("Ready");
          if (engineMode && game.turn() === engineColor) requestEngineMove();
          return;
        }
        if (message.startsWith("bestmove")) {
          if (engineAnalysisOnly) {
            engineAnalysisOnly = false;
            return;
          }
          if (ignoreNextBestmove) {
            ignoreNextBestmove = false;
            return;
          }
          engineThinking = false;
          if (!engineMode || game.game_over()) return;

          const uci = message.split(/\s+/)[1];
          if (!uci || uci === "(none)") {
            setEngineStatus("Game over");
            return;
          }
          const from = uci.slice(0, 2);
          const to = uci.slice(2, 4);
          const promotion = uci[4] || "q";
          const move = game.move({ from, to, promotion });
          if (!move) {
            setEngineStatus("Engine move error");
            notify("Stockfish вернул недопустимый ход");
            return;
          }
          // Rebuild the current line through the same storage/navigation path.
          const currentMoves = game.history({ verbose: true });
          const existing = lines.find(line => sameMoves(line.moves, currentMoves));
          if (existing) {
            currentLineId = existing.id;
          } else {
            getLine().moves = currentMoves;
          }
          history = getLine().moves;
          cursor = history.length;
          selected = null;
          legalTargets = [];
          renderAll();
          setEngineStatus(game.game_over() ? "Game over" : "Your turn");
          if (!game.game_over() && engineWorker) requestEngineEvaluation();
          return;
        }
      });
      engineWorker.addEventListener("error", error => {
        console.error("Stockfish worker error:", error);
        setEngineStatus("Engine failed to load");
        engineThinking = false;
        notify("Не удалось загрузить Stockfish. Проверь наличие JS и WASM файлов.");
      });
      engineWorker.postMessage("uci");
      return true;
    } catch (error) {
      console.error("Could not start Stockfish:", error);
      setEngineStatus("Engine unavailable");
      notify("Не удалось запустить Stockfish. Проверь файлы движка рядом с index.html.");
      return false;
    }
  }

  function requestPositionEvaluation() {
    // Always analyse the position currently shown on the board, including
    // saved games and historical moves. A separate worker prevents analysis
    // from interfering with Stockfish's actual moves in engine mode.
    const requestId = ++evaluationRequestId;
    if (evaluationWorker) {
      try { evaluationWorker.terminate(); } catch {}
      evaluationWorker = null;
    }

    evaluationTurn = game.turn();
    const fen = game.fen();
    const depth = Number($("engineDepth")?.value || 10);

    try {
      const worker = new Worker("./stockfish-19-lite-single.js");
      evaluationWorker = worker;
      worker.addEventListener("message", event => {
        if (requestId !== evaluationRequestId || evaluationWorker !== worker) return;
        const message = String(event.data || "").trim();
        if (message.startsWith("info ")) {
          updateEvaluationFromInfo(message);
          return;
        }
        if (message === "uciok") {
          worker.postMessage("isready");
          return;
        }
        if (message === "readyok") {
          worker.postMessage("position fen " + fen);
          worker.postMessage("go depth " + depth);
        }
      });
      worker.addEventListener("error", error => {
        if (requestId !== evaluationRequestId) return;
        console.error("Stockfish evaluation worker error:", error);
        if ($("evaluationValue")) $("evaluationValue").textContent = "—";
      });
      worker.postMessage("uci");
    } catch (error) {
      console.error("Could not start Stockfish evaluation worker:", error);
      if ($("evaluationValue")) $("evaluationValue").textContent = "—";
    }
  }

  function requestEngineEvaluation() {
    // Kept as a compatibility wrapper for existing call sites.
    requestPositionEvaluation();
  }

  function requestEngineMove() {
    if (!engineMode || !engineWorker || engineThinking || game.game_over()) return;
    if (game.turn() !== engineColor) return;

    if (engineAnalysisOnly) {
      ignoreNextBestmove = true;
      engineAnalysisOnly = false;
      try { engineWorker.postMessage("stop"); } catch {}
    }
    engineThinking = true;
    evaluationTurn = game.turn();
    const request = ++engineRequest;
    setEngineStatus("Stockfish is thinking…");
    engineWorker.postMessage("position fen " + game.fen());
    engineWorker.postMessage("go depth " + Number($("engineDepth").value || 10));
  }

  function startEngineGame() {
    closeEngine();
    engineMode = true;
    engineColor = $("engineSide").value === "w" ? "b" : "w";
    flipped = engineColor === "w";
    resetGame();

    const humanName = "You";
    loadMeta({
      white: engineColor === "w" ? "Stockfish" : humanName,
      black: engineColor === "b" ? "Stockfish" : humanName,
      event: "Game vs Stockfish",
      date: new Date().toISOString().slice(0, 10),
      notes: ""
    });
    renderAll();
    setEngineStatus("Loading Stockfish…");
    $("engineUndoBtn").disabled = false;

    if (!createEngine()) {
      engineMode = false;
      $("engineUndoBtn").disabled = true;
      return;
    }
    // The worker's readyok response starts the engine if it has the first move.
    if (game.turn() !== engineColor) setEngineStatus("Your turn");
  }

  function undoEngineTurn() {
    if (!engineMode) return;
    const wasThinking = engineThinking;
    if (wasThinking) closeEngine();
    else stopEngineSearch();

    // Remove the player's move and the engine's reply as one complete turn.
    const target = Math.max(0, cursor - 2);
    goTo(target);

    if (wasThinking && createEngine()) {
      setEngineStatus("Loading Stockfish…");
    } else if (game.turn() === engineColor) {
      requestEngineMove();
    } else {
      setEngineStatus("Your turn");
    }
  }

  function tryMove(from, to) {

    if (engineMode && (engineThinking || game.turn() === engineColor || cursor !== history.length)) {
      return;
    }

    // If the expected move is chosen, continue the current line.

    if (cursor < history.length && sameMove(history[cursor], { from, to })) {

      goTo(cursor + 1);

      return;

    }



    const prefix = history.slice(0, cursor);



    let move;



    try {

      move = game.move({

        from,

        to,

        promotion: "q"

      });

    } catch {

      move = null;

    }



    if (!move) {

      selected = null;

      legalTargets = [];

      renderBoard();

      notify("Недопустимый ход");

      return;

    }



    const newMoves = game.history({ verbose: true });



    // Reuse an identical existing line if one already exists.

    const existing = lines.find(line => sameMoves(line.moves, newMoves));



    if (existing) {

      currentLineId = existing.id;

    } else {

      const oldLine = getLine();



      if (cursor < oldLine.moves.length) {

        const newLine = {

          id: makeId(),

          name: "Вариант " + variationNumber++,

          moves: newMoves

        };



        lines.push(newLine);

        currentLineId = newLine.id;

      } else {

        oldLine.moves = newMoves;

      }

    }



    history = getLine().moves;

    cursor = newMoves.length;



    selected = null;

    legalTargets = [];



    goTo(cursor);
    if (engineMode && !game.game_over()) requestEngineMove();

  }



  // ---------- Arrows with the right mouse button ----------



  function squareAtPoint(x, y) {

    const element = document.elementFromPoint(x, y);

    const square = element && element.closest

      ? element.closest("#board [data-square]")

      : null;



    return square ? square.dataset.square : null;

  }



  function installArrowControls() {

    const board = $("board");

    if (!board) return;



    board.addEventListener("contextmenu", event => {

      event.preventDefault();

    });



    board.addEventListener("mousedown", event => {

      if (event.button !== 2) return;



      event.preventDefault();

      rightMouseFrom = squareAtPoint(event.clientX, event.clientY);

    });



    document.addEventListener("mouseup", event => {

      if (event.button !== 2 || !rightMouseFrom) return;



      const from = rightMouseFrom;

      const to = squareAtPoint(event.clientX, event.clientY);



      rightMouseFrom = null;



      if (!to) return;



      if (from === to) {

        arrows = arrows.filter(arrow =>

          !(arrow.from === from && arrow.to === to)

        );

      } else {

        const color = event.shiftKey ? "#e85a5a" : "#83c64c";



        const idx = arrows.findIndex(arrow =>

          arrow.from === from &&

          arrow.to === to &&

          arrow.color === color

        );



        if (idx >= 0) {

          arrows.splice(idx, 1);

        } else {

          arrows.push({ from, to, color });

        }

      }



      renderArrows();

    });

  }



  function renderArrows() {

    const board = $("board");

    if (!board) return;



    const previous = board.querySelector(".chess-arrow-layer");

    if (previous) previous.remove();



    if (!arrows.length) return;



    const svgNS = "http://www.w3.org/2000/svg";

    const svg = document.createElementNS(svgNS, "svg");

    svg.classList.add("chess-arrow-layer");

    svg.setAttribute("viewBox", "0 0 1000 1000");

    svg.setAttribute("preserveAspectRatio", "none");



    const defs = document.createElementNS(svgNS, "defs");



    const colors = [...new Set(arrows.map(arrow => arrow.color))];



    colors.forEach((color, i) => {

      const marker = document.createElementNS(svgNS, "marker");

      marker.setAttribute("id", "chessArrowHead" + i);
      marker.setAttribute("markerWidth", "42");

      marker.setAttribute("markerHeight", "42");

      marker.setAttribute("viewBox", "0 0 6 6");

      marker.setAttribute("refX", "5");

      marker.setAttribute("refY", "3");

      marker.setAttribute("orient", "auto");

      marker.setAttribute("markerUnits", "userSpaceOnUse");



      const polygon = document.createElementNS(svgNS, "polygon");

      polygon.setAttribute("points", "0 0, 6 3, 0 6");

      polygon.setAttribute("fill", color);



      marker.appendChild(polygon);

      defs.appendChild(marker);

    });



    svg.appendChild(defs);



    const boardRect = board.getBoundingClientRect();



    function centerOf(squareNameValue) {

      const square = board.querySelector(

        `[data-square="${squareNameValue}"]`

      );



      if (!square) return null;



      const rect = square.getBoundingClientRect();



      return {

        x: ((rect.left + rect.width / 2 - boardRect.left) /

          boardRect.width) * 1000,

        y: ((rect.top + rect.height / 2 - boardRect.top) /

          boardRect.height) * 1000

      };

    }



    arrows.forEach(arrow => {

      const a = centerOf(arrow.from);

      const b = centerOf(arrow.to);

      if (!a || !b) return;



      const colorIndex = colors.indexOf(arrow.color);



      const line = document.createElementNS(svgNS, "line");

      line.setAttribute("x1", a.x);

      line.setAttribute("y1", a.y);

      line.setAttribute("x2", b.x);

      line.setAttribute("y2", b.y);

      line.setAttribute("stroke", arrow.color);

      line.setAttribute("stroke-width", "9");

      line.setAttribute("stroke-linecap", "round");

      line.setAttribute("opacity", ".85");

      line.setAttribute(

        "marker-end",

        "url(#chessArrowHead" + colorIndex + ")"

      );



      svg.appendChild(line);

    });



    board.appendChild(svg);

  }





  // ---------- Move list and variations ----------



  function renderMoves() {

    const list = $("moveList");

    if (!list) return;



    let tools = $("variationTools");



    if (!tools) {

      tools = document.createElement("div");

      tools.id = "variationTools";

      tools.className = "chess-variation-tools";

      list.parentElement.insertBefore(tools, list);

    }



    tools.innerHTML = "";



    const select = document.createElement("select");

    select.setAttribute("aria-label", "Select variation");



    lines.forEach(line => {

      const option = document.createElement("option");

      option.value = line.id;

      option.textContent =

        `${line.name} · ${Math.ceil(line.moves.length / 2)} ходов`;

      option.selected = line.id === currentLineId;

      select.appendChild(option);

    });



    select.addEventListener("change", () => {

      currentLineId = select.value;

      goTo(0);

    });



    const addButton = document.createElement("button");

    addButton.type = "button";

    addButton.textContent = "+ Вариант";

    addButton.title = "Создать альтернативную линию из текущей позиции";



    addButton.addEventListener("click", () => {

      const prefix = history.slice(0, cursor);

      const newLine = {

        id: makeId(),

        name: "Вариант " + variationNumber++,

        moves: prefix.slice()

      };



      lines.push(newLine);

      currentLineId = newLine.id;



      arrows = [];

      goTo(cursor);

      notify("Вариант создан");

    });



    const deleteButton = document.createElement("button");

    deleteButton.type = "button";

    deleteButton.textContent = "Удалить вариант";

    deleteButton.disabled =

      currentLineId === "main" || lines.length <= 1;



    deleteButton.addEventListener("click", () => {

      if (currentLineId === "main") {

        notify("Основную линию удалить нельзя");

        return;

      }



      lines = lines.filter(line => line.id !== currentLineId);

      currentLineId = "main";

      arrows = [];



      goTo(getLine().moves.length);

      notify("Вариант удалён");

    });



    tools.append(select, addButton, deleteButton);



    list.innerHTML = "";



    if (!history.length) {

      list.innerHTML =

        '<div class="empty">Moves will appear here.</div>';

      return;

    }



    for (let i = 0; i < history.length; i += 2) {

      const row = document.createElement("div");

      row.className = "move-row";



      const no = document.createElement("span");

      no.className = "move-no";

      no.textContent = (Math.floor(i / 2) + 1) + ".";



      const white = document.createElement("button");

      white.className = "move-cell";

      white.textContent = history[i].san;

      white.classList.toggle("active", cursor === i + 1);

      white.addEventListener("click", () => goTo(i + 1));



      row.append(no, white);



      if (history[i + 1]) {

        const black = document.createElement("button");

        black.className = "move-cell";

        black.textContent = history[i + 1].san;

        black.classList.toggle("active", cursor === i + 2);

        black.addEventListener("click", () => goTo(i + 2));

        row.appendChild(black);

      } else {

        row.appendChild(document.createElement("span"));

      }



      list.appendChild(row);

    }



    const active = list.querySelector(".active");



    if (active) {
      // Scroll only the move list. Element.scrollIntoView() may also scroll
      // the whole page on mobile browsers, making the chessboard jump away.
      const activeTop = active.offsetTop - list.offsetTop;
      const activeBottom = activeTop + active.offsetHeight;
      if (activeTop < list.scrollTop) {
        list.scrollTop = activeTop;
      } else if (activeBottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = activeBottom - list.clientHeight;
      }
    }

  }



  // ---------- Status and navigation ----------



  function renderStatus() {

    let text = game.turn() === "w"

      ? "White to move"

      : "Black to move";



    if (game.in_checkmate()) {

      text = "Checkmate — " +

        (game.turn() === "w" ? "Black" : "White") + " wins";

    } else if (game.in_stalemate()) {

      text = "Draw — stalemate";

    } else if (game.in_draw()) {

      text = "Draw position";

    } else if (game.in_check()) {

      text += " · Check";

    }



    if ($("status")) $("status").textContent = text;



    if ($("moveCounter")) {

      $("moveCounter").textContent = cursor === 0

        ? "Start position"

        : `Move ${Math.ceil(cursor / 2)} of ${Math.ceil(history.length / 2)}`;

    }



    if ($("backBtn")) $("backBtn").disabled = cursor === 0;

    if ($("firstBtn")) $("firstBtn").disabled = cursor === 0;



    if ($("forwardBtn")) {

      $("forwardBtn").disabled = cursor === history.length;

    }



    if ($("lastBtn")) {

      $("lastBtn").disabled = cursor === history.length;

    }

  }



  function renderAll() {

    renderBoard();

    renderMoves();

    renderStatus();

    renderMaterial();

    updateHeading();

  }



  function installKeyboardNavigation() {

    document.addEventListener("keydown", event => {

      const target = event.target;



      if (

        target &&

        (

          target.matches("input, textarea, select") ||

          target.isContentEditable

        )

      ) {

        return;

      }



      if (event.altKey || event.ctrlKey || event.metaKey) return;



      switch (event.key) {

        case "ArrowLeft":

          event.preventDefault();

          goTo(cursor - 1);

          break;



        case "ArrowRight":

          event.preventDefault();

          goTo(cursor + 1);

          break;



        case "ArrowUp":

          event.preventDefault();

          goTo(0);

          break;



        case "ArrowDown":

          event.preventDefault();

          goTo(history.length);

          break;

      }

    });

  }



  // ---------- PGN ----------



  function buildPgn() {

    const m = metaFromInputs();



    const date = m.date

      ? m.date.replaceAll("-", ".")

      : "????.??.??";



    const headers = [

      ["Event", m.event],

      ["Site", "?"],

      ["Date", date],

      ["Round", "?"],

      ["White", m.white],

      ["Black", m.black],

      ["Result", gameResult()]

    ];



    if (m.whiteElo) headers.push(["WhiteElo", m.whiteElo]);

    if (m.blackElo) headers.push(["BlackElo", m.blackElo]);



    const headerText = headers.map(([key, value]) => {

      const safeValue = String(value).replaceAll("\\\\", "\\\\\\\\")

        .replaceAll('"', '\\\\"');



      return `[${key} "${safeValue}"]`;

    }).join("\n");



    // Turn all stored lines into a move tree.

    const root = { move: null, children: [] };



    for (const line of lines) {

      let parent = root;



      for (const move of line.moves) {

        let node = parent.children.find(child =>

          sameMove(child.move, move)

        );



        if (!node) {

          node = { move, children: [] };

          parent.children.push(node);

        }



        parent = node;

      }

    }



    function token(move, ply, forceNumber) {

      const number = Math.ceil(ply / 2);



      if (move.color === "w") {

        return `${number}. ${move.san}`;

      }



      return forceNumber ? `${number}... ${move.san}` : move.san;

    }



    function emit(parent, ply) {

      if (!parent.children.length) return "";



      const main = parent.children[0];

      let text = token(main.move, ply, false);



      for (const alt of parent.children.slice(1)) {

        const variation =

          token(alt.move, ply, true) + emit(alt, ply + 1);



        text += ` (${variation.trim()})`;

      }



      const continuation = emit(main, ply + 1);



      if (continuation) text += " " + continuation;



      return text;

    }



    return headerText + "\n\n" + emit(root, 1).trim() +

      " " + gameResult();

  }



  function importPgnText(text) {

    const imported = new Chess();



    if (!imported.load_pgn(text)) {

      notify("PGN could not be loaded. Check the file format.");

      return;

    }



    game = new Chess();



    if (!game.load_pgn(text)) {

      notify("PGN could not be loaded.");

      return;

    }



    history = game.history({ verbose: true });



    lines = [{

      id: "main",

      name: "Основная линия",

      moves: history

    }];



    currentLineId = "main";

    variationNumber = 1;

    cursor = history.length;

    currentId = null;

    arrows = [];



    const h = game.header();

    const validDate =

      h.Date && /^\d{4}\.\d{2}\.\d{2}$/.test(h.Date);



    loadMeta({

      white: h.White || "White",

      black: h.Black || "Black",

      whiteElo: h.WhiteElo || "",

      blackElo: h.BlackElo || "",

      event: h.Event || "Imported game",

      date: validDate ? h.Date.replaceAll(".", "-") : "",

      notes: ""

    });



    goTo(history.length);

    notify("PGN imported");

  }



  // ---------- Save / load / database ----------



  function saveGame() {

    const m = metaFromInputs();

    const games = readGames();



    const item = {

      id: currentId ||

        ("g" + Date.now() + Math.random().toString(16).slice(2, 7)),

      ...m,

      pgn: buildPgn(),

      lines: lines.map(line => ({

        id: line.id,

        name: line.name,

        moves: line.moves.map(move => ({ ...move }))

      })),

      activeLineId: currentLineId,

      updatedAt: new Date().toISOString(),

      plies: history.length

    };



    const idx = games.findIndex(g => g.id === item.id);



    if (idx >= 0) games[idx] = item;

    else games.unshift(item);



    writeGames(games);

    currentId = item.id;

    renderSavedGames();

    notify("Game and variations saved");

  }



  function openSaved(id) {

    const item = readGames().find(g => g.id === id);

    if (!item) return;



    const temp = new Chess();



    if (!temp.load_pgn(item.pgn)) {

      notify("Could not read this PGN");

      return;

    }



    if (Array.isArray(item.lines) && item.lines.length) {

      lines = item.lines.map(line => ({

        id: line.id,

        name: line.name,

        moves: line.moves.map(move => ({ ...move }))

      }));



      if (!lines.some(line => line.id === "main")) {

        lines.unshift({

          id: "main",

          name: "Основная линия",

          moves: []

        });

      }



      currentLineId = lines.some(line => line.id === item.activeLineId)

        ? item.activeLineId

        : "main";



      variationNumber =

        lines.filter(line => line.id !== "main").length + 1;

    } else {

      // Compatibility with games saved by the original version.

      lines = [{

        id: "main",

        name: "Основная линия",

        moves: temp.history({ verbose: true })

      }];



      currentLineId = "main";

      variationNumber = 1;

    }



    history = getLine().moves;

    currentId = item.id;

    arrows = [];



    loadMeta(item);

    goTo(history.length);

    notify("Game loaded");

  }



  function renderSavedGames() {

    const games = readGames();

    const search = $("searchInput");



    const query = search ? search.value.toLowerCase().trim() : "";



    const filtered = games.filter(gameItem => [

      gameItem.white,

      gameItem.black,

      gameItem.event,

      gameItem.notes,

      gameItem.date

    ].join(" ").toLowerCase().includes(query));



    if ($("gameCount")) {

      $("gameCount").textContent = `${games.length} saved`;

    }



    const list = $("savedGames");

    if (!list) return;



    list.innerHTML = "";



    if (!filtered.length) {

      list.innerHTML = '<div class="empty">No matching games.</div>';

      return;

    }



    filtered.forEach(gameItem => {

      const row = document.createElement("div");

      row.className = "saved-game";



      const main = document.createElement("div");

      main.className = "saved-game-main";



      const title = document.createElement("div");

      title.className = "saved-game-title";



      title.textContent =

        `${gameItem.white}${gameItem.whiteElo ? " (" + gameItem.whiteElo + ")" : ""}` +

        " — " +

        `${gameItem.black}${gameItem.blackElo ? " (" + gameItem.blackElo + ")" : ""}`;



      const meta = document.createElement("div");

      meta.className = "saved-game-meta";



      meta.textContent =

        `${gameItem.event}${gameItem.date ? " · " + gameItem.date : ""}` +

        ` · ${Math.ceil((gameItem.plies || 0) / 2)} moves`;



      main.append(title, meta);

      main.addEventListener("click", () => openSaved(gameItem.id));



      const del = document.createElement("button");

      del.className = "delete-btn";

      del.textContent = "Delete";

      del.title = "Delete saved game";



      del.addEventListener("click", () => {

        if (!confirm("Delete this saved game?")) return;



        writeGames(readGames().filter(x => x.id !== gameItem.id));

        renderSavedGames();



        if (currentId === gameItem.id) currentId = null;



        notify("Game deleted");

      });



      row.append(main, del);

      list.appendChild(row);

    });

  }



  function resetGame() {
    renderEvaluation(0);
    engineAnalysisOnly = false;

    if (engineMode) stopEngineSearch();
    game = new Chess();



    lines = [{

      id: "main",

      name: "Основная линия",

      moves: []

    }];



    currentLineId = "main";

    history = [];

    cursor = 0;



    selected = null;

    legalTargets = [];

    currentId = null;

    arrows = [];

    variationNumber = 1;



    loadMeta({

      white: "White",

      black: "Black",

      whiteElo: "",

      blackElo: "",

      event: "Casual game",

      date: new Date().toISOString().slice(0, 10),

      notes: ""

    });



    renderAll();
    requestPositionEvaluation();

  }



  // ---------- Event registration ----------



  function downloadFile(content, filename, mimeType) {

    const blob = new Blob([content], { type: mimeType });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");



    a.href = url;

    a.download = filename;

    document.body.appendChild(a);

    a.click();

    a.remove();



    setTimeout(() => URL.revokeObjectURL(url), 1000);

  }



  function installEvents() {

    const engineModal = $("engineModal");
    $("engineModalOpenBtn").addEventListener("click", () => { engineModal.hidden = false; });
    $("engineModalCloseBtn").addEventListener("click", () => { engineModal.hidden = true; });
    engineModal.addEventListener("click", event => { if (event.target === engineModal) engineModal.hidden = true; });
    $("engineStartBtn").addEventListener("click", () => { startEngineGame(); engineModal.hidden = true; });
    $("engineUndoBtn").addEventListener("click", undoEngineTurn);

    $("newGameBtn").addEventListener("click", () => {
      if (engineMode) {
        closeEngine();
        engineMode = false;
        $("engineUndoBtn").disabled = true;
        setEngineStatus("Engine is off");
      }

      if (

        history.length &&

        !confirm("Start a new game? Save this one first if needed.")

      ) {

        return;

      }



      resetGame();

    });



    $("flipBtn").addEventListener("click", () => {

      flipped = !flipped;

      renderBoard();

    });



    $("firstBtn").addEventListener("click", () => goTo(0));

    $("backBtn").addEventListener("click", () => goTo(cursor - 1));

    $("forwardBtn").addEventListener("click", () => goTo(cursor + 1));

    $("lastBtn").addEventListener("click", () => goTo(history.length));



    $("saveBtn").addEventListener("click", saveGame);



    $("exportBtn").addEventListener("click", () => {

      downloadFile(

        buildPgn(),

        "chess-game.pgn",

        "application/x-chess-pgn;charset=utf-8"

      );

    });



    $("importBtn").addEventListener("click", () => $("fileInput").click());



    $("fileInput").addEventListener("change", async event => {

      const file = event.target.files[0];



      if (file) importPgnText(await file.text());



      event.target.value = "";

    });



    $("searchInput").addEventListener("input", renderSavedGames);



    $("backupInput").addEventListener("change", async event => {

      const file = event.target.files[0];

      if (!file) return;



      try {

        const data = JSON.parse(await file.text());



        if (!Array.isArray(data)) throw new Error("Invalid backup");



        writeGames(data);

        renderSavedGames();

        notify("Database backup restored");

      } catch {

        notify("Invalid backup JSON");

      }



      event.target.value = "";

    });



    document.querySelectorAll("input, textarea").forEach(element => {

      element.addEventListener("input", updateHeading);

    });



    // Click Backup to export. Shift-click to restore a backup.

    $("backupBtn").addEventListener("click", event => {

      if (event.shiftKey) {

        $("backupInput").click();

        return;

      }



      downloadFile(

        JSON.stringify(readGames(), null, 2),

        "chess-study-backup.json",

        "application/json"

      );

    });

  }



  // ---------- Start ----------



  function initialize() {

    const required = [

      "board", "moveList", "whiteInput", "blackInput",

      "eventInput", "dateInput", "notesInput", "newGameBtn",

      "flipBtn", "firstBtn", "backBtn", "forwardBtn", "lastBtn",

      "saveBtn", "exportBtn", "importBtn", "fileInput",

      "searchInput", "backupInput", "backupBtn",
      "engineSide", "engineDepth", "engineStartBtn", "engineUndoBtn", "engineStatus"

    ];



    const missing = required.filter(id => !$(id));



    if (missing.length) {

      console.error("Chess Study: missing HTML elements:", missing);

      alert(

        "Chess Study не может запуститься. Не найдены HTML-элементы: " +

        missing.join(", ") +

        ". Проверь index.html."

      );

      return;

    }



    installStyles();

    installRatingFields();


    installArrowControls();

    installKeyboardNavigation();

    installEvents();



    resetGame();

    renderSavedGames();

  }



  // Keep the evaluation bar exactly as tall as the visible chessboard.
  function syncEvaluationBarHeight() {
    const board = $("board");
    const bar = $("evaluationBar");
    if (!board || !bar) return;
    const height = board.getBoundingClientRect().height;
    if (height > 0) bar.style.setProperty("--board-pixel-height", `${height}px`);
  }

  window.addEventListener("resize", syncEvaluationBarHeight);
  if (typeof ResizeObserver !== "undefined") {
    const boardSizeObserver = new ResizeObserver(syncEvaluationBarHeight);
    const boardElement = $("board");
    if (boardElement) boardSizeObserver.observe(boardElement);
  }
  requestAnimationFrame(syncEvaluationBarHeight);

  initialize();

})();