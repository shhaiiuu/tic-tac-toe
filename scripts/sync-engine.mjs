// The Edge Function (Deno) cannot import from ../src, so the game engine is copied
// next to it. Run `bun run sync:engine` after changing src/lib/game/{types,engine}.ts.
// A unit test fails if the copies drift apart.
import { copyFileSync } from "node:fs";

for (const file of ["types.ts", "engine.ts"]) {
  copyFileSync(`src/lib/game/${file}`, `supabase/functions/_shared/game/${file}`);
}
console.log("Engine copied to supabase/functions/_shared/game/");
