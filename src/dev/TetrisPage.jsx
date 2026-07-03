import React, { useEffect, useRef, useState } from 'react';

const COLS = 10;
const ROWS = 20;

const COLORS = [
  null,
  '#00e5ff',
  '#2979ff',
  '#ff6d00',
  '#ffea00',
  '#00e676',
  '#d500f9',
  '#ff1744',
];

const SHAPES = [
  null,
  [[1,1,1,1]],
  [[1,0,0],[1,1,1]],
  [[0,0,1],[1,1,1]],
  [[1,1],[1,1]],
  [[0,1,1],[1,1,0]],
  [[0,1,0],[1,1,1]],
  [[1,1,0],[0,1,1]],
];

const POINTS = [0, 100, 300, 500, 800];

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function randPiece() {
  const i = Math.floor(Math.random() * 7) + 1;
  return { shape: SHAPES[i].map(r => [...r]), color: i };
}

function rotateCW(shape) {
  const R = shape.length, C = shape[0].length;
  const out = Array.from({ length: C }, () => Array(R).fill(0));
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++)
      out[c][R - 1 - r] = shape[r][c];
  return out;
}

function valid(board, shape, { x, y }) {
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nr = y + r, nc = x + c;
      if (nc < 0 || nc >= COLS || nr >= ROWS) return false;
      if (nr >= 0 && board[nr][nc]) return false;
    }
  return true;
}

function mergeBoard(board, shape, { x, y }, color) {
  const b = board.map(r => [...r]);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) b[y + r][x + c] = color;
  return b;
}

function sweep(board) {
  const kept = board.filter(row => row.some(v => !v));
  const n = ROWS - kept.length;
  const empty = Array.from({ length: n }, () => Array(COLS).fill(0));
  return { board: [...empty, ...kept], n };
}

function drawBlock(ctx, x, y, ci, bs) {
  ctx.fillStyle = COLORS[ci];
  ctx.fillRect(x * bs + 1, y * bs + 1, bs - 2, bs - 2);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(x * bs + 1, y * bs + 1, bs - 2, 3);
  ctx.fillRect(x * bs + 1, y * bs + 1, 3, bs - 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x * bs + bs - 3, y * bs + 1, 2, bs - 2);
  ctx.fillRect(x * bs + 1, y * bs + bs - 3, bs - 2, 2);
}

function renderGame(canvas, gs) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const bs = Math.floor(canvas.width / COLS);

  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#16163a';
  ctx.lineWidth = 1;
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * bs); ctx.lineTo(COLS * bs, r * bs); ctx.stroke();
  }
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c * bs, 0); ctx.lineTo(c * bs, ROWS * bs); ctx.stroke();
  }

  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (gs.board[r][c]) drawBlock(ctx, c, r, gs.board[r][c], bs);

  if (gs.piece && !gs.over) {
    let gy = gs.py;
    while (valid(gs.board, gs.piece.shape, { x: gs.px, y: gy + 1 })) gy++;
    if (gy > gs.py) {
      for (let r = 0; r < gs.piece.shape.length; r++)
        for (let c = 0; c < gs.piece.shape[r].length; c++)
          if (gs.piece.shape[r][c]) {
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect((gs.px + c) * bs + 1, (gy + r) * bs + 1, bs - 2, bs - 2);
          }
    }
    for (let r = 0; r < gs.piece.shape.length; r++)
      for (let c = 0; c < gs.piece.shape[r].length; c++)
        if (gs.piece.shape[r][c]) drawBlock(ctx, gs.px + c, gs.py + r, gs.piece.color, bs);
  }
}

