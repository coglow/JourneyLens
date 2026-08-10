import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { journeyDraftDefinitionSchema, type JourneySimulationResult } from '@journeylens/shared';
import { simulateJourney, simulateJourneyVersion } from '@/services/journeys';
import { useJourneySimulation } from './useJourneySimulation';

vi.mock('@/services/journeys', () => ({
  simulateJourney: vi.fn(),
  simulateJourneyVersion: vi.fn(),
}));

const journeyId = '00000000-0000-4000-8302-000000000001';
const definition = journeyDraftDefinitionSchema.parse({
  layoutDirection: 'vertical',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: '开始',
      position: { x: 0, y: 0 },
      entryBehavior: 'product_viewed',
    },
    { id: 'end', type: 'end', name: '结束', position: { x: 0, y: 100 }, note: null },
  ],
  edges: [{ id: 'edge', source: 'start', target: 'end' }],
});

function makeResult(displayName: string | null = '张三'): JourneySimulationResult {
  return {
    outcome: 'completed',
    user: { displayName },
    admission: {
      entryBehavior: { expected: 'product_viewed', actual: 'product_viewed', matched: true },
      segment: null,
    },
    steps: [
      {
        order: 1,
        nodeId: 'start',
        nodeName: '开始',
        nodeType: 'start',
        elapsedSeconds: 0,
        entryBehavior: 'product_viewed',
      },
      { order: 2, nodeId: 'end', nodeName: '结束', nodeType: 'end', elapsedSeconds: 0, note: null },
    ],
    traversedEdgeIds: ['edge'],
    elapsedSeconds: 0,
  };
}

type Props = Parameters<typeof useJourneySimulation>[0];
const props: Props = {
  journeyId,
  active: true,
  definition,
  normalizedDefinition: definition,
  warnings: [],
};

function createClient(onError: (error: unknown) => void = () => {}): QueryClient {
  return new QueryClient({
    defaultOptions: { mutations: { retry: false } },
    mutationCache: new MutationCache({ onError: (error) => onError(error) }),
  });
}

