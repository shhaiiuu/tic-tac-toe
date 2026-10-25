import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GameButton } from "./ui";

interface ExitConfirmationModalProps {
  open: boolean;
  /** "Stay in Game", Escape, or clicking outside the dialog. */
  onStay: () => void;
  /** "Leave Game". */
  onLeave: () => void;
}

/** Confirms leaving a game in progress. Built on the shared alert-dialog + GameButton styles. */
export function ExitConfirmationModal({ open, onStay, onLeave }: ExitConfirmationModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onStay()}>
      <AlertDialogContent className="w-[calc(100%-2.5rem)] max-w-sm rounded-[2rem] bg-card p-8 shadow-lift sm:rounded-[2rem]">
        <AlertDialogHeader className="space-y-2 text-center sm:text-center">
          <AlertDialogTitle className="font-display text-2xl font-bold">Leave Game?</AlertDialogTitle>
          <AlertDialogDescription className="text-base">
            Are you sure you want to leave this game? Your current progress will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-2 flex-col gap-3 sm:flex-col sm:space-x-0">
          <GameButton onClick={onStay}>Stay in Game</GameButton>
          <GameButton variant="coral" onClick={onLeave}>Leave Game</GameButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}