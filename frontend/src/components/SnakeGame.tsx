import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";

/**
 * Retro grid snake, built for endless play.
 *
 * Design decisions worth knowing:
 *  - Edges WRAP instead of killing you. "Endless" means the only way to lose is
 *    running into yourself, and a loss instantly respawns — the board is never
 *    in a terminal state waiting for a click.
 *  - It plays ITSELF until you touch a control (BFS pathfinding to the food).
 *    The hero is alive on page load rather than a dead "press start" screen.
 *  - Fixed-timestep logic decoupled from rendering, so speed is identical on a
 *    60Hz and a 144Hz display, and the renderer interpolates BETWEEN ticks so
 *    the snake glides rather than teleporting a whole cell at a time.
 */

const COLS = 24;
const ROWS = 15;

// Tick interval in ms: starts slow, floors at FAST so it never gets unplayable.
const TICK_START = 132;
const TICK_FAST = 66;

/** Ticks the death animation runs for before respawn. */
const DEATH_TICKS = 8;

const COLORS = {
  void: "#0B0F0E",
  grid: "#18211F",
  head: "#CFFFF8",
  snake: "#5EEAD4",
  snakeTail: "#235852",
  /** Autopilot runs dimmer, so a self-playing board reads as idle, not active. */
  autoHead: "#93D8D0",
  autoTail: "#375854",
  food: "#F5A623",
  dead: "#F2545B",
  deadDim: "#7A2B30",
};

interface Cell {
  x: number;
  y: number;
}

type Dir = Cell;

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
} as const;

const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: DIRS.up,
  ArrowDown: DIRS.down,
  ArrowLeft: DIRS.left,
  ArrowRight: DIRS.right,
  w: DIRS.up,
  s: DIRS.down,
  a: DIRS.left,
  d: DIRS.right,
  W: DIRS.up,
  S: DIRS.down,
  A: DIRS.left,
  D: DIRS.right,
};

/** Wrap a coordinate onto the torus. */
const wrap = (v: number, max: number) => (v + max) % max;

const key = (c: Cell) => c.y * COLS + c.x;

/** Unit step from a to b on the torus, collapsing a wrap-around jump. */
function stepDelta(a: Cell, b: Cell): Cell {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (dx > 1) dx = -1;
  else if (dx < -1) dx = 1;
  if (dy > 1) dy = -1;
  else if (dy < -1) dy = 1;
  return { x: dx, y: dy };
}

interface Game {
  snake: Cell[];
  dir: Dir;
  /** Buffered turns, so two fast key presses both register across ticks. */
  queue: Dir[];
  food: Cell;
  score: number;
  best: number;
  /** Frames remaining on the death flash before respawn. */
  dying: number;
  autopilot: boolean;
  paused: boolean;
  /** Cell the tail vacated on the last tick, so the render can retract it. */
  popped: Cell | null;
  /** True when the last tick grew the snake, meaning the tail did not move. */
  grew: boolean;
}

function spawnFood(snake: Cell[]): Cell {
  const taken = new Set(snake.map(key));
  const free: Cell[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!taken.has(y * COLS + x)) free.push({ x, y });
    }
  }
  if (free.length === 0) return { x: 0, y: 0 }; // board full: unreachable in practice
  return free[Math.floor(Math.random() * free.length)];
}

function freshGame(best: number): Game {
  const snake: Cell[] = [
    { x: 8, y: 7 },
    { x: 7, y: 7 },
    { x: 6, y: 7 },
  ];
  return {
    snake,
    dir: DIRS.right,
    queue: [],
    food: spawnFood(snake),
    score: 0,
    best,
    dying: 0,
    autopilot: true,
    paused: false,
    popped: null,
    grew: false,
  };
}

/**
 * Breadth-first search from the head to the food across the wrapping grid,
 * returning the first step of a shortest path. The tail cell is walkable
 * because it vacates as we move into it.
 */
