import { cn } from "@/lib/utils";

export type Turn = { speaker: "a" | "b"; text: string };

// iMessage-style transcript. `me` is the side shown on the right in rose;
// the other person is on the left in neutral gray.
export function ChatTranscript({
  turns,
  me,
  names,
}: {
  turns: Turn[];
  me: "a" | "b";
  names: { a: string; b: string };
}) {
  return (
    <ol className="flex flex-col gap-1.5">
      {turns.map((t, i) => {
        const mine = t.speaker === me;
        const startsRun = i === 0 || turns[i - 1].speaker !== t.speaker;
        const endsRun = i === turns.length - 1 || turns[i + 1].speaker !== t.speaker;
        return (
          <li key={i} className={cn("flex flex-col", mine ? "items-end" : "items-start", startsRun && i > 0 && "mt-2")}>
            {startsRun && (
              <span className="mb-1 px-3 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{names[t.speaker]}</span>
            )}
            <p
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap sm:max-w-[75%]",
                mine
                  ? "bg-rose-600 text-white"
                  : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
                endsRun && (mine ? "rounded-br-md" : "rounded-bl-md")
              )}
            >
              {t.text}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
