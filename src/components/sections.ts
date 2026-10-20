import type { ComponentType } from "react";
import {
  AlarmsIcon,
  AtlasIcon,
  CharacterIcon,
  GraphIcon,
  HomeIcon,
  KitchenIcon,
  MealPlanIcon,
  RecipesIcon,
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
  desktop: [{ label: "Kitchen", path: "/kitchen", icon: MealPlanIcon }, { ...recipes, label: "Cookbook" }],
};

const alarms = single("Alarms", "/alarms", AlarmsIcon);
const atlas = single("Atlas", "/atlas", AtlasIcon);

// Each device's sections, most used first. The phone has no Atlas.
export const desktopSections: Section[] = [home, kitchen, alarms, atlas];
export const phoneSections: Section[] = [home, alarms, kitchen];
// The screen `path` shows: the longest screen path it starts with ("/" only matches itself)
export function screenAt(path: string, screens: Screen[]): Screen | undefined {
  return screens
    .filter((screen) => path === screen.path || (screen.path !== "/" && path.startsWith(`${screen.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

// The section `path` belongs to, looking at its screens on both devices (the desktop has them all)
export function sectionAt(path: string): Section | undefined {
  return desktopSections.find((section) => screenAt(path, [...section.phone, ...section.desktop]));
}
