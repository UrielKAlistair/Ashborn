import type { ComponentType } from "react";
import {
  AlarmsIcon,
  AtlasIcon,
  CalendarIcon,
  CharacterIcon,
  GraphIcon,
  HomeIcon,
  KitchenIcon,
  MealPlanIcon,
  RecipesIcon,
  SettingsIcon,
  StocksIcon,
  TodoIcon,
} from "./icons";

// A section of the app (Home, Kitchen, ...) is made of screens, each at its own path. The phone
// shows one screen at a time; the desktop puts screens that fit together on one page, so a
// section can have fewer pages there. A section with more than one screen on the current device
// opens a menu of them; one with a single screen navigates straight to it.

export type Screen = {
  label: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
};

export type Section = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  phone: Screen[];
  desktop: Screen[];
};

function single(label: string, path: string, icon: Screen["icon"]): Section {
  const screen = { label, path, icon };
  return { label, icon, phone: [screen], desktop: [screen] };
}

const recipes: Screen = { label: "Recipes", path: "/kitchen/recipes", icon: RecipesIcon };

const home: Section = {
  label: "Home",
  icon: HomeIcon,
  phone: [
    { label: "To-do", path: "/", icon: TodoIcon },
    { label: "Graph", path: "/graph", icon: GraphIcon },
    { label: "Character", path: "/character", icon: CharacterIcon },
  ],
  desktop: [{ label: "Home", path: "/", icon: HomeIcon }],
};

const kitchen: Section = {
  label: "Kitchen",
  icon: KitchenIcon,
  phone: [{ label: "Meal plan", path: "/kitchen", icon: MealPlanIcon }, { label: "Stocks", path: "/kitchen/stocks", icon: StocksIcon }, recipes],
  desktop: [{ label: "Planning", path: "/kitchen", icon: MealPlanIcon }, { ...recipes, label: "Cookbook" }],
};

// The calendar of one-time alarms and deadlines, and the alarms that repeat
const calendarScreens: Screen[] = [
  { label: "Calendar", path: "/calendar", icon: CalendarIcon },
  { label: "Alarms", path: "/alarms", icon: AlarmsIcon },
];
const calendar: Section = { label: "Calendar", icon: CalendarIcon, phone: calendarScreens, desktop: calendarScreens };
const atlas = single("Atlas", "/atlas", AtlasIcon);
const settings = single("Settings", "/settings", SettingsIcon);

// Each device's sections, most used first. The phone has no Atlas; only the phone has Settings
// (the desktop's rail has its theme switch, and alarms ring only on the phone).
export const desktopSections: Section[] = [home, kitchen, calendar, atlas];
export const phoneSections: Section[] = [home, calendar, kitchen, settings];
// The screen `path` shows: the longest screen path it starts with ("/" only matches itself)
export function screenAt(path: string, screens: Screen[]): Screen | undefined {
  return screens
    .filter((screen) => path === screen.path || (screen.path !== "/" && path.startsWith(`${screen.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

// The section `path` belongs to, looking at its screens on both devices
export function sectionAt(path: string): Section | undefined {
  return [...desktopSections, settings].find((section) => screenAt(path, [...section.phone, ...section.desktop]));
}
