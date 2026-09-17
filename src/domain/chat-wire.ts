/** Jackson serializes Java Long fields as decimal strings; normalize only exact safe integers. */
export function chatWireInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value
    : typeof value === 'string' && /^(?:0|[1-9]\d{0,15})$/.test(value) ? Number(value)
      : undefined
  return number !== undefined && Number.isSafeInteger(number) && number >= 0 ? number : undefined
}
