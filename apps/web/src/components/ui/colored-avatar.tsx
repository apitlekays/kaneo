import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarTone, getInitials } from "@/lib/avatar";
import { cn } from "@/lib/cn";

type ColoredAvatarProps = {
  /** Display name — drives the fallback initials and image alt text. */
  name?: string | null;
  /** Optional uploaded/remote image URL. */
  image?: string | null;
  /**
   * Stable key the tint is derived from. Pass the user id so the same person
   * keeps the same color everywhere; falls back to the name when omitted.
   */
  seed?: string | null;
  /** Sizing/extra classes applied to the avatar root (e.g. "h-6 w-6"). */
  className?: string;
  /** Extra classes for the fallback (e.g. text size). */
  fallbackClassName?: string;
};

/**
 * Avatar that shows the user's uploaded image when present, otherwise a colored
 * initials fallback. The tint comes from `seed` (or `name`) via getAvatarTone,
 * so colors are stable and consistent across the app.
 */
export function ColoredAvatar({
  name,
  image,
  seed,
  className,
  fallbackClassName,
}: ColoredAvatarProps) {
  const tone = getAvatarTone(seed ?? name ?? "");

  return (
    <Avatar className={cn(tone, className)}>
      {image ? <AvatarImage src={image} alt={name ?? ""} /> : null}
      <AvatarFallback
        className={cn("bg-transparent font-medium", fallbackClassName)}
      >
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export default ColoredAvatar;
