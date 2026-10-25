import type { Cell, GameMode, GameState, PlayerSymbol } from "./types.ts";

export const BOARD_SIZE = 9;
export const MAX_ACTIVE_MARKS = 3;

export type Line = readonly [number, number, number];

export const WIN_LINES: readonly Line[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export const opponentOf = (symbol: PlayerSymbol): PlayerSymbol => (symbol === "X" ? "O" : "X");

/** A fresh round: empty board, X to move, empty mark histories. */
export function createGame(mode: GameMode): GameState {
  return {
    mode,
    board: Array<Cell>(BOARD_SIZE).fill(null),
    current: "X",
    marks: { X: [], O: [] },
    status: "playing",
    winner: null,
    winLine: null,
    history: [],
  };
}

export function findWinLine(board: readonly Cell[], symbol: PlayerSymbol): readonly number[] | null {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] === symbol && board[b] === symbol && board[c] === symbol) return [a, b, c];
  }
  return null;
}

export const isBoardFull = (board: readonly Cell[]): boolean => board.every((c) => c !== null);

export function isValidMove(state: GameState, index: number): boolean {
  return (
    state.status === "playing" &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < BOARD_SIZE &&
    state.board[index] === null
  );
}

export function getLegalMoves(state: GameState): number[] {
  if (state.status !== "playing") return [];
  const moves: number[] = [];
  state.board.forEach((cell, i) => {
    if (cell === null) moves.push(i);
  });
  return moves;
}

/**
 * Modern mode: the cell whose mark disappears when `symbol` next moves
 * (their oldest mark, once they already hold three). Otherwise null.
 */
export function oldestMarkToVanish(state: GameState, symbol: PlayerSymbol = state.current): number | null {
  if (state.mode !== "modern" || state.status !== "playing") return null;
  const marks = state.marks[symbol];
  return marks.length >= MAX_ACTIVE_MARKS ? (marks[0] ?? null) : null;
}

/**
 * Applies one move and returns the new state, or null if the move is illegal.
 * The input state is never mutated.
 *
 * Modern mode: when the mover already has three marks, their oldest mark is removed
 * from the board as part of the same turn, then the new mark is placed, then the
 * resulting board is checked for a win.
 */
export function applyMove(state: GameState, index: number): GameState | null {
  if (!isValidMove(state, index)) return null;

  const player = state.current;
  const board = state.board.slice();
  const playerMarks = state.marks[player].slice();

  let vanished: number | null = null;
  if (state.mode === "modern" && playerMarks.length >= MAX_ACTIVE_MARKS) {
    vanished = playerMarks.shift() ?? null;
    if (vanished !== null) board[vanished] = null;
  }

  board[index] = player;
  playerMarks.push(index);

  const marks = {
    X: player === "X" ? playerMarks : state.marks.X,
    O: player === "O" ? playerMarks : state.marks.O,
  };
  const history = [...state.history, { player, index, vanished }];

  const winLine = findWinLine(board, player);
  if (winLine) {
    return { ...state, board, marks, history, status: "won", winner: player, winLine };
  }
  // Modern mode frees a cell on every move after the third, so it can never fill the board.
  if (state.mode === "classic" && isBoardFull(board)) {
    return { ...state, board, marks, history, status: "draw", winner: null, winLine: null };
  }
  return { ...state, board, marks, history, current: opponentOf(player) };
}
