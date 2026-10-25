import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RotateCcw, Home } from "lucide-react";
import { useEffect, useRef } from "react";
import { ResultCard } from "@/components/game/board";
import { Shell, GameButton } from "@/components/game/ui";
import { describeResult, DIFFICULTY_LABEL, MODE_INFO } from "@/lib/game/config";
import { useSession } from "@/lib/game/hooks";
import { playAgain } from "@/lib/game/session";

export const Route = createFileRoute("/result")({
  head: () => ({
    meta: [
      { title: "Round over — Tic Tac Toe" },
      { name: "description", content: "Game over — play again or head back to the menu." },
      { property: "og:title", content: "Round over — Tic Tac Toe" },
      { property: "og:description", content: "Game over — play again or head back to the menu." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Result,
});

function Result() {
  const session = useSession();
  const navigate = useNavigate();
  const finished = session?.result ?? null;
  // Play Again clears the result before navigation completes; don't bounce to the menu meanwhile.
  const replaying = useRef(false);

  // No finished round to show (e.g. page refresh): back to the menu.
  useEffect(() => {
    if (!finished && !replaying.current) navigate({ to: "/", replace: true });
  }, [finished, navigate]);

  if (!session || !finished) return <Shell>{null}</Shell>;

  const { config } = session;
  const r = describeResult(config, finished.winner);

  return (
    <Shell>
      <ResultCard tone={r.tone} title={r.title} message={r.message}>
        <GameButton
          variant="primary"
          onClick={() => {
            replaying.current = true;
            playAgain();
            navigate({ to: "/game" });
          }}
        >
          <RotateCcw className="size-4" /> Play Again
        </GameButton>
        <GameButton to="/" variant="soft"><Home className="size-4" /> Back to Menu</GameButton>
      </ResultCard>
      <div className="mt-6 flex flex-wrap justify-center gap-2 text-sm text-muted-foreground">
        <span className="rounded-full bg-primary-soft text-primary px-3 py-1 font-semibold">{MODE_INFO[config.mode].title}</span>
        <span className="rounded-full bg-coral-soft text-coral px-3 py-1 font-semibold">
          {config.opponent === "computer" ? `vs Computer · ${DIFFICULTY_LABEL[config.difficulty]}` : "Two players"}
        </span>
      </div>
    </Shell>
  );
}