export function TetrisPage() {
  const canvasRef = useRef(null);
  const gsRef = useRef(null);
  const rafRef = useRef(null);
  const touchRef = useRef({ x: 0, y: 0, t: 0 });
  const [ui, setUi] = useState({ score: 0, lines: 0, level: 1, over: false, started: false });

  function spawn(gs) {
    gs.piece = gs.next || randPiece();
    gs.next = randPiece();
    gs.px = Math.floor(COLS / 2) - Math.floor(gs.piece.shape[0].length / 2);
    gs.py = 0;
    if (!valid(gs.board, gs.piece.shape, { x: gs.px, y: gs.py })) gs.over = true;
  }

  function start() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const gs = {
      board: createBoard(), piece: null, next: null,
      px: 0, py: 0, score: 0, lines: 0, level: 1,
      over: false, paused: false, drop: 800, lastDrop: performance.now(),
    };
    gsRef.current = gs;
    spawn(gs);
    setUi({ score: 0, lines: 0, level: 1, over: false, started: true });

    const loop = (ts) => {
      const g = gsRef.current;
      if (!g) return;
      if (g.over) { renderGame(canvasRef.current, g); setUi(u => ({ ...u, over: true })); return; }

      if (!g.paused && ts - g.lastDrop > g.drop) {
        g.lastDrop = ts;
        if (valid(g.board, g.piece.shape, { x: g.px, y: g.py + 1 })) {
          g.py++;
        } else {
          g.board = mergeBoard(g.board, g.piece.shape, { x: g.px, y: g.py }, g.piece.color);
          const { board: nb, n } = sweep(g.board);
          g.board = nb;
          if (n > 0) {
            g.score += POINTS[Math.min(n, 4)] * g.level;
            g.lines += n;
            g.level = Math.floor(g.lines / 10) + 1;
            g.drop = Math.max(100, 800 - (g.level - 1) * 70);
            setUi({ score: g.score, lines: g.lines, level: g.level, over: false, started: true });
          }
          spawn(g);
        }
      }

      renderGame(canvasRef.current, g);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  function tryRotate(g) {
    if (!g || g.over || g.paused) return;
    const r = rotateCW(g.piece.shape);
    for (const ox of [0, 1, -1, 2, -2]) {
      if (valid(g.board, r, { x: g.px + ox, y: g.py })) {
        g.piece = { ...g.piece, shape: r };
        g.px += ox;
        break;
      }
    }
  }

  // Keyboard
  useEffect(() => {
    const onKey = (e) => {
      const g = gsRef.current;
      if (!g || g.over) return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          if (!g.paused && valid(g.board, g.piece.shape, { x: g.px - 1, y: g.py })) g.px--;
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (!g.paused && valid(g.board, g.piece.shape, { x: g.px + 1, y: g.py })) g.px++;
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (!g.paused && valid(g.board, g.piece.shape, { x: g.px, y: g.py + 1 })) g.py++;
          break;
        case 'ArrowUp': case 'z': case 'Z':
          e.preventDefault();
          tryRotate(g);
          break;
        case ' ':
          e.preventDefault();
          if (!g.paused) { while (valid(g.board, g.piece.shape, { x: g.px, y: g.py + 1 })) g.py++; g.lastDrop = 0; }
          break;
        case 'p': case 'P':
          g.paused = !g.paused;
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Canvas sizing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const maxW = Math.min(canvas.parentElement.clientWidth - 16, 340);
      const bs = Math.floor(maxW / COLS);
      canvas.width = bs * COLS;
      canvas.height = bs * ROWS;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // Touch
  const onTouchStart = (e) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };

  const onTouchEnd = (e) => {
    const g = gsRef.current;
    if (!g || g.over || g.paused) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;
    const dt = Date.now() - touchRef.current.t;
    const ax = Math.abs(dx), ay = Math.abs(dy);

    if (ax < 12 && ay < 12 && dt < 250) {
      tryRotate(g);
    } else if (ax > ay) {
      if (dx > 20 && valid(g.board, g.piece.shape, { x: g.px + 1, y: g.py })) g.px++;
      else if (dx < -20 && valid(g.board, g.piece.shape, { x: g.px - 1, y: g.py })) g.px--;
    } else if (dy > 30) {
      if (dy > 100) { while (valid(g.board, g.piece.shape, { x: g.px, y: g.py + 1 })) g.py++; g.lastDrop = 0; }
      else if (valid(g.board, g.piece.shape, { x: g.px, y: g.py + 1 })) g.py++;
    }
  };

  const btn = 'bg-gray-800 active:bg-gray-700 text-white rounded-xl flex items-center justify-center font-bold touch-manipulation';

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-start pt-4 pb-8 px-4 select-none">
      <p className="text-gray-600 text-xs tracking-widest uppercase mb-1">noar · test pwa ios</p>
      <h1 className="text-white font-black text-3xl tracking-widest mb-4">TETRIS</h1>

      <div className="flex gap-8 mb-4">
        {[['Score', ui.score], ['Lines', ui.lines], ['Level', ui.level]].map(([label, val]) => (
          <div key={label} className="text-center">
            <p className="text-gray-500 text-xs uppercase tracking-widest">{label}</p>
            <p className="text-white font-bold text-xl">{val}</p>
          </div>
        ))}
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          className="rounded border border-gray-800 block"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          style={{ touchAction: 'none' }}
        />

        {!ui.started && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 rounded gap-5">
            <div className="text-center">
              <p className="text-cyan-400 font-black text-5xl tracking-widest mb-1">TETRIS</p>
              <p className="text-gray-500 text-sm">PWA · iOS test</p>
            </div>
            <button
              onClick={start}
              className="bg-cyan-500 text-black font-black text-lg px-12 py-3 rounded-xl touch-manipulation"
            >
              JUGAR
            </button>
          </div>
        )}

        {ui.over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 rounded gap-4">
            <p className="text-red-400 font-black text-3xl">GAME OVER</p>
            <p className="text-gray-300 text-sm">
              Score: <span className="text-white font-bold">{ui.score}</span>
            </p>
            <button
              onClick={start}
              className="bg-cyan-500 text-black font-black text-lg px-12 py-3 rounded-xl touch-manipulation"
            >
              REINICIAR
            </button>
          </div>
        )}
      </div>

      {/* Controles táctiles */}
      <div className="mt-5 flex flex-col items-center gap-2">
        <button className={`${btn} w-14 h-14 text-xl`} onClick={() => tryRotate(gsRef.current)}>↻</button>
        <div className="flex gap-2">
          <button
            className={`${btn} w-14 h-14 text-2xl`}
            onClick={() => { const g = gsRef.current; if (g && !g.over && !g.paused && valid(g.board, g.piece.shape, { x: g.px - 1, y: g.py })) g.px--; }}
          >←</button>
          <button
            className={`${btn} w-14 h-14 text-2xl`}
            onClick={() => { const g = gsRef.current; if (g && !g.over && !g.paused && valid(g.board, g.piece.shape, { x: g.px, y: g.py + 1 })) g.py++; }}
          >↓</button>
          <button
            className={`${btn} w-14 h-14 text-2xl`}
            onClick={() => { const g = gsRef.current; if (g && !g.over && !g.paused && valid(g.board, g.piece.shape, { x: g.px + 1, y: g.py })) g.px++; }}
          >→</button>
        </div>
        <button
          className="bg-cyan-800 active:bg-cyan-700 text-white font-black text-xs px-10 py-3 rounded-xl tracking-widest touch-manipulation"
          onClick={() => {
            const g = gsRef.current;
            if (!g || g.over || g.paused) return;
            while (valid(g.board, g.piece.shape, { x: g.px, y: g.py + 1 })) g.py++;
            g.lastDrop = 0;
          }}
        >
          DROP
        </button>
      </div>

      <p className="text-gray-700 text-xs mt-4 text-center">
        ← → mover · ↑ / tap rotar · ↓ bajar · Space drop duro · P pausa
      </p>
    </div>
  );
}
