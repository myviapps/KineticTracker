import { AlmanacLogo } from "@/components/almanac-logo";
import { cn } from "@/lib/utils";

interface AnimatedLoaderProps {
  className?: string;
  text?: string;
}

export function AnimatedLoader({ className, text }: AnimatedLoaderProps) {
  return (
    <div
      className={cn(
        "flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4",
        className,
      )}
    >
      <AlmanacLogo size={64} animated showText={false} />
      {text && (
        <p className="text-sm text-muted-foreground">{text}</p>
      )}
    </div>
  );
}
