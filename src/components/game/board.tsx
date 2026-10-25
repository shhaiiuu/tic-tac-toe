import { Bot, Frown, Handshake, Trophy, User } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Cell, PlayerSymbol } from "@/lib/game/types";
import { OMark, XMark } from "./ui";

export const Mark = ({ symbol, className }: { symbol: PlayerSymbol; className?: string }) =>
  symbol === "X" ? <XMark className={className} /> : <OMark className={className} />;

/** Turn / result pill above the board. */
export function StatusPill({
  symbol,
  tone,
  pulse,
  children,
}: {
  symbol: PlayerSymbol | null;
  tone: string;
  pulse?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold", tone, pulse && "animate-pulse")}
    >
      {symbol && <Mark symbol={symbol} className="size-4" />} {children}
    </span>
  );
}

export const pillTone = (symbol: PlayerSymbol | null) =>
  symbol === "X" ? "bg-primary-soft text-primary" : symbol === "O" ? "bg-coral-soft text-coral" : "bg-muted text-muted-foreground";

export function PlayerCard({
  name,
  symbol,
  score,
  active,
  bot,
  status,
}: {
  name: string;
  symbol: PlayerSymbol;
  score: number;
  active: boolean;
  bot?: boolean;
  /** Optional small line under the name (e.g. "Offline"). */
  status?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl bg-card border p-4 text-center transition-all",
        active ? cn("shadow-lift ring-2", symbol === "X" ? "ring-primary/30" : "ring-coral/30") : "shadow-soft opacity-80",
      )}
    >
      <div className="mx-auto size-10 grid place-items-center rounded-full bg-muted text-muted-foreground">
        {bot ? <Bot className="size-5" /> : <User className="size-5" />}
      </div>
      <div className="mt-2 truncate font-display font-semibold">{name}</div>
      {status && <div className="text-xs text-muted-foreground">{status}</div>}
      <div className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
        <Mark symbol={symbol} className="size-4" />
        <span className="font-semibold text-foreground">{score}</span>
      </div>
    </div>
  );
}

/** The 3×3 grid. `interactive` = the local player may tap empty cells right now. */
export function BoardGrid({
  board,
  winLine,
  winner,
  vanishing,
  interactive,
  onCell,
}: {
  board: readonly Cell[];
  winLine: readonly number[] | null;
  winner: PlayerSymbol | null;
  vanishing: number | null;
  interactive: boolean;
  onCell: (index: number) => void;
}) {
  return (
    <div className="rounded-[2rem] bg-card border shadow-lift p-3 sm:p-4">
      <div className="grid grid-cols-3 gap-3">
        {board.map((cell, i) => {
          const canPlay = interactive && cell === null;
          const winning = winLine?.includes(i) ?? false;
          return (
            <button
              key={i}
              type="button"
              disabled={!canPlay}
              onClick={() => onCell(i)}
              aria-label={`Cell ${i + 1}, ${cell ?? "empty"}${vanishing === i ? ", will disappear on next move" : ""}`}
              className={cn(
                "aspect-square rounded-2xl bg-muted grid place-items-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                canPlay ? "hover:bg-accent hover:scale-[1.03]" : "cursor-default",
                winning && (winner === "X" ? "bg-primary-soft ring-2 ring-primary/40 scale-[1.03]" : "bg-coral-soft ring-2 ring-coral/40 scale-[1.03]"),
              )}
            >
              {cell && (
                <span className={cn("grid size-full place-items-center transition-all duration-500", vanishing === i && "opacity-35 scale-75")}>
                  {cell === "X" ? <XMark className="size-3/5 animate-pop" /> : <OMark className="size-1/2 animate-pop" />}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const RESULT_TONES = {
  win: { disc: "bg-primary-soft", icon: "text-primary", Icon: Trophy },
  lose: { disc: "bg-coral-soft", icon: "text-coral", Icon: Bot },
  loseHuman: { disc: "bg-coral-soft", icon: "text-coral", Icon: Frown },
  draw: { disc: "bg-muted", icon: "text-muted-foreground", Icon: Handshake },
} as const;

/** The result card (trophy, title, message, buttons as children). */
export function ResultCard({
  tone,
  title,
  message,
  humanOpponent,
  children,
}: {
  tone: "win" | "lose" | "draw";
  title: string;
  message: string;
  /** Use a human-friendly icon on a loss (online) instead of the computer icon. */
  humanOpponent?: boolean;
  children: ReactNode;
}) {
  const { disc, icon, Icon } = RESULT_TONES[tone === "lose" && humanOpponent ? "loseHuman" : tone];
  return (
    <div className="rounded-[2rem] bg-card border shadow-lift p-8 text-center animate-pop" role="status" aria-live="polite">
      <div className="relative mx-auto size-28">
        <div className={cn("absolute inset-0 rounded-full", disc)} />
        <div className="absolute inset-0 grid place-items-center"><Icon className={cn("size-12", icon)} strokeWidth={2.2} /></div>
        <XMark className="absolute -left-4 top-1 size-6 rotate-12" />
        <OMark className="absolute -right-3 top-3 size-5" />
        <span className="absolute -right-5 bottom-3 size-2.5 rounded-full bg-coral" />
        <span className="absolute -left-2 bottom-0 size-2 rounded-full bg-primary" />
      </div>
      <h1 className="mt-6 text-4xl font-bold">{title}</h1>
      <p className="mt-2 text-muted-foreground">{message}</p>
      <div className="mt-8 grid gap-3">{children}</div>
    </div>
  );
}
