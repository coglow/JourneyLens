export type ReturnTarget = { path: string; state: unknown };

/** 允许作为返回目标的页面，只包含本应用已有的详情地址。 */
const RETURN_PREFIXES = ['/campaigns/', '/segments/', '/journeys/'];

/**
 * 列表页把来源地址放在 state.returnTo 里带到详情页和编排页；
 * returnState 保存来源页自己的返回地址。
 */
export function readReturnTo(state: unknown): ReturnTarget | undefined {
  if (typeof state !== 'object' || state === null || !('returnTo' in state)) return undefined;
  const returnTo = state.returnTo;
  if (
    typeof returnTo !== 'string' ||
    !RETURN_PREFIXES.some((prefix) => returnTo.startsWith(prefix))
  ) {
    return undefined;
  }
  return {
    path: returnTo,
    state: 'returnState' in state ? state.returnState : undefined,
  };
}
