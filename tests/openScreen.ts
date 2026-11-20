import type { Page } from "@playwright/test";
import { desktopSections, phoneSections } from "../src/components/sections";

// Opens a screen by its label from the window's navigation, the phone's tabs or the desktop's rail.
// A section's button goes to the screen last open in it and is named by the screen it shows, so the
// button is found by any of its names, and its menu is opened only when that press didn't bring the
// screen up.
export async function openScreen(page: Page, screen: string) {
  const phone = (await page.locator("nav").count()) > 0;
  const screensOf = (section: (typeof desktopSections)[number]) => (phone ? section.phone : section.desktop);
  const section = (phone ? phoneSections : desktopSections).find((candidate) => screensOf(candidate).some((shown) => shown.label === screen))!;
  const names = [section.label, ...screensOf(section).map((shown) => shown.label)].map((name) => name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&"));
  const button = page.locator(phone ? "nav" : "aside").first().getByRole("button", { name: new RegExp(`^(${names.join("|")})$`) });
  const showing = async () => (await button.getAttribute("aria-current")) === "page" && (await button.textContent())?.trim() === screen;

  if (await showing()) return;
  await button.click();
  if (await showing()) return;
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await page.getByRole("menu", { name: section.label }).getByRole("menuitem", { name: screen, exact: true }).click();
}