function bfsStep(snake: Cell[], food: Cell): Dir | null {
  const head = snake[0];
  const blocked = new Set(snake.slice(0, -1).map(key));
  const prev = new Map<number, number>();
  const seen = new Set<number>([key(head)]);
  let frontier: Cell[] = [head];

  while (frontier.length) {
    const next: Cell[] = [];
    for (const cell of frontier) {
      for (const dir of Object.values(DIRS)) {
        const n = { x: wrap(cell.x + dir.x, COLS), y: wrap(cell.y + dir.y, ROWS) };
        const k = key(n);
        if (seen.has(k) || blocked.has(k)) continue;
        seen.add(k);
        prev.set(k, key(cell));

        if (n.x === food.x && n.y === food.y) {
          // Walk the chain back to the cell adjacent to the head.
          let cur = k;
          while (prev.get(cur) !== key(head)) {
            const p = prev.get(cur);
            if (p === undefined) return null;
            cur = p;
          }
          const step = { x: cur % COLS, y: Math.floor(cur / COLS) };
          return stepDelta(head, step);
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

/** Count reachable cells from a position — used to avoid boxing ourselves in. */
function openSpace(snake: Cell[], from: Cell): number {
  const blocked = new Set(snake.slice(0, -1).map(key));
  const seen = new Set<number>([key(from)]);
  let frontier = [from];
  let count = 0;
  while (frontier.length && count < COLS * ROWS) {
    const next: Cell[] = [];
    for (const cell of frontier) {
      for (const dir of Object.values(DIRS)) {
        const n = { x: wrap(cell.x + dir.x, COLS), y: wrap(cell.y + dir.y, ROWS) };
        const k = key(n);
        if (seen.has(k) || blocked.has(k)) continue;
        seen.add(k);
        count++;
        next.push(n);
      }
    }
    frontier = next;
  }
  return count;
}

/** Autopilot: head for the food, else take the roomiest safe direction. */
function autoDir(game: Game): Dir {
  const path = bfsStep(game.snake, game.food);
  if (path) return path;

  const head = game.snake[0];
  const body = new Set(game.snake.slice(0, -1).map(key));
  let bestDir = game.dir;
  let bestSpace = -1;
  for (const dir of Object.values(DIRS)) {
    // Never reverse into our own neck.
    if (dir.x === -game.dir.x && dir.y === -game.dir.y) continue;
    const n = { x: wrap(head.x + dir.x, COLS), y: wrap(head.y + dir.y, ROWS) };
    if (body.has(key(n))) continue;
    const space = openSpace(game.snake, n);
    if (space > bestSpace) {
      bestSpace = space;
      bestDir = dir;
    }
  }
  return bestDir;
}

/**
 * Split a path that crosses the board edge into continuous strokes.
 *
 * A single polyline can't express a wrap: joining x=23 straight to x=0 would
 * draw a line back across the whole board. Instead each crossing is cut, and
 * both halves are extended one cell past the edge so the snake visibly leaves
 * one side while entering the other.
 */
function toStrokes(points: Cell[]): Cell[][] {
  if (points.length === 0) return [];
  const strokes: Cell[][] = [];
  let current: Cell[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
      current.push(q);
      continue;
    }
    // The real step is one cell in the direction opposite the large jump.
    const sx = Math.abs(dx) > 1 ? -Math.sign(dx) : 0;
    const sy = Math.abs(dy) > 1 ? -Math.sign(dy) : 0;
    current.push({ x: p.x + sx, y: p.y + sy });
    strokes.push(current);
    current = [{ x: q.x - sx, y: q.y - sy }, q];
  }
  strokes.push(current);
  return strokes;
}

interface Ripple {
  x: number;
  y: number;
  born: number;
  kind: "eat" | "death";
}

const BEST_KEY = "netlapse.snake.best";

export default function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game>(freshGame(0));
  const ripplesRef = useRef<Ripple[]>([]);
  // Mirrors of game state for the React-rendered HUD.
  const [hud, setHud] = useState({ score: 0, best: 0, autopilot: true, paused: false });

  const setDirection = useCallback((dir: Dir) => {
    const game = gameRef.current;
    game.autopilot = false;
    game.paused = false;
    setHud((h) => (h.autopilot || h.paused ? { ...h, autopilot: false, paused: false } : h));
    const last = game.queue.length ? game.queue[game.queue.length - 1] : game.dir;
    // Ignore no-ops and 180° reversals.
    if (dir.x === last.x && dir.y === last.y) return;
    if (dir.x === -last.x && dir.y === -last.y) return;
    if (game.queue.length < 3) game.queue.push(dir);
  }, []);

  const togglePause = useCallback(() => {
    const game = gameRef.current;
    game.paused = !game.paused;
    setHud((h) => ({ ...h, paused: game.paused }));
  }, []);

  const restart = useCallback(() => {
    const game = gameRef.current;
    gameRef.current = { ...freshGame(game.best), autopilot: false };
    ripplesRef.current = [];
    setHud((h) => ({ ...h, score: 0, autopilot: false, paused: false }));
  }, []);

  // Load the stored best score once.
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(BEST_KEY) ?? 0);
    if (Number.isFinite(stored) && stored > 0) {
      gameRef.current.best = stored;
      setHud((h) => ({ ...h, best: stored }));
    }
  }, []);

  // Keyboard. Arrow keys only preventDefault while the board is on screen,
  // so arrow-scrolling the rest of the page still works.
  useEffect(() => {
    let visible = true;
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting), { threshold: 0.35 });
    if (wrapRef.current) io.observe(wrapRef.current);

    const onKey = (e: KeyboardEvent) => {
      if (!visible) return;
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        togglePause();
        return;
      }
      if (e.key === "r" || e.key === "R") {
        restart();
        return;
      }
      const dir = KEY_DIRS[e.key];
      if (!dir) return;
      e.preventDefault();
      setDirection(dir);
    };

    window.addEventListener("keydown", onKey, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      io.disconnect();
    };
  }, [setDirection, togglePause, restart]);

  // Swipe controls.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let start: { x: number; y: number } | null = null;

    const down = (e: PointerEvent) => {
      start = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) {
        togglePause(); // a tap, not a swipe
        return;
      }
      if (Math.abs(dx) > Math.abs(dy)) setDirection(dx > 0 ? DIRS.right : DIRS.left);
      else setDirection(dy > 0 ? DIRS.down : DIRS.up);
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerup", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerup", up);
    };
  }, [setDirection, togglePause]);

  // The loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = wrapRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Decorative motion only — the game itself still moves either way.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let cell = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = container.clientWidth;
      cell = width / COLS;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(cell * ROWS * dpr);
      canvas.style.height = `${cell * ROWS}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // Pause when scrolled away or the tab is hidden — no point burning cycles.
    let onScreen = true;
    const io = new IntersectionObserver(([entry]) => (onScreen = entry.isIntersecting), { threshold: 0 });
    io.observe(container);

    const step = () => {
      const game = gameRef.current;

      if (game.dying > 0) {
        game.dying -= 1;
        if (game.dying === 0) {
          const best = Math.max(game.best, game.score);
          const keepManual = !game.autopilot;
          gameRef.current = { ...freshGame(best), autopilot: !keepManual };
          setHud((h) => ({ ...h, score: 0, best }));
        }
        return;
      }

      if (game.autopilot) game.dir = autoDir(game);
      else if (game.queue.length) game.dir = game.queue.shift()!;

      const head = game.snake[0];
      const next = { x: wrap(head.x + game.dir.x, COLS), y: wrap(head.y + game.dir.y, ROWS) };

      // Self-collision. The tail is exempt because it moves out of the way,
      // unless we're about to grow into it.
      const ate = next.x === game.food.x && next.y === game.food.y;
      const body = ate ? game.snake : game.snake.slice(0, -1);
      if (body.some((c) => c.x === next.x && c.y === next.y)) {
        game.dying = DEATH_TICKS;
        ripplesRef.current.push({ x: next.x, y: next.y, born: performance.now(), kind: "death" });
        const best = Math.max(game.best, game.score);
        if (best > game.best) {
          game.best = best;
          window.localStorage.setItem(BEST_KEY, String(best));
          setHud((h) => ({ ...h, best }));
        }
        return;
      }

      game.snake.unshift(next);
      game.grew = ate;
      if (ate) {
        game.score += 1;
        game.popped = null;
        ripplesRef.current.push({ x: next.x, y: next.y, born: performance.now(), kind: "eat" });
        game.food = spawnFood(game.snake);
        setHud((h) => ({ ...h, score: game.score }));
      } else {
        game.popped = game.snake.pop() ?? null;
      }
    };

    /** Stroke a set of wrap-split polylines in cell coordinates. */
    const strokeAll = (strokes: Cell[][], color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const stroke of strokes) {
        if (stroke.length === 0) continue;
        ctx.beginPath();
        stroke.forEach((p, i) => {
          const px = (p.x + 0.5) * cell;
          const py = (p.y + 0.5) * cell;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        // A single point still needs a segment for the round cap to render.
        if (stroke.length === 1) {
          const p = stroke[0];
          ctx.lineTo((p.x + 0.5) * cell, (p.y + 0.5) * cell);
        }
        ctx.stroke();
      }
    };

    /**
     * The snake's centreline, interpolated `t` of the way through the current
     * tick. Only the head and tail actually move between ticks; the body cells
     * in between are stationary, which is what makes this cheap and exact.
     */
    const centreline = (game: Game, t: number): Cell[] => {
      const { snake, dir, popped, grew } = game;
      const head = {
        x: snake[0].x - dir.x * (1 - t),
        y: snake[0].y - dir.y * (1 - t),
      };
      const points: Cell[] = [head, ...snake.slice(1)];
      if (!grew && popped) {
        const back = stepDelta(popped, snake[snake.length - 1]);
        points.push({ x: popped.x + back.x * t, y: popped.y + back.y * t });
      }
      return points;
    };

    const draw = (now: number, t: number) => {
      const game = gameRef.current;
      const w = COLS * cell;
      const h = ROWS * cell;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLORS.void;
      ctx.fillRect(0, 0, w, h);

      // Grid dots.
      ctx.fillStyle = COLORS.grid;
      const dot = Math.max(1.5, cell * 0.08);
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          ctx.fillRect(x * cell + cell / 2 - dot / 2, y * cell + cell / 2 - dot / 2, dot, dot);
        }
      }

      // Ripples: a ring on eat, a bigger shockwave on death.
      const ripples = ripplesRef.current;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const ripple = ripples[i];
        const age = (now - ripple.born) / (ripple.kind === "death" ? 620 : 420);
        if (age >= 1 || reduced) {
          ripples.splice(i, 1);
          continue;
        }
        const reach = cell * (ripple.kind === "death" ? 2.6 : 1.5);
        ctx.strokeStyle = ripple.kind === "death" ? COLORS.dead : COLORS.food;
        ctx.globalAlpha = (1 - age) * 0.7;
        ctx.lineWidth = Math.max(1, cell * 0.1 * (1 - age));
        ctx.beginPath();
        ctx.arc((ripple.x + 0.5) * cell, (ripple.y + 0.5) * cell, age * reach, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Food: a packet with a pulsing halo ring.
      const pulse = reduced ? 0.5 : 0.5 + Math.sin(now * 0.005) * 0.5;
      const fx = (game.food.x + 0.5) * cell;
      const fy = (game.food.y + 0.5) * cell;
      ctx.strokeStyle = COLORS.food;
      ctx.globalAlpha = 0.16 + pulse * 0.2;
      ctx.lineWidth = Math.max(1, cell * 0.07);
      ctx.beginPath();
      ctx.arc(fx, fy, cell * (0.38 + pulse * 0.16), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(reduced ? Math.PI / 4 : now * 0.0012);
      ctx.shadowColor = COLORS.food;
      ctx.shadowBlur = 10 + pulse * 8;
      ctx.fillStyle = COLORS.food;
      const fr = cell * 0.2;
      roundRect(ctx, -fr, -fr, fr * 2, fr * 2, fr * 0.45);
      ctx.fill();
      ctx.restore();
      ctx.shadowBlur = 0;

      // Snake, as one continuous body. Drawn tail-first in bands so colour and
      // thickness taper toward the tail, with the brightest band on top.
      const dying = game.dying > 0;
      const points = centreline(game, dying ? 1 : t);
      const spans = Math.max(1, points.length - 1);
      const bands = Math.min(10, Math.max(3, Math.round(spans / 2)));

      if (dying) {
        // Fade the whole body out and flash it, rather than blinking segments.
        const fade = game.dying / DEATH_TICKS;
        ctx.globalAlpha = 0.25 + fade * 0.75;
        strokeAll(toStrokes(points), game.dying % 4 < 2 ? COLORS.dead : COLORS.deadDim, cell * 0.66);
        ctx.globalAlpha = 1;
      } else {
        const bodyHead = game.autopilot ? COLORS.autoHead : COLORS.snake;
        const bodyTail = game.autopilot ? COLORS.autoTail : COLORS.snakeTail;
        for (let b = bands - 1; b >= 0; b--) {
          const from = Math.floor((b * spans) / bands);
          const to = Math.ceil(((b + 1) * spans) / bands);
          // Bands share a boundary point so the round joins overlap seamlessly.
          const slice = points.slice(from, to + 1);
          const depth = b / bands;
          if (b === 0) {
            ctx.shadowColor = bodyHead;
            ctx.shadowBlur = reduced ? 0 : 12;
          }
          strokeAll(toStrokes(slice), mix(bodyHead, bodyTail, depth), cell * (0.7 - depth * 0.22));
          ctx.shadowBlur = 0;
        }

        // Bright core at the head: reads as the packet in flight. Mid-wrap the
        // interpolated head sits just off the board, so it's also drawn at its
        // torus twin — otherwise the core blinks out on every edge crossing.
        const head = points[0];
        ctx.fillStyle = game.autopilot ? COLORS.snake : COLORS.head;
        ctx.shadowColor = COLORS.head;
        ctx.shadowBlur = reduced ? 0 : 14;
        for (const at of [head, { x: head.x + COLS, y: head.y }, { x: head.x - COLS, y: head.y }, { x: head.x, y: head.y + ROWS }, { x: head.x, y: head.y - ROWS }]) {
          if (at.x < -1 || at.x > COLS || at.y < -1 || at.y > ROWS) continue;
          ctx.beginPath();
          ctx.arc((at.x + 0.5) * cell, (at.y + 0.5) * cell, cell * 0.17, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }
    };

    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(now - last, 250); // clamp so a backgrounded tab doesn't fast-forward
      last = now;

      const game = gameRef.current;
      // Speed ramps with score but never past TICK_FAST.
      const interval = Math.max(TICK_FAST, TICK_START - game.score * 3);
      let t = 1;
      if (onScreen && !document.hidden && !game.paused) {
        acc += dt;
        while (acc >= interval) {
          acc -= interval;
          step();
        }
        t = Math.min(1, acc / interval);
      } else {
        acc = 0;
      }
      draw(now, t);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  const interval = Math.max(TICK_FAST, TICK_START - hud.score * 3);
  const speedLevel = Math.round(((TICK_START - interval) / (TICK_START - TICK_FAST)) * 5);
  const leading = hud.score > 0 && hud.score >= hud.best;

  const dpad =
    "grid h-11 w-11 place-items-center rounded-md border border-line/80 bg-surface2/70 text-muted transition-all active:scale-90 active:border-signal/60 active:bg-signal/10 active:text-signal";
  const chip =
    "rounded-md border border-line px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted transition-colors hover:border-signal/50 hover:text-signal active:scale-95";

  return (
    <div className="w-full">
      {/* HUD */}
      <div className="mb-2.5 flex items-end justify-between gap-3 font-mono">
        <div className="flex items-baseline gap-4 sm:gap-5">
          <div>
            <p className="text-[9px] uppercase tracking-[0.2em] text-muted">score</p>
            <p key={hud.score} className="animate-scale-in text-xl leading-tight text-signal sm:text-2xl">
              {String(hud.score).padStart(2, "0")}
            </p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-[0.2em] text-muted">best</p>
            <p
              key={hud.best}
              className={`animate-scale-in text-xl leading-tight transition-colors sm:text-2xl ${
                leading ? "text-warn" : "text-ink/60"
              }`}
            >
              {String(hud.best).padStart(2, "0")}
            </p>
          </div>
          <div className="hidden xs:block">
            <p className="text-[9px] uppercase tracking-[0.2em] text-muted">length</p>
            <p className="text-xl leading-tight text-ink/40 sm:text-2xl">{String(hud.score + 3).padStart(2, "0")}</p>
          </div>
        </div>

        {/* Speed meter — the tick rate is real, so show it climbing. */}
        <div className="flex flex-col items-end gap-1.5">
          <p className="text-[9px] uppercase tracking-[0.2em] text-muted">speed</p>
          <div className="flex items-end gap-[3px]" role="img" aria-label={`Speed level ${speedLevel} of 5`}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={`w-[3px] rounded-sm transition-all duration-500 ${
                  i < speedLevel ? "bg-signal" : "bg-line"
                }`}
                style={{ height: `${7 + i * 3}px` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Board. aspect-ratio keeps the grid square-celled at every width. */}
      <div
        ref={wrapRef}
        className="relative overflow-hidden rounded-lg border border-line bg-void shadow-lift"
        style={{ aspectRatio: `${COLS} / ${ROWS}` }}
      >
        <canvas ref={canvasRef} className="block w-full touch-none" aria-label="Snake game board" role="img" />

        {/* CRT dressing: static gradients, so nothing here animates. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-60 mix-blend-overlay"
          style={{
            background:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.5) 0px, rgba(0,0,0,0.5) 1px, transparent 1px, transparent 3px)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.5) 100%)" }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-lg"
          style={{ boxShadow: "inset 0 0 40px -12px rgba(94,234,212,0.18)" }}
        />

        {hud.paused && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-void/55 backdrop-blur-[2px]">
            <div className="animate-scale-in rounded-lg border border-warn/40 bg-void/80 px-4 py-2.5 text-center">
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-warn">paused</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">
                <span className="hidden sm:inline">space to resume</span>
                <span className="sm:hidden">tap to resume</span>
              </p>
            </div>
          </div>
        )}

        {hud.autopilot && !hud.paused && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3">
            <p className="flex items-center gap-2 rounded-full border border-line/80 bg-void/85 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-signal" aria-hidden="true" />
              <span className="hidden sm:inline">autoplay · arrows or wasd to take over</span>
              <span className="sm:hidden">autoplay · swipe to take over</span>
            </p>
          </div>
        )}
      </div>

      {/* Controls. The D-pad is touch-only; swiping works, but a pad is far
          more precise on a phone. */}
      <div className="mt-3 flex items-center justify-between gap-4">
        <div className="grid grid-cols-3 grid-rows-2 gap-1.5 sm:hidden">
          <button aria-label="Up" onClick={() => setDirection(DIRS.up)} className={`${dpad} col-start-2`}>
            ↑
          </button>
          <button aria-label="Left" onClick={() => setDirection(DIRS.left)} className={`${dpad} col-start-1 row-start-2`}>
            ←
          </button>
          <button aria-label="Down" onClick={() => setDirection(DIRS.down)} className={`${dpad} col-start-2 row-start-2`}>
            ↓
          </button>
          <button aria-label="Right" onClick={() => setDirection(DIRS.right)} className={`${dpad} col-start-3 row-start-2`}>
            →
          </button>
        </div>

        <p className="hidden font-mono text-[10px] uppercase tracking-[0.15em] text-muted/70 sm:block">
          <Kbd>← ↑ ↓ →</Kbd> or <Kbd>wasd</Kbd> · <Kbd>space</Kbd> pause · <Kbd>r</Kbd> restart
        </p>

        <div className="flex shrink-0 items-center gap-2">
          <button onClick={togglePause} className={`${chip} flex items-center gap-1.5`}>
            {hud.paused ? <Play size={11} /> : <Pause size={11} />}
            <span className="hidden xs:inline">{hud.paused ? "resume" : "pause"}</span>
          </button>
          <button onClick={restart} className={`${chip} flex items-center gap-1.5`}>
            <RotateCcw size={11} />
            <span className="hidden xs:inline">restart</span>
          </button>
        </div>
      </div>

      <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-muted/60">
        edges wrap, so you only ever lose to yourself
      </p>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface2/60 px-1.5 py-0.5 font-mono text-[10px] normal-case text-muted">
      {children}
    </kbd>
  );
}

/** Rounded rect path — Safari lacks reliable ctx.roundRect support. */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Linear blend between two hex colours. */
function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const out = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}
