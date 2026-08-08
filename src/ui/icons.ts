import {
  Add,
  Box,
  ChartBar,
  CheckCircle,
  ClipboardList,
  CloseCircle,
  Database,
  FileText,
  Gear,
  Globe,
  Headphones,
  HeartPulse,
  History,
  Information,
  Moon,
  PlayCircle,
  Plug,
  Refresh,
  Search,
  SidebarLeft,
  SidebarRight,
  Sun,
  Users,
} from "reicon";
import type { IconOptions } from "reicon";

export const ICON_MAP = {
  add: Add,
  box: Box,
  chartBar: ChartBar,
  check: CheckCircle,
  close: CloseCircle,
  clipboardList: ClipboardList,
  database: Database,
  fileText: FileText,
  gear: Gear,
  globe: Globe,
  headphones: Headphones,
  heartPulse: HeartPulse,
  history: History,
  information: Information,
  moon: Moon,
  play: PlayCircle,
  plug: Plug,
  refresh: Refresh,
  search: Search,
  sidebarLeft: SidebarLeft,
  sidebarRight: SidebarRight,
  sun: Sun,
  users: Users,
} as const;

export type IconName = keyof typeof ICON_MAP;

export function renderIcon(name: IconName, options?: IconOptions): string {
  const factory = ICON_MAP[name];
  return factory.toSvg({ size: 24, ...options });
}

/** Monta los SVG de Reicon dentro de los elementos [data-icon]. */
export function mountIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
    const name = el.dataset.icon as IconName | undefined;
    const factory = name ? ICON_MAP[name] : undefined;
    if (!factory) {
      return;
    }

    const size = Number(el.dataset.size ?? 24);
    el.appendChild(factory({ size, className: "reicon-svg" }));
  });
}