function renderSimulation(initialProps: Props = props, client = createClient()) {
  return renderHook((input: Props) => useJourneySimulation(input), {
    initialProps: { ...initialProps },
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  vi.mocked(simulateJourney).mockReset();
  vi.mocked(simulateJourneyVersion).mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('模拟状态', () => {
  it('发布版本使用版本模拟请求，切换同一旅程的版本后忽略旧响应并重置资料', async () => {
    let finish: ((value: JourneySimulationResult) => void) | undefined;
    vi.mocked(simulateJourneyVersion).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const firstVersionId = '00000000-0000-4000-8305-000000000001';
    const { result: hook, rerender } = renderSimulation({ ...props, versionId: firstVersionId });
    act(() =>
      hook.current.setScenario((current) => ({
        ...current,
        user: { ...current.user, displayName: '旧版资料' },
      })),
    );
    const submittedScenario = hook.current.scenario;
    act(() => void hook.current.start());
    await waitFor(() =>
      expect(simulateJourneyVersion).toHaveBeenCalledWith(
        journeyId,
        firstVersionId,
        submittedScenario,
      ),
    );
    expect(simulateJourney).not.toHaveBeenCalled();

    rerender({ ...props, versionId: '00000000-0000-4000-8305-000000000002' });
    await act(async () => finish?.(makeResult('旧版资料')));
    expect(hook.current.result).toBeNull();
    expect(hook.current.scenario.user.displayName).toBe('张三');
    expect(hook.current.pending).toBe(false);
  });

  it('第一步立即展示，之后每满半秒推进一步，全部展示后才结束', async () => {
    vi.useFakeTimers();
    const result = makeResult();
    result.steps.splice(1, 0, {
      order: 2,
      nodeId: 'wait',
      nodeName: '等待一小时',
      nodeType: 'wait',
      elapsedSeconds: 0,
      waitSeconds: 3600,
      elapsedBefore: 0,
      elapsedAfter: 3600,
    });
    result.steps[2] = { ...result.steps[2]!, order: 3, elapsedSeconds: 3600 };
    result.elapsedSeconds = 3600;
    vi.mocked(simulateJourney).mockResolvedValue(result);
    const { result: hook } = renderSimulation();
    let execution: ReturnType<typeof hook.current.start> | undefined;
    await act(async () => {
      execution = hook.current.start();
    });
    expect(hook.current.visibleStepCount).toBe(1);
    expect(hook.current.pending).toBe(true);

    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(hook.current.visibleStepCount).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(hook.current.visibleStepCount).toBe(2);
    expect(hook.current.pending).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(hook.current.visibleStepCount).toBe(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(hook.current.visibleStepCount).toBe(3);
    expect(hook.current.pending).toBe(false);
    expect(await execution).toEqual(result);
    expect(hook.current.result?.elapsedSeconds).toBe(3600);
  });

  it.each(['修改资料', '离开模拟页', '卸载页面'] as const)(
    '%s会停止播放，旧播放不再返回完成结果',
    async (action) => {
      vi.useFakeTimers();
      vi.mocked(simulateJourney).mockResolvedValue(makeResult());
      const { result: hook, rerender, unmount } = renderSimulation();
      let execution: ReturnType<typeof hook.current.start> | undefined;
      await act(async () => {
        execution = hook.current.start();
      });
      expect(hook.current.visibleStepCount).toBe(1);

      if (action === '修改资料') {
        act(() => {
          hook.current.setScenario((current) => ({
            ...current,
            user: { ...current.user, displayName: '新资料' },
          }));
        });
      } else if (action === '离开模拟页') {
        rerender({ ...props, active: false });
      } else {
        unmount();
      }
      await act(async () => {
        expect(await execution).toBeUndefined();
        await vi.advanceTimersByTimeAsync(5000);
      });
      if (action !== '卸载页面') {
        expect(hook.current.result).toBeNull();
        expect(hook.current.pending).toBe(false);
      }
    },
  );

  it('默认进入行为跟随首次载入的开始步骤，手动修改后保留用户选择', () => {
    const { result: hook, rerender } = renderSimulation();
    const appStart = journeyDraftDefinitionSchema.parse({
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.type === 'start' ? { ...node, entryBehavior: 'app_session_started' } : node,
      ),
    });

    rerender({ ...props, definition: appStart, normalizedDefinition: appStart });
    expect(hook.current.scenario.entryEvent.type).toBe('app_session_started');

    act(() => {
      hook.current.setScenario((current) => ({
        ...current,
        entryEvent: { ...current.entryEvent, type: 'purchase_completed', payload: {} },
      }));
    });
    rerender({ ...props, definition, normalizedDefinition: definition });
    expect(hook.current.scenario.entryEvent.type).toBe('purchase_completed');
  });

  it('默认示例资料可直接提交当前画布', async () => {
    vi.mocked(simulateJourney).mockResolvedValue(makeResult());
    const { result: hook } = renderSimulation();
    const submittedScenario = hook.current.scenario;

    await act(async () => hook.current.start());

    expect(simulateJourney).toHaveBeenCalledWith(journeyId, {
      draftDefinition: definition,
      scenario: submittedScenario,
    });
    expect(hook.current.result).toEqual(makeResult());
  });

  it('再次模拟立即清除旧结果，失败后可以重试并重新展示结果', async () => {
    const result = makeResult();
    vi.mocked(simulateJourney).mockResolvedValueOnce(result);
    const { result: hook } = renderSimulation();
    await act(async () => {
      expect(await hook.current.start()).toEqual(result);
    });

    let reject: ((reason: Error) => void) | undefined;
    vi.mocked(simulateJourney).mockReturnValueOnce(
      new Promise((_resolve, rejectRequest) => {
        reject = rejectRequest;
      }),
    );
    let secondRun: ReturnType<typeof hook.current.start> | undefined;
    act(() => {
      secondRun = hook.current.start();
    });
    expect(hook.current.result).toBeNull();
    await waitFor(() => expect(hook.current.pending).toBe(true));

    await act(async () => {
      reject?.(new Error('模拟失败'));
      expect(await secondRun).toBeUndefined();
    });
    await waitFor(() => expect(hook.current.pending).toBe(false));
    expect(hook.current.result).toBeNull();
    expect(hook.current.error).toBeTruthy();

    vi.mocked(simulateJourney).mockResolvedValueOnce(result);
    await act(async () => {
      expect(await hook.current.start()).toEqual(result);
    });
    expect(simulateJourney).toHaveBeenCalledTimes(3);
    expect(hook.current.result).toEqual(result);
    expect(hook.current.error).toBeUndefined();
  });

  it('资料或行为变化后清除结果并忽略旧请求响应', async () => {
    let finish: ((value: JourneySimulationResult) => void) | undefined;
    vi.mocked(simulateJourney).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result: hook } = renderSimulation();

    act(() => void hook.current.start());
    act(() => {
      hook.current.setScenario((current) => ({
        ...current,
        user: { ...current.user, attributes: { age: 16 } },
      }));
    });
    await act(async () => finish?.(makeResult('旧资料')));

    expect(hook.current.result).toBeNull();
    expect(hook.current.scenario.user.attributes.age).toBe(16);
  });

  it('手动编辑后可重置为示例资料，并保留当前开始行为', () => {
    const { result: hook } = renderSimulation();
    act(() =>
      hook.current.setScenario((current) => ({
        ...current,
        user: { displayName: '手动样例', email: null, attributes: { age: 17 } },
        historicalEvents: [],
        scheduledEvents: [],
      })),
    );
    act(() => hook.current.resetScenario());
    expect(hook.current.scenario.user).toEqual({
      displayName: '张三',
      email: null,
      attributes: { age: 25 },
    });
    expect(hook.current.scenario.entryEvent.type).toBe('product_viewed');
    expect(hook.current.scenario.historicalEvents).toHaveLength(1);
    expect(hook.current.scenario.scheduledEvents).toHaveLength(1);
  });

  it('画布配置不完整或资料无效时不发送请求', async () => {
    const { result: hook, rerender } = renderSimulation({ ...props, normalizedDefinition: null });
    await act(async () => hook.current.start());
    rerender({ ...props, warnings: [{ code: 'missing-start', nodeIds: [], message: '缺少开始' }] });
    await act(async () => hook.current.start());
    rerender({ ...props });
    act(() => {
      hook.current.setScenario((current) => ({
        ...current,
        user: { ...current.user, attributes: { age: '25' as never } },
      }));
    });
    await act(async () => hook.current.start());
    expect(simulateJourney).not.toHaveBeenCalled();
    expect(hook.current.scenarioErrors.length).toBeGreaterThan(0);
  });
});
