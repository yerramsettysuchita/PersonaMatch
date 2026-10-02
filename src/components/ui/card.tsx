import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60",
        className
      )}
      {...props}
    />
  );
}

export function SectionTitle({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100", className)}>
      {icon && <span className="text-rose-500">{icon}</span>}
      {children}
    </h2>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-3 py-12 text-center">
      <span className="text-zinc-400 dark:text-zinc-600">{icon}</span>
      <p className="font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
      {children}
    </Card>
  );
}
