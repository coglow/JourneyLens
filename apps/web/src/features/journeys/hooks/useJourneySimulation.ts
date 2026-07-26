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
import { simulateJourney } from '@/services/journeys';

type Options = {
  journeyId: string;
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
  definition,
  normalizedDefinition,
  warnings,
}: Options) {
  const startBehavior = definition.nodes.find((node) => node.type === 'start')?.entryBehavior;
  const [scenario, setScenario] = useState<JourneySimulationScenario>(() =>
    createDefaultSimulationScenario(startBehavior),
  );
  const [run, setRun] = useState<{ key: string; result: JourneySimulationResult } | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string>();
  const requestRef = useRef(0);
  const journeyIdRef = useRef(journeyId);
  const previousStartBehaviorRef = useRef(startBehavior);
  const scenarioTouchedRef = useRef(false);
  const {
    mutateAsync: runSimulation,
    isPending: pending,
    reset: resetSimulation,
  } = useMutation({
    mutationFn: ({
      journeyId: id,
      input,
    }: {
      journeyId: string;
      input: Parameters<typeof simulateJourney>[1];
    }) => simulateJourney(id, input),
  });

  const definitionKey = normalizedDefinition ?? definition;
  const key = inputKey(definitionKey, scenario);
  const scenarioValidation = journeySimulationScenarioSchema.safeParse(scenario);
  const scenarioErrors = scenarioValidation.success
    ? []
    : scenarioValidation.error.issues.map((issue) => issue.message);

  useEffect(() => {
    if (journeyIdRef.current !== journeyId) {
      journeyIdRef.current = journeyId;
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
  }, [journeyId, startBehavior]);

  useEffect(() => {
    setRun(null);
    setStale(false);
  }, [journeyId]);

  useEffect(() => {
    requestRef.current += 1;
    resetSimulation();
    setError(undefined);
  }, [key, journeyId, resetSimulation]);

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

  const start = useCallback(async (): Promise<void> => {
    if (
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
    setError(undefined);
    setStale(false);
    try {
      const result = await runSimulation({
        journeyId,
        input: { draftDefinition: normalizedDefinition, scenario: scenarioValidation.data },
      });
      if (requestRef.current !== requestId) return;
      setRun({ key: requestKey, result });
    } catch (cause) {
      if (requestRef.current !== requestId) return;
      if (isSessionExpired(cause)) return;
      setError(getApiErrorMessage(cause));
    }
  }, [
    journeyId,
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
    result: run !== null && run.key === key ? run.result : null,
    pending,
    error,
    stale,
    start,
  };
}
