import { useCallback, useEffect, useRef, useState } from 'react';
import type { SegmentPreview, SegmentRule } from '@journeylens/shared';
import { useAuth } from '@/features/auth/auth-provider';
import { getApiErrorMessage, isSessionExpired } from '@/services/api';
import { previewSegmentRules } from '@/services/segments';

type SegmentPreviewState =
  | { status: 'loading' }
  | { status: 'success'; result: SegmentPreview }
  | { status: 'error'; message: string };

const PREVIEW_DEBOUNCE_MS = 500;

/**
 * 未保存规则的临时预估：防抖后请求，规则变化或关闭时取消，只接受最新一次请求的结果。
 * 登录失效交给现有 expireSession 流程，避免在这里重复处理跳转。
 */
export function useSegmentPreview(enabled: boolean, rule: SegmentRule | undefined) {
  const { expireSession } = useAuth();
  const [previewState, setPreviewState] = useState<SegmentPreviewState>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);

  const cancelPreview = useCallback(() => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    controller.current?.abort();
    controller.current = undefined;
    // 取消后旧结果不再有效，立即清空等待或结果状态。
    setPreviewState(undefined);
  }, []);

  const requestPreview = useCallback(
    async (value: SegmentRule) => {
      cancelPreview();
      const current = new AbortController();
      controller.current = current;
      setPreviewState({ status: 'loading' });
      try {
        const result = await previewSegmentRules(value, current.signal);
        if (!current.signal.aborted) setPreviewState({ status: 'success', result });
      } catch (error) {
        // 主动取消的请求不落地结果，也不改动新一次预估的状态。
        if (current.signal.aborted) return;
        if (isSessionExpired(error)) {
          setPreviewState(undefined);
          expireSession();
          return;
        }
        setPreviewState({ status: 'error', message: getApiErrorMessage(error) });
      } finally {
        if (controller.current === current) controller.current = undefined;
      }
    },
    [cancelPreview, expireSession],
  );

  useEffect(() => {
    if (!enabled || rule === undefined) {
      cancelPreview();
      return;
    }
    // 上一次 effect 的清理已取消旧请求并清空结果，这里只负责新的防抖。
    timer.current = setTimeout(() => {
      timer.current = undefined;
      void requestPreview(rule);
    }, PREVIEW_DEBOUNCE_MS);
    return cancelPreview;
  }, [cancelPreview, enabled, requestPreview, rule]);

  return { previewState, cancelPreview };
}
