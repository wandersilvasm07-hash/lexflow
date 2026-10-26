import {
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  CreditCard,
  Inbox,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  Settings,
  Target,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { NavKey } from "./nav";

export const NAV_ICONS: Record<NavKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  whatsapp: MessageCircle,
  inbox: Inbox,
  contacts: UsersRound,
  calendar: CalendarDays,
  knowledge: BookOpenCheck,
  ads: Target,
  campaigns: Megaphone,
  reports: BarChart3,
  team: Users,
  billing: CreditCard,
  settings: Settings,
};
