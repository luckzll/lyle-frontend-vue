export type ScrollMetrics = Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>

export function isConversationNearBottom(metrics: ScrollMetrics, threshold = 88) {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < threshold
}
