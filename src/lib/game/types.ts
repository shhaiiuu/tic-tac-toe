export type GameMode = "classic" | "modern";
export type OpponentType = "computer" | "friend";
export type PlayerSymbol = "X" | "O";
export type Cell = PlayerSymbol | null;
export type Difficulty = "easy" | "medium" | "hard";
export type GameStatus = "playing" | "won" | "draw";

/** One applied move. `vanished` is the cell index whose mark was removed (Modern mode only). */
export interface MoveRecord {
  readonly player: PlayerSymbol;
  readonly index: number;
  readonly vanished: number | null;
}

/**
 * The single authoritative state of one round.
 *
 * `marks` keeps every player's active cell indices in the order they were placed
 * (oldest first). A bare X/O board cannot tell which mark is oldest, so Modern
 * mode relies on this list.
 */
export interface GameState {
  readonly mode: GameMode;
  readonly board: readonly Cell[];
  readonly current: PlayerSymbol;
  readonly marks: Readonly<Record<PlayerSymbol, readonly number[]>>;
  readonly status: GameStatus;
  readonly winner: PlayerSymbol | null;
  readonly winLine: readonly number[] | null;
  readonly history: readonly MoveRecord[];
}

/** Everything a session needs to know about how the round is played. */
export interface GameConfig {
  readonly mode: GameMode;
  readonly opponent: OpponentType;
  readonly difficulty: Difficulty;
  /** Which symbol the human plays against the computer. In friend mode Player 1 is always X. */
  readonly humanSymbol: PlayerSymbol;
  readonly names: Readonly<Record<PlayerSymbol, string>>;
}
