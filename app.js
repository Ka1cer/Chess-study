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

  let moveTree = new window.ChessStudyMoveTree();
  let activeLeaf = moveTree.root;
  let currentNode = moveTree.root;
  let history = [];
  let cursor = 0;
  let branchCreationMode = false;



  let selected = null;

  let legalTargets = [];

  let flipped = false;

  let currentId = null;



  let dragFrom = null;

  let rightMouseFrom = null;

  let arrows = [];

  let toastTimer = null;

  // ---------- Appearance preferences ----------
  const APPEARANCE_STORE = "chess-study-appearance-v1";
  let appearanceSettings = { theme: "system", liquidGlass: false, glassStrength: 65, glassOpacity: 65, pieceAnimation: true, pieceSet: "modern", soundEnabled: true, background: "" };
  let lastRenderedCursor = null;

  // ---------- Stockfish game mode ----------
  let engineWorker = null;
  let evaluationWorker = null;
  let evaluationRequestId = 0;
  let engineMode = false;
  let engineColor = "b"; // The computer plays Black by default.
  let engineThinking = false;
  let engineMoveTimer = null;
  const ENGINE_MOVE_DELAY_MS = 700;
  let engineRequest = 0;
  let engineAnalysisOnly = false;
  let lastEvaluation = 0;
  let ignoreNextBestmove = false;
  let evaluationTurn = "w";
  let engineGameEnded = false;
  let pendingPromotion = null;




  function readAppearanceSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(APPEARANCE_STORE) || "{}");
      appearanceSettings = { ...appearanceSettings, ...saved };
    } catch (error) { console.warn("Chess Study: could not read appearance settings", error); }
  }

  function saveAppearanceSettings() {
    try { localStorage.setItem(APPEARANCE_STORE, JSON.stringify(appearanceSettings)); return true; }
    catch (error) { console.warn("Chess Study: could not save appearance settings", error); notify("Не удалось сохранить настройки. Возможно, в хранилище недостаточно места."); return false; }
  }

  // Chess move sounds are separate files in ./audio so they can be replaced
  // without changing the application code.
  const CHESS_SOUND_FILES = {
    move: "./audio/move.mp3",
    capture: "./audio/capture.mp3",
    check: "./audio/check.mp3",
    castle: "./audio/castle.mp3",
    mate: "./audio/mate.mp3"
  };
  const chessAudio = {};
  let chessAudioUnlocked = false;

  function getChessAudio(kind) {
    if (!chessAudio[kind]) {
      const audio = new Audio(CHESS_SOUND_FILES[kind]);
      audio.preload = "auto";
      audio.volume = 0.9;
      chessAudio[kind] = audio;
    }
    return chessAudio[kind];
  }

  function playChessSound(kind) {
    if (appearanceSettings.soundEnabled === false || !CHESS_SOUND_FILES[kind]) return;
    try {
      const audio = getChessAudio(kind);
      audio.pause();
      audio.currentTime = 0;
      const playback = audio.play();
      if (playback && typeof playback.catch === "function") {
        playback.catch(error => console.debug("Chess Study: sound playback was blocked", error));
      }
    } catch (error) {
      console.debug("Chess Study: sound playback unavailable", error);
    }
  }

  function unlockChessAudio() {
    if (appearanceSettings.soundEnabled === false || chessAudioUnlocked) return;
    // Prime each HTMLAudioElement during a user gesture. This allows later
    // asynchronous Stockfish replies to play their sounds as well.
    chessAudioUnlocked = true;
    Object.keys(CHESS_SOUND_FILES).forEach(kind => {
      try {
        const audio = getChessAudio(kind);
        audio.muted = true;
        audio.currentTime = 0;
        const playback = audio.play();
        if (playback && typeof playback.then === "function") {
          playback.then(() => {
            window.setTimeout(() => {
              audio.pause();
              audio.currentTime = 0;
              audio.muted = false;
            }, 80);
          }).catch(() => { audio.muted = false; chessAudioUnlocked = false; });
        } else {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        }
      } catch (error) {
        console.debug("Chess Study: audio could not be unlocked", error);
      }
    });
  }

  function playMoveSound(move) {
    if (!move) return;
    if (game.in_checkmate()) playChessSound("mate");
    else if (game.in_check()) playChessSound("check");
    else if (move.flags && (move.flags.includes("k") || move.flags.includes("q"))) playChessSound("castle");
    else if (move.captured) playChessSound("capture");
    else playChessSound("move");
  }

  function applyAppearanceSettings() {
    const theme = ["system", "dark", "light"].includes(appearanceSettings.theme) ? appearanceSettings.theme : "system";
    const resolvedTheme = theme === "system"
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : theme;
    document.body.classList.toggle("light-theme", resolvedTheme === "light");
    document.body.classList.toggle("dark-theme", resolvedTheme === "dark");
    document.body.dataset.theme = theme;
    document.body.classList.toggle("liquid-glass", !!appearanceSettings.liquidGlass);
    const strength = Math.max(20, Math.min(100, Number(appearanceSettings.glassStrength ?? 65)));
    const opacity = Math.max(0, Math.min(100, Number(appearanceSettings.glassOpacity ?? 65)));
    document.body.style.setProperty("--glass-strength", String(strength));
    document.body.style.setProperty("--glass-alpha", String(0.82 - opacity * 0.0064));
    document.body.style.setProperty("--glass-blur", `${8 + strength * 0.21}px`);
    document.body.style.setProperty("--glass-highlight", String(0.04 + strength * 0.0012));
    if (appearanceSettings.background) {
      document.body.classList.add("has-custom-background");
      document.body.style.setProperty("--custom-bg-image", `url("${appearanceSettings.background}")`);
    } else {
      document.body.classList.remove("has-custom-background");
      document.body.style.removeProperty("--custom-bg-image");
    }
    const themeSelect = $("themeSelect");
    const glassToggle = $("liquidGlassToggle"), glassStrength = $("glassStrength"), glassOpacity = $("glassOpacity");
    const glassValue = $("glassStrengthValue"), opacityValue = $("glassOpacityValue"), animationToggle = $("pieceAnimationToggle");
    const pieceSetSelect = $("pieceSetSelect");
    const soundToggle = $("soundToggle");
    if (themeSelect) themeSelect.value = theme;
    if (glassToggle) glassToggle.checked = !!appearanceSettings.liquidGlass;
    if (glassStrength) glassStrength.value = strength;
    if (glassValue) glassValue.textContent = `${strength}%`;
    if (glassOpacity) glassOpacity.value = opacity;
    if (opacityValue) opacityValue.textContent = `${opacity}%`;
    if (animationToggle) animationToggle.checked = appearanceSettings.pieceAnimation !== false;
    if (pieceSetSelect) pieceSetSelect.value = appearanceSettings.pieceSet === "classic" ? "classic" : "modern";
    if (soundToggle) soundToggle.checked = appearanceSettings.soundEnabled !== false;
    const bgStatus = $("backgroundStatus");
    if (bgStatus) bgStatus.textContent = appearanceSettings.background ? "Собственный фон установлен и сохранён в этом браузере." : "Поддерживаются JPG, PNG и WebP. Изображение будет сохранено в этом браузере.";
  }

  let activePieceAnimation = null;
  // One-render override for the input method that produced the next move.
  // "default" preserves normal navigation and Stockfish animation behavior.
  let nextMoveAnimationMode = "default";

  function clearPieceAnimation() {
    if (!activePieceAnimation) return;
    const active = activePieceAnimation;
    activePieceAnimation = null;
    if (active.animation) active.animation.cancel();
    if (active.ghost) active.ghost.remove();
    if (active.destination) active.destination.style.removeProperty("opacity");
  }

  // Capture the actual rendered piece before the board is rebuilt. This avoids
  // the size/position jump caused by cloning the already-rendered destination.
  function captureMoveAnimation(move) {
    if (!appearanceSettings.pieceAnimation || !move || !move.from || !move.to) return null;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
    const board = $("board");
    const source = board && board.querySelector(`[data-square="${move.from}"] .piece`);
    if (!source) return null;
    const rect = source.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { piece: source.cloneNode(true), rect };
  }

  function animatePieceMove(move, snapshot) {
    if (!snapshot || !move) return;
    const board = $("board");
    const destinationSquare = board && board.querySelector(`[data-square="${move.to}"]`);
    const destination = destinationSquare && destinationSquare.querySelector(".piece");
    if (!destination || typeof Element.prototype.animate !== "function") return;

    clearPieceAnimation();
    const targetRect = destination.getBoundingClientRect();
    const startRect = snapshot.rect;
    const dx = targetRect.left - startRect.left;
    const dy = targetRect.top - startRect.top;
    const ghost = snapshot.piece;
    ghost.classList.add("piece-animation-ghost");
    ghost.removeAttribute("draggable");
    ghost.style.left = `${startRect.left}px`;
    ghost.style.top = `${startRect.top}px`;
    ghost.style.width = `${startRect.width}px`;
    ghost.style.height = `${startRect.height}px`;
    ghost.style.margin = "0";
    ghost.style.transform = "translate3d(0,0,0)";
    document.body.appendChild(ghost);

    // The real piece is already in its final square; hide it until the moving
    // copy arrives so the user sees one continuous piece, not two.
    destination.style.setProperty("opacity", "0", "important");
    const distance = Math.hypot(dx, dy);
    const duration = Math.max(120, Math.min(220, 105 + distance * 0.16));
    const animation = ghost.animate(
      [
        { transform: "translate3d(0,0,0)", offset: 0 },
        { transform: `translate3d(${dx}px,${dy}px,0)`, offset: 1 }
      ],
      { duration, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" }
    );
    activePieceAnimation = { animation, ghost, destination };
    const cleanup = () => {
      if (activePieceAnimation && activePieceAnimation.animation === animation) activePieceAnimation = null;
      ghost.remove();
      destination.style.removeProperty("opacity");
    };
    animation.onfinish = cleanup;
    animation.oncancel = cleanup;
  }

  function compressBackgroundImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("Файл не удалось распознать как изображение."));
        image.onload = () => {
          const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

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



  function sameMove(a, b) {
    return Boolean(a && b) &&
      a.from === b.from &&
      a.to === b.to &&
      (a.promotion || "") === (b.promotion || "");
  }

  function getActivePathNodes() {
    return moveTree.getNodePath(activeLeaf);
  }

  function setActiveLeafFromNode(node) {
    activeLeaf = moveTree.mainLeafFrom(node || moveTree.root);
    history = moveTree.getPath(activeLeaf);
  }

  function findBranchOnActivePath() {
    return moveTree.firstAlternativeOnPath(activeLeaf);
  }

  function replayPosition(n) {
    const nodes = getActivePathNodes();
    history = nodes.map(node => ({ ...node.move }));
    cursor = Math.max(0, Math.min(Number(n) || 0, nodes.length));
    currentNode = cursor ? nodes[cursor - 1] : moveTree.root;

    game = new Chess();
    for (let i = 0; i < cursor; i++) {
      const move = nodes[i].move;
      const result = game.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion || "q"
      });
      if (!result) {
        console.error("Could not replay move-tree node:", nodes[i]);
        break;
      }
    }
  }

  function goToMoveNode(node) {
    if (!node || !moveTree.isAncestor(moveTree.root, node)) return;
    setActiveLeafFromNode(node);
    goTo(moveTree.getNodePath(node).length);
  }

  function goTo(n) {
    const previousCursor = cursor;
    replayPosition(n);
    if (cursor !== previousCursor && cursor > 0) playMoveSound(history[cursor - 1]);
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
    const previousCursor = lastRenderedCursor;
    const animationMode = nextMoveAnimationMode;
    nextMoveAnimationMode = "default";
    const animatedMove = animationMode !== "none" && previousCursor !== null && cursor === previousCursor + 1 ? history[cursor - 1] : null;
    clearPieceAnimation();
    const animationSnapshot = animatedMove ? captureMoveAnimation(animatedMove) : null;

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
          if (appearanceSettings.pieceSet === "classic") {
            piece.textContent = glyph[pieceAtSquare.color][pieceAtSquare.type];
            piece.classList.add("unicode-piece");
          } else {
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
          }


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



          if (from) tryMove(from, sq, "drag");

          dragFrom = null;

        });



        square.addEventListener("contextmenu", event => {

          event.preventDefault();

        });



        board.appendChild(square);

      }

    }



    renderArrows();
    if (animatedMove && animationSnapshot) animatePieceMove(animatedMove, animationSnapshot);
    lastRenderedCursor = cursor;

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



  function isCompletedPosition() {
    return game.game_over() || (typeof game.in_threefold_repetition === "function" && game.in_threefold_repetition());
  }

  function updateEngineEndUI() {
    const button = $("resignBtn");
    const bar = $("evaluationBar");
    const value = $("evaluationValue");
    const ended = engineMode && isCompletedPosition();
    if (ended) engineGameEnded = true;
    if (button) {
      button.hidden = !engineMode;
      button.disabled = !engineMode || engineGameEnded;
      button.setAttribute("aria-disabled", String(button.disabled));
    }
    if (bar) bar.hidden = engineMode && !engineGameEnded;
    if (value) value.hidden = engineMode && !engineGameEnded;
    if (engineMode && engineGameEnded) requestPositionEvaluation();
  }

  function resignEngineGame() {
    if (!engineMode || engineGameEnded || isCompletedPosition()) return;
    engineGameEnded = true;
    stopEngineSearch();
    setEngineStatus("Resigned");
    if (typeof game.turn === "function") {
      // Record resignation as PGN metadata without inventing a chess move.
      game.header("Result", game.turn() === "w" ? "0-1" : "1-0");
    }
    updateEngineEndUI();
    notify("Вы сдались. Партия завершена.");
  }

  function showPromotionChooser(from, to, inputMethod = "click") {
    pendingPromotion = { from, to, inputMethod };
    let modal = $("promotionModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "promotionModal";
      modal.className = "modal-backdrop";
      modal.innerHTML = '<div class="engine-dialog panel promotion-dialog" role="dialog" aria-modal="true" aria-labelledby="promotionTitle"><div class="section-title"><h2 id="promotionTitle">Promote pawn</h2></div><p>Choose a piece:</p><div class="promotion-options"><button data-promotion="q">♕<span>Queen</span></button><button data-promotion="r">♖<span>Rook</span></button><button data-promotion="b">♗<span>Bishop</span></button><button data-promotion="n">♘<span>Knight</span></button></div><button class="btn ghost" id="promotionCancelBtn" type="button">Cancel</button></div>';
      document.body.appendChild(modal);
      modal.querySelectorAll("[data-promotion]").forEach(button => button.addEventListener("click", () => {
        const choice = button.dataset.promotion;
        const move = pendingPromotion;
        pendingPromotion = null;
        modal.hidden = true;
        if (move) commitMove(move.from, move.to, choice, move.inputMethod);
      }));
      modal.querySelector("#promotionCancelBtn").addEventListener("click", () => { pendingPromotion = null; modal.hidden = true; });
    }
    modal.hidden = false;
  }

  function renderEvaluation(score, mate = null, mateWinner = null) {
    const valueEl = $("evaluationValue");
    const whiteEl = $("evalWhite");
    const blackEl = $("evalBlack");
    if (mate !== null) {
      const whiteMate = mateWinner ? mateWinner === "w" : mate > 0;
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
    if (engineMoveTimer !== null) {
      clearTimeout(engineMoveTimer);
      engineMoveTimer = null;
    }
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
            updateEngineEndUI();
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
          playMoveSound(move);
          const recorded = moveTree.addMove(currentNode, move);
          currentNode = recorded.node;
          setActiveLeafFromNode(currentNode);
          cursor = moveTree.getNodePath(currentNode).length;
          selected = null;
          legalTargets = [];
          goTo(cursor);
          updateEngineEndUI();
          setEngineStatus(isCompletedPosition() ? "Game over" : "Your turn");
          if (!isCompletedPosition() && engineWorker) requestEngineEvaluation();
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

    // A checkmated position is terminal: Stockfish may report "mate 0",
    // whose sign cannot reliably identify the winner. Determine it from chess.js.
    if (game.in_checkmate()) {
      const winner = game.turn() === "w" ? "b" : "w";
      renderEvaluation(0, 0, winner);
      return;
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


  // ---------- Game evaluation graph ----------
  let graphWorker = null;
  let graphRequestId = 0;

  function ensureEvaluationGraph() {
    let panel = $("evaluationGraph");
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "evaluationGraph";
    panel.className = "evaluation-graph panel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="evaluation-graph-heading"><strong>Перевес по ходам</strong><span id="graphStatus">Подготовка анализа…</span></div>
      <canvas id="evaluationGraphCanvas" height="150" aria-label="График оценки позиции по ходам"></canvas>
      <div class="evaluation-graph-legend"><span>Белые: +</span><span>Чёрные: −</span></div>`;
    const movesPanel = document.querySelector(".moves-panel");
    if (movesPanel) movesPanel.insertAdjacentElement("afterend", panel);
    return panel;
  }

  function drawEvaluationGraph(values) {
    const canvas = $("evaluationGraphCanvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(280, Math.round(rect.width || 320));
    const height = 190;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const pad = { l: 38, r: 12, t: 12, b: 25 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const max = Math.max(2, ...values.map(v => Math.abs(v.score)));
    const bound = Math.min(12, Math.ceil(max / 2) * 2);
    const y = score => pad.t + (bound - score) / (bound * 2) * plotH;
    const zeroY = y(0);

    ctx.fillStyle = "#343434";
    ctx.fillRect(pad.l, pad.t, plotW, plotH);

    ctx.font = "10px sans-serif";
    ctx.textBaseline = "middle";
    [-bound, 0, bound].forEach(v => {
      const yy = y(v);
      ctx.beginPath();
      ctx.setLineDash(v === 0 ? [6, 5] : []);
      ctx.strokeStyle = v === 0 ? "rgba(235,235,235,.48)" : "rgba(220,220,220,.14)";
      ctx.lineWidth = 1;
      ctx.moveTo(pad.l, yy);
      ctx.lineTo(width - pad.r, yy);
      ctx.stroke();
      ctx.fillStyle = "rgba(220,220,220,.72)";
      ctx.fillText(v > 0 ? `+${v}` : `${v}`, 3, yy);
    });
    ctx.setLineDash([]);

    if (values.length) {
      const points = values.map((v, i) => ({
        x: pad.l + (values.length === 1 ? plotW / 2 : i / (values.length - 1) * plotW),
        y: y(v.score),
        score: v.score
      }));

      // White area for White's advantage, black area for Black's advantage.
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const segments = [{ x: a.x, y: a.y, score: a.score }, { x: b.x, y: b.y, score: b.score }];
        if ((a.score < 0 && b.score > 0) || (a.score > 0 && b.score < 0)) {
          const t = a.score / (a.score - b.score);
          segments.splice(1, 0, { x: a.x + (b.x - a.x) * t, y: zeroY, score: 0 });
        }
        for (let j = 0; j < segments.length - 1; j++) {
          const p1 = segments[j], p2 = segments[j + 1];
          const midScore = (p1.score + p2.score) / 2;
          ctx.beginPath();
          ctx.moveTo(p1.x, zeroY);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p2.x, zeroY);
          ctx.closePath();
          ctx.fillStyle = midScore >= 0 ? "rgba(255,255,255,.92)" : "rgba(8,8,8,.96)";
          ctx.fill();
        }
      }

      ctx.beginPath();
      points.forEach((point, i) => {
        if (!i) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.strokeStyle = "#8bcf75";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();

      points.forEach((point, i) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, i === cursor ? 4 : 2.2, 0, Math.PI * 2);
        ctx.fillStyle = i === cursor ? "#f4d35e" : "#8bcf75";
        ctx.fill();
      });
    }

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(220,220,220,.72)";
    ctx.font = "10px sans-serif";
    ctx.fillText("Начало", pad.l, height - 5);
    ctx.fillText("Ходы", width - pad.r - 25, height - 5);
  }

  function analyzeGameGraph() {
    const panel = ensureEvaluationGraph();
    panel.hidden = false;
    const status = $("graphStatus");
    if (graphWorker) { try { graphWorker.terminate(); } catch {} graphWorker = null; }
    const request = ++graphRequestId;
    const moves = history.slice();
    const positions = [];
    const replay = new Chess();
    positions.push({ fen: replay.fen(), turn: replay.turn() });
    for (const move of moves) {
      replay.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
      positions.push({ fen: replay.fen(), turn: replay.turn(), mate: replay.in_checkmate() });
    }
    if (!moves.length) { status.textContent = "В партии пока нет ходов"; drawEvaluationGraph([{score:0}]); return; }
    const depth = 8;
    const results = [];
    let index = 0, waitingReady = false;
    try {
      const worker = new Worker("./stockfish-19-lite-single.js");
      graphWorker = worker;
      worker.addEventListener("message", e => {
        if (request !== graphRequestId || graphWorker !== worker) return;
        const msg = String(e.data || "").trim();
        if (msg === "uciok") { worker.postMessage("isready"); return; }
        if (msg === "readyok") { evaluateNext(); return; }
        if (msg.startsWith("info ")) {
          const score = msg.match(/\bscore (cp|mate) (-?\d+)/);
          if (score) {
            const raw = Number(score[2]);
            const cp = score[1] === "mate" ? (raw > 0 ? 10 : -10) : raw / 100;
            const whiteScore = positions[index].turn === "w" ? cp : -cp;
            results[index] = { score: Math.max(-12, Math.min(12, whiteScore)) };
          }
          return;
        }
        if (msg.startsWith("bestmove")) {
          if (!results[index]) results[index] = { score: 0 };
          index++;
          if (index < positions.length) evaluateNext();
          else {
            status.textContent = `${results.length} позиций · глубина ${depth}`;
            drawEvaluationGraph(results);
            try { worker.terminate(); } catch {}
            graphWorker = null;
          }
        }
      });
      worker.addEventListener("error", () => {
        if (request === graphRequestId) status.textContent = "Ошибка запуска Stockfish";
      });
      function evaluateNext() {
        if (request !== graphRequestId || index >= positions.length) return;
        if (positions[index].mate) {
          results[index] = { score: positions[index].turn === "w" ? -10 : 10 };
          index++;
          if (index < positions.length) evaluateNext();
          else { status.textContent = `${results.length} позиций`; drawEvaluationGraph(results); worker.terminate(); graphWorker = null; }
          return;
        }
        status.textContent = `Анализ ${index+1}/${positions.length}…`;
        worker.postMessage("position fen " + positions[index].fen);
        worker.postMessage("go depth " + depth);
      }
      worker.postMessage("uci");
    } catch (err) { status.textContent = "Не удалось запустить Stockfish"; }
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
    engineGameEnded = false;
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
    updateEngineEndUI();
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

  function tryMove(from, to, inputMethod = "click") {
    if (engineMode && (engineGameEnded || isCompletedPosition() || engineThinking || game.turn() === engineColor || cursor !== history.length)) return;
    const movingPiece = game.get(from);
    if (movingPiece && movingPiece.type === "p" && (to[1] === "1" || to[1] === "8")) {
      showPromotionChooser(from, to, inputMethod);
      return;
    }
    commitMove(from, to, "q", inputMethod);
  }

  function commitMove(from, to, promotion, inputMethod = "click") {
    if (engineMode && (engineGameEnded || isCompletedPosition() || engineThinking || game.turn() === engineColor || cursor !== history.length)) return;

    nextMoveAnimationMode = inputMethod === "drag" ? "none" : "default";

    if (cursor < history.length && sameMove(history[cursor], { from, to, promotion })) {
      goTo(cursor + 1);
      return;
    }

    const parentNode = currentNode;
    let move;
    try {
      move = game.move({ from, to, promotion });
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

    playMoveSound(move);
    const recorded = moveTree.addMove(parentNode, move);
    currentNode = recorded.node;
    setActiveLeafFromNode(currentNode);
    cursor = moveTree.getNodePath(currentNode).length;
    branchCreationMode = false;
    selected = null;
    legalTargets = [];

    goTo(cursor);
    updateEngineEndUI();
    if (engineMode && !isCompletedPosition() && engineWorker && game.turn() === engineColor) {
      if (engineMoveTimer !== null) clearTimeout(engineMoveTimer);
      setEngineStatus("Stockfish is preparing…");
      engineMoveTimer = setTimeout(() => {
        engineMoveTimer = null;
        requestEngineMove();
      }, ENGINE_MOVE_DELAY_MS);
    }
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

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.textContent = branchCreationMode ? "Выберите ход…" : "+ Вариант";
    addButton.title = "Перейдите к нужной позиции и сыграйте альтернативный ход";
    addButton.classList.toggle("is-armed", branchCreationMode);
    addButton.addEventListener("click", () => {
      branchCreationMode = !branchCreationMode;
      renderMoves();
      if (branchCreationMode) notify("Сделайте альтернативный ход на доске");
    });

    const branch = findBranchOnActivePath();
    const promoteButton = document.createElement("button");
    promoteButton.type = "button";
    promoteButton.textContent = "Сделать основным";
    promoteButton.disabled = !branch;
    promoteButton.title = "Переместить выбранный вариант на первое место";
    promoteButton.addEventListener("click", () => {
      const selectedBranch = findBranchOnActivePath();
      if (!selectedBranch || !moveTree.promoteToMain(selectedBranch)) return;
      setActiveLeafFromNode(selectedBranch);
      goTo(cursor);
      notify("Вариант стал основным");
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "Удалить вариант";
    deleteButton.disabled = !branch;
    deleteButton.addEventListener("click", () => {
      const selectedBranch = findBranchOnActivePath();
      if (!selectedBranch) {
        notify("Выберите вариант, который нужно удалить");
        return;
      }
      const parent = selectedBranch.parent;
      const parentPly = moveTree.getNodePath(parent).length;
      moveTree.removeBranch(selectedBranch);
      setActiveLeafFromNode(parent);
      arrows = [];
      goTo(parentPly);
      notify("Вариант удалён");
    });

    tools.append(addButton, promoteButton, deleteButton);
    list.innerHTML = "";
    list.classList.add("move-tree-list");

    if (!moveTree.root.children.length) {
      list.innerHTML = '<div class="empty">Moves will appear here.</div>';
      return;
    }

    const fragment = document.createDocumentFragment();

    function appendMove(target, node, ply, forceNumber) {
      const move = node.move;
      const number = Math.floor((ply - 1) / 2) + 1;
      if (move.color === "w") {
        target.appendChild(document.createTextNode(number + ". "));
      } else if (forceNumber) {
        target.appendChild(document.createTextNode(number + "... "));
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "move-cell move-tree-cell";
      button.textContent = move.san;
      button.dataset.nodeId = node.id;
      button.classList.toggle("active", currentNode === node);
      button.setAttribute("aria-label", "Ход " + move.san);
      button.addEventListener("click", () => goToMoveNode(node));
      target.appendChild(button);
    }

    function renderSequence(parent, ply, target) {
      if (!parent.children.length) return;

      const main = parent.children[0];
      const alternatives = parent.children.slice(1);

      appendMove(target, main, ply, false);

      alternatives.forEach(alternative => {
        target.appendChild(document.createTextNode(" "));
        const group = document.createElement("span");
        group.className = "move-variation";
        group.appendChild(document.createTextNode("("));
        appendMove(group, alternative, ply, true);
        renderSequence(alternative, ply + 1, group);
        group.appendChild(document.createTextNode(")"));
        target.appendChild(group);
      });

      if (main.children.length) {
        target.appendChild(document.createTextNode(" "));
        renderSequence(main, ply + 1, target);
      }
    }

    renderSequence(moveTree.root, 1, fragment);
    list.appendChild(fragment);

    const active = list.querySelector(".move-tree-cell.active");
    if (active) {
      const activeTop = active.offsetTop - list.offsetTop;
      const activeBottom = activeTop + active.offsetHeight;
      if (activeTop < list.scrollTop) list.scrollTop = activeTop;
      else if (activeBottom > list.scrollTop + list.clientHeight) {
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

    } else if (typeof game.in_threefold_repetition === "function" && game.in_threefold_repetition()) {

      text = "Draw — threefold repetition";

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
    const date = m.date ? m.date.replaceAll("-", ".") : "????.??.??";
    const headers = [
      ["Event", m.event], ["Site", "?"], ["Date", date], ["Round", "?"],
      ["White", m.white], ["Black", m.black], ["Result", gameResult()]
    ];
    if (m.whiteElo) headers.push(["WhiteElo", m.whiteElo]);
    if (m.blackElo) headers.push(["BlackElo", m.blackElo]);

    const headerText = headers.map(([key, value]) => {
      const safeValue = String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      return "[" + key + ' "' + safeValue + '"]';
    }).join("\n");

    const formatMove = (move, ply, forceNumber) => {
      const number = Math.floor((ply - 1) / 2) + 1;
      if (move.color === "w") return number + ". " + move.san;
      return forceNumber ? number + "... " + move.san : move.san;
    };

    function emit(parent, ply) {
      if (!parent.children.length) return "";
      const main = parent.children[0];
      let output = formatMove(main.move, ply, false);
      for (const alternative of parent.children.slice(1)) {
        const variation = formatMove(alternative.move, ply, true) + emit(alternative, ply + 1);
        output += " (" + variation.trim() + ")";
      }
      const continuation = emit(main, ply + 1);
      if (continuation) output += " " + continuation;
      return output;
    }

    return headerText + "\n\n" + emit(moveTree.root, 1).trim() + " " + gameResult();
  }

    function parsePgnToTree(pgnText) {
    const headers = {};
    const headerPattern = /^\s*\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"])*)"\]\s*$/gm;
    let body = String(pgnText || "").replace(headerPattern, (_, key, value) => {
      headers[key] = value.replace(/\\(["\\])/g, "$1");
      return " ";
    });
    body = body.replace(/\{[\s\S]*?\}/g, " ").replace(/;[^\r\n]*/g, " ");
    const tokens = body.match(/\(|\)|[^\s]+/g) || [];
    const tree = new window.ChessStudyMoveTree();
    let node = tree.root;
    let parser = new Chess();
    const stack = [];

    const restorePosition = target => {
      parser = new Chess();
      for (const move of tree.getPath(target)) {
        const restored = parser.move({
          from: move.from, to: move.to, promotion: move.promotion || "q"
        });
        if (!restored) throw new Error("Не удалось восстановить позицию при разборе PGN");
      }
    };

    for (const raw of tokens) {
      if (raw === "(") {
        if (!node || node === tree.root || !node.parent) throw new Error("Некорректное начало варианта PGN");
        stack.push(node);
        node = node.parent;
        restorePosition(node);
        continue;
      }

      if (raw === ")") {
        if (!stack.length) throw new Error("Лишняя закрывающая скобка в PGN");
        node = stack.pop();
        restorePosition(node);
        continue;
      }

      let san = raw.replace(/^\d+\.(?:\.\.)?/, "");
      if (!san || /^\$\d+$/.test(san) ||
          /^(1-0|0-1|1\/2-1\/2|\*)$/.test(san)) continue;
      if (/^(e\.p\.|!?|\?+|!+)$/.test(san)) continue;
      san = san.replace(/[!?]+$/, "");

      let move = null;
      try { move = parser.move(san, { sloppy: true }); } catch {}
      if (!move && /[+#]$/.test(san)) {
        try { move = parser.move(san.replace(/[+#]+$/, ""), { sloppy: true }); } catch {}
      }
      if (!move) throw new Error("Не удалось распознать ход PGN: " + san);

      const recorded = tree.addMove(node, move);
      node = recorded.node;
    }

    if (stack.length) throw new Error("Не закрыты скобки варианта в PGN");
    return { tree, headers };
  }

  function importPgnText(text) {
    let parsed;
    try {
      parsed = parsePgnToTree(text);
    } catch (error) {
      console.error("PGN import error:", error);
      notify(error.message || "PGN could not be loaded. Check the file format.");
      return;
    }

    moveTree = parsed.tree;
    activeLeaf = moveTree.mainLeafFrom(moveTree.root);
    currentNode = activeLeaf;
    history = moveTree.getPath(activeLeaf);
    cursor = history.length;
    branchCreationMode = false;
    currentId = null;
    arrows = [];

    const h = parsed.headers;
    const validDate = h.Date && /^\d{4}\.\d{2}\.\d{2}$/.test(h.Date);
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
    notify("PGN imported with variations");
  }

    // ---------- Save / load / database ----------



  function saveGame() {
    const m = metaFromInputs();
    const games = readGames();
    const flattened = moveTree.toLines();
    const item = {
      id: currentId || ("g" + Date.now() + Math.random().toString(16).slice(2, 7)),
      ...m,
      pgn: buildPgn(),
      moveTree: moveTree.serialize(),
      activePath: moveTree.getPath(activeLeaf),
      activeCursor: cursor,
      lines: flattened.map((moves, index) => ({
        id: index === 0 ? "main" : "variation-" + index,
        name: index === 0 ? "Основная линия" : "Вариант " + index,
        moves: moves.map(move => ({ ...move }))
      })),
      activeLineId: "main",
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

    let parsedPgn = null;
    if (item.pgn) {
      try { parsedPgn = parsePgnToTree(item.pgn); }
      catch (error) { console.warn("Saved PGN tree parse failed:", error); }
    }

    if (item.moveTree) {
      moveTree = window.ChessStudyMoveTree.fromSerialized(item.moveTree);
    } else if (Array.isArray(item.lines) && item.lines.length) {
      moveTree = window.ChessStudyMoveTree.fromLegacyLines(item.lines);
    } else if (parsedPgn) {
      moveTree = parsedPgn.tree;
    } else {
      const temp = new Chess();
      if (!temp.load_pgn(item.pgn || "")) {
        notify("Could not read this PGN");
        return;
      }
      moveTree = new window.ChessStudyMoveTree(temp.history({ verbose: true }));
    }

    let restoredNode = null;
    if (Array.isArray(item.activePath)) restoredNode = moveTree.atPath(item.activePath);
    if (!restoredNode && Array.isArray(item.lines) && item.activeLineId) {
      const oldLine = item.lines.find(line => line.id === item.activeLineId);
      if (oldLine) restoredNode = moveTree.atPath(oldLine.moves || []);
    }

    activeLeaf = moveTree.mainLeafFrom(restoredNode || moveTree.root);
    currentNode = activeLeaf;
    history = moveTree.getPath(activeLeaf);
    cursor = Math.max(0, Math.min(Number(item.activeCursor ?? history.length), history.length));
    branchCreationMode = false;
    currentId = item.id;
    arrows = [];

    loadMeta(item);
    goTo(cursor);
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
    engineGameEnded = false;
    pendingPromotion = null;
    if ($("promotionModal")) $("promotionModal").hidden = true;
    renderEvaluation(0);
    engineAnalysisOnly = false;

    if (engineMode) stopEngineSearch();
    game = new Chess();



    moveTree = new window.ChessStudyMoveTree();
    activeLeaf = moveTree.root;
    currentNode = moveTree.root;
    history = [];
    cursor = 0;
    branchCreationMode = false;



    selected = null;

    legalTargets = [];

    currentId = null;

    arrows = [];

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
    const analyzeButton = $("analyzeBtn");
    if (analyzeButton) analyzeButton.addEventListener("click", analyzeGameGraph);

    // Unlock browser audio on the first genuine user interaction so that
    // Stockfish replies can also produce sounds later in the game.
    document.addEventListener("pointerdown", unlockChessAudio);
    const engineModal = $("engineModal");
    const settingsModal = $("settingsModal");
    $("settingsModalOpenBtn").addEventListener("click", () => { settingsModal.hidden = false; });
    $("settingsModalCloseBtn").addEventListener("click", () => { settingsModal.hidden = true; });
    settingsModal.addEventListener("click", event => { if (event.target === settingsModal) settingsModal.hidden = true; });
    $("themeSelect").addEventListener("change", event => {
      appearanceSettings.theme = event.target.value; applyAppearanceSettings(); saveAppearanceSettings();
    });
    if (window.matchMedia) {
      const systemThemeQuery = window.matchMedia("(prefers-color-scheme: light)");
      systemThemeQuery.addEventListener?.("change", () => {
        if (appearanceSettings.theme === "system") applyAppearanceSettings();
      });
    }
    $("liquidGlassToggle").addEventListener("change", event => {
      appearanceSettings.liquidGlass = event.target.checked; applyAppearanceSettings(); saveAppearanceSettings();
    });
    $("glassStrength").addEventListener("input", event => {
      appearanceSettings.glassStrength = Number(event.target.value); applyAppearanceSettings(); saveAppearanceSettings();
    });
    $("glassOpacity").addEventListener("input", event => {
      appearanceSettings.glassOpacity = Number(event.target.value); applyAppearanceSettings(); saveAppearanceSettings();
    });
    $("pieceAnimationToggle").addEventListener("change", event => {
      appearanceSettings.pieceAnimation = event.target.checked; saveAppearanceSettings();
    });
    $("pieceSetSelect").addEventListener("change", event => {
      appearanceSettings.pieceSet = event.target.value === "classic" ? "classic" : "modern";
      saveAppearanceSettings();
      renderBoard();
    });
    $("soundToggle").addEventListener("change", event => {
      appearanceSettings.soundEnabled = event.target.checked;
      saveAppearanceSettings();
      if (appearanceSettings.soundEnabled) unlockChessAudio();
    });
    $("backgroundFileInput").addEventListener("change", async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { notify("Выбери изображение JPG, PNG или WebP."); event.target.value = ""; return; }
      try {
        const dataUrl = await compressBackgroundImage(file);
        appearanceSettings.background = dataUrl;
        if (saveAppearanceSettings()) { applyAppearanceSettings(); notify("Фон успешно установлен."); }
      } catch (error) { notify(error.message || "Не удалось установить фон."); }
      event.target.value = "";
    });
    $("removeBackgroundBtn").addEventListener("click", () => {
      appearanceSettings.background = ""; saveAppearanceSettings(); applyAppearanceSettings(); notify("Фон сброшен.");
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        settingsModal.hidden = true;
        engineModal.hidden = true;
      }
    });
    $("engineModalOpenBtn").addEventListener("click", () => { engineModal.hidden = false; });
    $("engineModalCloseBtn").addEventListener("click", () => { engineModal.hidden = true; });
    engineModal.addEventListener("click", event => { if (event.target === engineModal) engineModal.hidden = true; });
    $("engineStartBtn").addEventListener("click", () => { startEngineGame(); engineModal.hidden = true; });
    $("engineUndoBtn").addEventListener("click", undoEngineTurn);
    $("resignBtn").addEventListener("click", resignEngineGame);

    $("newGameBtn").addEventListener("click", () => {
      if (engineMode) {
        closeEngine();
        engineMode = false;
        engineGameEnded = false;
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
    readAppearanceSettings();
    applyAppearanceSettings();

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