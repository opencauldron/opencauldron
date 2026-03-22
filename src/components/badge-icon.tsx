import {
  Sparkles,
  Award,
  Trophy,
  Flame,
  Zap,
  Compass,
  Clapperboard,
  Tags,
  Palette,
  Video,
  Film,
  Star,
  Shield,
  Crown,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";

const iconMap: Record<string, ComponentType<LucideProps>> = {
  Sparkles,
  Award,
  Trophy,
  Flame,
  Zap,
  Compass,
  Clapperboard,
  Tags,
  Palette,
  Video,
  Film,
  Star,
  Shield,
  Crown,
};

interface BadgeIconProps extends LucideProps {
  name: string;
}

export function BadgeIcon({ name, ...props }: BadgeIconProps) {
  const Icon = iconMap[name] ?? Star;
  return <Icon {...props} />;
}
