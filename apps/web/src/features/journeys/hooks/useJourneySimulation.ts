import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useMutation } from '@tanstack/react-query';
import type {
  JourneyDraftDefinition,
  JourneyDraftWarning,
  JourneyEventType,
  JourneySimulationResult,
  JourneySimulationScenario,
} from '@journeylens/shared';
import { journeySimulationScenarioSchema } from '@journeylens/shared';
import { getApiErrorMessage, isSessionExpired } from '@/services/api';
import { simulateJourney, simulateJourneyVersion } from '@/services/journeys';

type Options = {
  journeyId: string;
  /** 有版本时只提交模拟资料，由服务端读取该版本固定保存的内容。 */
  versionId?: string;
  /** 离开模拟页时停止播放，并忽略仍在返回途中的结果。 */
  active: boolean;
  /** 当前画布用于清除不再对应的模拟结果；位置和布局变化不影响结果。 */
  definition: JourneyDraftDefinition;
  /** 通过保存校验后的规范化画布；未通过时为 null，不能发起模拟。 */
  normalizedDefinition: JourneyDraftDefinition | null;
  warnings: readonly JourneyDraftWarning[];
};

const IGNORED_POSITION = { x: 0, y: 0 };

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** 默认样例让用户进入面板即可直接运行，并覆盖同商品购买等待。 */
export function createDefaultSimulationScenario(
  entryBehavior: JourneyEventType = 'product_viewed',
): JourneySimulationScenario {
  return {
    user: { displayName: '张三', email: null, attributes: { age: 25 } },
    entryEvent: {
      id: newId('entry'),
      type: entryBehavior,
      offsetSeconds: 0,
      payload:
        entryBehavior === 'product_viewed'
          ? { productId: 'P-100', productName: '体验商品', price: 199 }
          : {},
    },
    historicalEvents: [
      {
        id: newId('history'),
        type: 'purchase_completed',
        offsetSeconds: -2 * 24 * 60 * 60,
        payload: { productId: 'P-200', productName: '其他商品', amount: 99 },
      },
    ],
    scheduledEvents: [
      {
        id: newId('future'),
        type: 'purchase_completed',
        offsetSeconds: 2 * 60 * 60,
        payload: { productId: 'P-100', productName: '体验商品', amount: 199 },
      },
    ],
  };
}

function inputKey(definition: JourneyDraftDefinition, scenario: JourneySimulationScenario): string {
  return JSON.stringify({
    nodes: definition.nodes.map((node) => ({ ...node, position: IGNORED_POSITION })),
    edges: definition.edges,
    scenario,
  });
}

export type JourneySimulationController = ReturnType<typeof useJourneySimulation>;

