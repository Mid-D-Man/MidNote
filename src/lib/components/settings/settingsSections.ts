// Round 42 — the shape of Settings.
//
//   Settings panel (left sheet)      basics: Theme, Note lines, and "Advanced settings"
//   /settings                        Advanced settings: the main categories below
//   /settings/<category>             a category's subcategories (rows / switches / sub-pages)
//   /settings/fonts                  a subcategory page (child of Appearance)
//
// Every page has a Back button that goes up exactly one level (`parent`).
export type SettingsSection = {
  slug: string;
  title: string;
  desc: string;
  /** Where Back goes. */
  parent: string;
  /** Listed on the Advanced settings page (main categories). Sub-pages are reached from their parent. */
  main: boolean;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { slug: "appearance", title: "Appearance", desc: "Theme, fonts and note lines.", parent: "/settings", main: true },
  { slug: "read-aloud", title: "Read aloud", desc: "Voice, speed and pitch.", parent: "/settings", main: true },
  { slug: "privacy", title: "Privacy & security", desc: "App password.", parent: "/settings", main: true },
  { slug: "developer", title: "Developer", desc: "Debug panel.", parent: "/settings", main: true },
  { slug: "fonts", title: "Fonts", desc: "Default note font and your own imported fonts.", parent: "/settings/appearance", main: false },
];

export function findSection(slug: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((s) => s.slug === slug);
}
