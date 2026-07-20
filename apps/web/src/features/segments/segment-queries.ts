import type { QueryClient } from '@tanstack/react-query';
import type {
  SegmentDetail,
  SegmentListQueryInput,
  SegmentRefreshPreview,
} from '@journeylens/shared';

export const segmentQueryKeys = {
  lists: ['segments', 'list'] as const,
  list: (input: SegmentListQueryInput) => [...segmentQueryKeys.lists, input] as const,
  detail: (id: string) => ['segments', 'detail', id] as const,
};

/** 预估成功后更新对应详情缓存，并让列表按当前查询重新读取。 */
export function applySegmentEstimate(
  queryClient: QueryClient,
  segment: SegmentDetail,
  estimate: SegmentRefreshPreview,
): void {
  queryClient.setQueryData<SegmentDetail>(segmentQueryKeys.detail(segment.id), {
    ...segment,
    audienceEstimate: { ...estimate, isStale: false },
  });
  void queryClient.invalidateQueries({ queryKey: segmentQueryKeys.lists });
}