/** 临时资料留在本页状态；保存旅程草稿与模拟输入各自独立。 */
export function useJourneySimulation({
  journeyId,
  versionId,
  active,
  definition,
  normalizedDefinition,
  warnings,
}: Options) {
  const startBehavior = definition.nodes.find((node) => node.type === 'start')?.entryBehavior;
  const [scenario, setScenario] = useState<JourneySimulationScenario>(() =>
    createDefaultSimulationScenario(startBehavior),
  );
  const [run, setRun] = useState<{
    key: string;
    result: JourneySimulationResult;
    visibleStepCount: number;
  } | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string>();
  const requestRef = useRef(0);
  const playbackRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
    resolve: () => void;
  } | null>(null);
  const sourceKey = `${journeyId}:${versionId ?? 'draft'}`;
  const sourceKeyRef = useRef(sourceKey);
  const previousStartBehaviorRef = useRef(startBehavior);
  const scenarioTouchedRef = useRef(false);
  const {
    mutateAsync: runSimulation,
    isPending: requestPending,
    reset: resetSimulation,
  } = useMutation({
    mutationFn: ({
      journeyId: id,
      versionId: targetVersionId,
      input,
    }: {
      journeyId: string;
      versionId: string | undefined;
      input: Parameters<typeof simulateJourney>[1];
    }) =>
      targetVersionId === undefined
        ? simulateJourney(id, input)
        : simulateJourneyVersion(id, targetVersionId, input.scenario),
  });

  const definitionKey = normalizedDefinition ?? definition;
  const key = `${sourceKey}:${inputKey(definitionKey, scenario)}`;
  const scenarioValidation = journeySimulationScenarioSchema.safeParse(scenario);
  const scenarioErrors = scenarioValidation.success
    ? []
    : scenarioValidation.error.issues.map((issue) => issue.message);

  useEffect(() => {
    if (sourceKeyRef.current !== sourceKey) {
      sourceKeyRef.current = sourceKey;
      scenarioTouchedRef.current = false;
      setScenario(createDefaultSimulationScenario(startBehavior));
      previousStartBehaviorRef.current = startBehavior;
      return;
    }
    if (previousStartBehaviorRef.current !== startBehavior) {
      previousStartBehaviorRef.current = startBehavior;
      // 首次读取旅程时让默认进入行为跟随开始步骤；用户编辑过后保留其测试输入。
      if (!scenarioTouchedRef.current) setScenario(createDefaultSimulationScenario(startBehavior));
    }
  }, [sourceKey, startBehavior]);

  useEffect(() => {
    setRun(null);
    setStale(false);
  }, [sourceKey]);

  useEffect(() => {
    requestRef.current += 1;
    resetSimulation();
    setError(undefined);
    if (!active) {
      // 完整结果仍可返回查看；离开时尚未播完的结果清除，下次重新开始。
      setRun((current) =>
        current !== null && current.visibleStepCount < current.result.steps.length ? null : current,
      );
    }
    return () => {
      requestRef.current += 1;
      if (playbackRef.current !== null) {
        clearTimeout(playbackRef.current.timer);
        // 唤醒等待中的 start，让它按请求序号退出，不再展示或提示完成。
        playbackRef.current.resolve();
        playbackRef.current = null;
      }
    };
  }, [active, key, journeyId, resetSimulation]);

  const updateScenario: Dispatch<SetStateAction<JourneySimulationScenario>> = useCallback(
    (next) => {
      scenarioTouchedRef.current = true;
      setScenario(next);
    },
    [],
  );

  useEffect(() => {
    if (run === null || run.key === key) return;
    setRun(null);
    setStale(true);
  }, [key, run]);

  const currentRun = run !== null && run.key === key ? run : null;
  const pending =
    requestPending ||
    (currentRun !== null && currentRun.visibleStepCount < currentRun.result.steps.length);

  const start = useCallback(async (): Promise<JourneySimulationResult | undefined> => {
    if (
      !active ||
      normalizedDefinition === null ||
      warnings.length > 0 ||
      !scenarioValidation.success ||
      pending
    ) {
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const requestKey = key;
    // 结果同时驱动画布高亮；新一轮开始时一起清除，避免把上次路径当成本次结果。
    setRun(null);
    setError(undefined);
    setStale(false);
    try {
      const result = await runSimulation({
        journeyId,
        versionId,
        input: { draftDefinition: normalizedDefinition, scenario: scenarioValidation.data },
      });
      if (requestRef.current !== requestId) return;
      // 一次计算完整业务结果，只把展示过程按固定半秒推进；不改变旅程里的等待时长。
      setRun({ key: requestKey, result, visibleStepCount: Math.min(1, result.steps.length) });
      for (
        let visibleStepCount = 2;
        visibleStepCount <= result.steps.length;
        visibleStepCount += 1
      ) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            playbackRef.current = null;
            resolve();
          }, 500);
          playbackRef.current = { timer, resolve };
        });
        if (requestRef.current !== requestId) return;
        setRun({ key: requestKey, result, visibleStepCount });
      }
      return result;
    } catch (cause) {
      if (requestRef.current !== requestId) return;
      if (isSessionExpired(cause)) return;
      setError(getApiErrorMessage(cause));
    }
  }, [
    active,
    journeyId,
    versionId,
    key,
    normalizedDefinition,
    pending,
    runSimulation,
    scenarioValidation,
    warnings.length,
  ]);

  const resetScenario = useCallback(() => {
    scenarioTouchedRef.current = false;
    setScenario(createDefaultSimulationScenario(startBehavior));
    setError(undefined);
  }, [startBehavior]);

  return {
    scenario,
    setScenario: updateScenario,
    scenarioErrors,
    resetScenario,
    result: currentRun?.result ?? null,
    visibleStepCount: currentRun?.visibleStepCount ?? 0,
    pending,
    error,
    stale,
    start,
  };
}
