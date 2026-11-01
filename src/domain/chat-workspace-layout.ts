export const DEFAULT_WORKSPACE_FRACTION = .52

/** Reserve readable space on both sides of the divider, including narrow desktops. */
export function clampWorkspaceWidth(width: number, total: number): number {
  const available = Math.max(0, Number.isFinite(total) ? total : 0)
  const minimum = Math.min(400, available * .5)
  const maximum = Math.max(minimum, available - Math.min(360, available * .5))
  return Math.min(maximum, Math.max(minimum, Number.isFinite(width) ? width : available * DEFAULT_WORKSPACE_FRACTION))
}
