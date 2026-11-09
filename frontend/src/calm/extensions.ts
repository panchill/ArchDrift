// shortcut: no extension packs, so `pack:type` nodes (e.g. aws:lambda) get default colors and no icon; copy @calmstudio/extensions if you need them.
export function resolvePackNode(_calmType: string): { icon: string; color: { bg: string; stroke: string } } | null {
  return null;
}
