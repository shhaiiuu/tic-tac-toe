import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react"; 
import { BoardGrid, PlayerCard, pillTone, StatusPill } from "@/components/game/board";
import { Shell, GameButton } from "@/components/game/ui";
import { buildConfig, describeResult, loadPrefs, turnLabel } from "@/lib/game/config";
import { oldestMarkToVanish } from "@/lib/game/engine";
import { useSession } from "@/lib/game/hooks";
import { ExitConfirmationModal } from "@/components/game/exit-confirmation-modal"; 
import {
  cancelPending,
  getSession,
  isComputerTurn,
  playHumanMove,
  resetRound,
  resumeComputer,
  startGame,
} from "@/lib/game/session";
import type { GameConfig, PlayerSymbol } from "@/lib/game/types";

export const Route = createFileRoute("/game")({
  head: () => ({
    meta: [
      { title: "Game — Tic Tac Toe" },
      { name: "description", content: "Play Tic Tac Toe on a clean 3×3 board." },
      { property: "og:title", content: "Game — Tic Tac Toe" },
      { property: "og:description", content: "Play Tic Tac Toe on a clean 3×3 board." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Game,
});

/** How long the finished board (with the winning line) stays visible before the result screen. */
const RESULT_DELAY_MS = 250;

function Game() {
  const session = useSession();
  const navigate = useNavigate();
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Only a match that has started and not ended needs confirmation.
  const inProgress =
    session?.game.status === "playing" &&
    session.game.history.length > 0;

  useEffect(() => {
    if (!inProgress) setConfirmLeave(false);
  }, [inProgress]);
  const askLeave = () => {
    cancelPending();
    setConfirmLeave(true);
  };
  useEffect(() => {
    // Opened directly (or after a refresh): start from the last-used setup.
    if (!getSession()) startGame(buildConfig(loadPrefs()));
    else resumeComputer();
    // Leaving the screen must never leave a computer move pending.
    return () => cancelPending();
  }, []);

  const status = session?.game.status;
  const round = session?.round;
  useEffect(() => {
    if (!status || status === "playing") return;
    const t = setTimeout(() => navigate({ to: "/result" }), RESULT_DELAY_MS);
    return () => clearTimeout(t);
  }, [status, round, navigate]);

  if (!session) return <Shell>{null}</Shell>;

  const { config, game, thinking, scores } = session;
  const playing = game.status === "playing";
  const humanTurn = playing && !isComputerTurn(session);
  const vanishing = oldestMarkToVanish(game);
  const vsComputer = config.opponent === "computer";

  const left: PlayerSymbol = vsComputer ? config.humanSymbol : "X";
  const right: PlayerSymbol = left === "X" ? "O" : "X";

  const pill = playing
    ? { text: turnLabel(config, game.current), symbol: game.current }
    : { text: describeResult(config, game.winner).title, symbol: game.winner };

  return (
    <Shell>
      <div className="flex items-center justify-between">
        <Link
          to="/"
          aria-label="Back to menu"
                    onClick={(e) => {
            if (inProgress) {
              e.preventDefault();
              askLeave();
            }
          }}
          className="size-11 grid place-items-center rounded-2xl bg-card border shadow-soft text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <StatusPill symbol={pill.symbol} tone={pillTone(pill.symbol)} pulse={thinking}>
          {pill.text}
        </StatusPill>
        <div className="size-11" />
      </div>

      <div className="mt-8 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <PlayerCard name={config.names[left]} symbol={left} score={scores[left]} active={playing && game.current === left} bot={vsComputer && left !== config.humanSymbol} />
        <span className="font-display text-sm font-semibold text-muted-foreground">VS</span>
        <PlayerCard name={config.names[right]} symbol={right} score={scores[right]} active={playing && game.current === right} bot={vsComputer && right !== config.humanSymbol} />
      </div>

      <div className="mt-8">
        <BoardGrid
          board={game.board}
          winLine={game.winLine}
          winner={game.winner}
          vanishing={vanishing}
          interactive={humanTurn}
          onCell={playHumanMove}
        />
      </div>

      <p className="mt-4 min-h-10 text-center text-sm text-muted-foreground" aria-live="polite">
        {hint(config, game.mode, playing, vanishing, game.current)}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <GameButton onClick={() => (inProgress ? askLeave() : navigate({ to: "/" }))} variant="soft"><ArrowLeft className="size-4" /> Back</GameButton>
        <GameButton onClick={resetRound} variant="primary"><RotateCcw className="size-4" /> Reset</GameButton>
      </div>
        <ExitConfirmationModal open={confirmLeave && inProgress} onStay={() => { setConfirmLeave(false); resumeComputer(); }} onLeave={() => { cancelPending(); navigate({ to: "/" }); }} />
    </Shell>
  );
}

function hint(config: GameConfig, mode: "classic" | "modern", playing: boolean, vanishing: number | null, current: PlayerSymbol) {
  if (!playing) return "";
  if (mode === "classic") return "First to get three in a row wins.";
  if (vanishing === null) return "Each player keeps at most 3 marks — the oldest vanishes.";
  if (config.opponent === "computer") {
    return current === config.humanSymbol
      ? "Your oldest mark will disappear on your next move."
      : "The computer's oldest mark will disappear on its next move.";
  }
  return `${config.names[current]}'s oldest mark will disappear on their next move.`;
}
