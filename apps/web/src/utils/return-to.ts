export type ReturnTarget = { path: string; state: unknown };

/**
 * 列表页把来源地址放在 state.returnTo 里带到详情页和编排页；
 * 只接受本应用已有的活动或分群页面，returnState 保存来源页自己的返回地址。
 */
export function readReturnTo(state: unknown): ReturnTarget | undefined {
  if (typeof state !== 'object' || state === null || !('returnTo' in state)) return undefined;
  const returnTo = state.returnTo;
  if (
    typeof returnTo === 'string' &&
    (returnTo.startsWith('/campaigns/') || returnTo.startsWith('/segments/'))
  ) {
    return {
      path: returnTo,
      state: 'returnState' in state ? state.returnState : undefined,
    };
  }
  return undefined;
}
