import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from 'antd';
import {
  canEditCampaign,
  journeyDraftDefinitionSchema,
  type JourneyDetail,
  type JourneyDraftDefinition,
} from '@journeylens/shared';
import {
  ApiError,
  getApiErrorMessage,
  getWriteErrorMessage,
  isSessionExpired,
} from '@/services/api';
import { getJourney, saveJourneyDraft } from '@/services/journeys';
import { EMPTY_DEFINITION } from '@/features/journeys/journey-canvas';
import { journeyQueryKeys } from '@/features/journeys/journey-queries';
import { formatSavedAt } from '@/utils/format-date-time';

const AUTOSAVE_DEBOUNCE_MS = 800;

function definitionSnapshot(definition: JourneyDraftDefinition): string {
  const parsed = journeyDraftDefinitionSchema.safeParse(definition);
  return JSON.stringify(parsed.success ? parsed.data : definition);
}

type Options = {
  id: string;
  definition: JourneyDraftDefinition;
  parsedDefinition: ReturnType<typeof journeyDraftDefinitionSchema.safeParse>;
  dragging: boolean;
  /** 起草页打开期间暂停原画布自动保存，避免与候选应用并行写入。 */
  paused?: boolean;
  onAcceptDefinition: (definition: JourneyDraftDefinition) => void;
};

/** 候选应用的结果：只有 applied 表示服务器已确认保存。 */
export type ApplyDraftResult =
  | { status: 'applied' }
  | { status: 'conflict' }
  | { status: 'read-only' }
  | { status: 'missing' }
  | { status: 'unconfirmed' }
  | { status: 'failed'; message: string };

/** 统一读取、保存基准、自动保存与冲突处理；保存成功不重建画布或撤销历史。 */
export function useJourneyDraftPersistence({
  id,
  definition: currentDefinition,
  parsedDefinition,
  dragging,
  paused = false,
  onAcceptDefinition,
}: Options) {
  const queryClient = useQueryClient();
  const queryKey = journeyQueryKeys.detail(id);
  const [initializedId, setInitializedId] = useState<string>();
  const [savedSnapshot, setSavedSnapshot] = useState(() => definitionSnapshot(EMPTY_DEFINITION));
  // 只记录失败原因；保存成功由顶部的保存状态文案体现。
  const [saveError, setSaveError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [serverReadOnly, setServerReadOnly] = useState(false);
  const [journeyMissing, setJourneyMissing] = useState(false);
  // 保存结果未确认（超时或断网）时不再自动写入，先由运营读取最新内容。
  const [unconfirmedSave, setUnconfirmedSave] = useState(false);
  const [lastSaveSource, setLastSaveSource] = useState<'auto' | 'manual'>();
  const revision = useRef<number | undefined>(undefined);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 失败时记下当时的业务内容；内容变化前不再自动重试，避免反复失败请求。
  const failedSnapshot = useRef<string | undefined>(undefined);
  const saveSource = useRef<'auto' | 'manual'>('manual');
  // 同步标记是否有保存请求，避免自动保存与手动保存在同一帧发出两个请求。
  const savingInFlight = useRef(false);
  // 读取最新内容或切换旅程后递增，用于丢弃迟到的保存响应。
  const saveGeneration = useRef(0);
  const idRef = useRef(id);
  idRef.current = id;

  const cancelAutosave = useCallback((): void => {
    if (autosaveTimer.current !== undefined) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = undefined;
    }
  }, []);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getJourney(id, signal),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const journey = query.data;

  const acceptJourney = useCallback(
    (saved: JourneyDetail) => {
      const definition = saved.draftDefinition ?? EMPTY_DEFINITION;
      revision.current = saved.revision;
      onAcceptDefinition(definition);
      setSavedSnapshot(definitionSnapshot(definition));
      setInitializedId(id);
      setSaveError(undefined);
      setConflict(false);
      setServerReadOnly(false);
      setJourneyMissing(false);
      setUnconfirmedSave(false);
      setLastSaveSource(undefined);
      failedSnapshot.current = undefined;
      saveGeneration.current += 1;
      cancelAutosave();
    },
    [cancelAutosave, id, onAcceptDefinition],
  );

  // 详情页可能已有缓存；只用本次进入编排后完成的读取建立编辑基准。
  useEffect(() => {
    if (journey !== undefined && query.isSuccess && !query.isFetching && initializedId !== id) {
      acceptJourney(journey);
    }
  }, [acceptJourney, id, initializedId, journey, query.isFetching, query.isSuccess]);
  const comparableDefinition = parsedDefinition.success ? parsedDefinition.data : currentDefinition;
  // 用内容快照作为自动保存的触发依据，选中节点等画布操作不会重置计时。
  const currentSnapshot = JSON.stringify(comparableDefinition);
  const dirty = initializedId === id && currentSnapshot !== savedSnapshot;
  const saving = useMutation({
    mutationFn: (draftDefinition: JourneyDraftDefinition) => {
      if (revision.current === undefined) throw new Error('旅程尚未读取完成');
      return saveJourneyDraft(id, { revision: revision.current, draftDefinition });
    },
  });
  const readOnly =
    journey === undefined ||
    !canEditCampaign(journey.campaign.status) ||
    serverReadOnly ||
    journeyMissing ||
    initializedId !== id;
  // 保存期间仍允许编辑，只是不允许再发第二个保存请求。
  const canEdit = !readOnly;
  // 待核实状态只由保存层持有；修改起草输入不能解除它，确认旅程已删除后则允许离开。
  const mustVerify = !journeyMissing && (conflict || unconfirmedSave);

  /** 两种保存共用业务错误分类和状态更新，候选保存的结果不确定处理仍留在应用流程中。 */
  function handleSaveError(error: unknown): Exclude<ApplyDraftResult, { status: 'applied' }> {
    if (error instanceof ApiError && error.code === 'JOURNEY_REVISION_CONFLICT') {
      setConflict(true);
      setSaveError('旅程已在其他页面修改，你的内容仍保留在本页。读取最新内容前会先确认。');
      return { status: 'conflict' };
    }
    if (error instanceof ApiError && error.code === 'CAMPAIGN_NOT_EDITABLE') {
      setServerReadOnly(true);
      setSaveError('活动已不能编辑，当前编排无法保存。');
      return { status: 'read-only' };
    }
    if (error instanceof ApiError && error.status === 404) {
      setJourneyMissing(true);
      setSaveError('旅程已不存在，当前编排无法保存。');
      return { status: 'missing' };
    }
    const message = getWriteErrorMessage(error);
    setSaveError(message);
    return { status: 'failed', message };
  }

  /** 自动保存和手动保存共用同一条请求流程，保存成功后不重置历史和选中状态。 */
  async function persistDraft(source: 'auto' | 'manual'): Promise<void> {
    if (revision.current === undefined || savingInFlight.current || saving.isPending) return;
    if (!parsedDefinition.success || !canEdit || conflict || unconfirmedSave || !dirty) return;

    const sentDefinition = parsedDefinition.data;
    const sentSnapshot = JSON.stringify(sentDefinition);
    if (source === 'auto' && failedSnapshot.current === sentSnapshot) return;

    cancelAutosave();
    if (source === 'manual') {
      setSaveError(undefined);
      failedSnapshot.current = undefined;
    }
    saveSource.current = source;
    const requestGeneration = saveGeneration.current;
    const requestJourneyId = id;

    savingInFlight.current = true;
    try {
      const saved = await saving.mutateAsync(sentDefinition);
      // 读取过最新内容或已经切换到别的旅程时，丢弃迟到的响应。
      if (saveGeneration.current !== requestGeneration || idRef.current !== requestJourneyId)
        return;
      revision.current = saved.revision;
      queryClient.setQueryData(queryKey, saved);
      void queryClient.invalidateQueries({ queryKey: journeyQueryKeys.lists });
      setSavedSnapshot(sentSnapshot);
      setLastSaveSource(source);
      setSaveError(undefined);
      failedSnapshot.current = undefined;
    } catch (error) {
      if (saveGeneration.current !== requestGeneration || idRef.current !== requestJourneyId)
        return;
      if (isSessionExpired(error)) return;
      if (handleSaveError(error).status === 'failed') {
        // 普通失败后暂停自动保存，等业务内容再次变化或用户手动保存时再试。
        failedSnapshot.current = sentSnapshot;
      }
    } finally {
      savingInFlight.current = false;
    }
  }

  const persistDraftRef = useRef(persistDraft);
  persistDraftRef.current = persistDraft;

  /**
   * 以候选整体替换并保存草稿：原画布可能有未保存内容或暂不合法的配置，
   * 因此不复用 persistDraft 的画布校验，但共用保存请求、修订号和错误处理。
   */
  async function applyDraft(nextDefinition: JourneyDraftDefinition): Promise<ApplyDraftResult> {
    if (revision.current === undefined) {
      return { status: 'failed', message: '旅程尚未读取完成，请稍后再试' };
    }
    if (savingInFlight.current || saving.isPending) {
      return { status: 'failed', message: '正在保存，请稍后再试' };
    }
    if (unconfirmedSave) return { status: 'unconfirmed' };
    if (conflict) return { status: 'conflict' };

    cancelAutosave();
    setSaveError(undefined);
    failedSnapshot.current = undefined;
    saveSource.current = 'manual';
    const requestGeneration = saveGeneration.current;
    const requestJourneyId = id;

    savingInFlight.current = true;
    try {
      const saved = await saving.mutateAsync(nextDefinition);
      if (saveGeneration.current !== requestGeneration || idRef.current !== requestJourneyId) {
        return { status: 'failed', message: '旅程已更新，请重新确认候选内容' };
      }
      queryClient.setQueryData(queryKey, saved);
      void queryClient.invalidateQueries({ queryKey: journeyQueryKeys.lists });
      // 应用后以服务器返回内容作为新基准：重置画布、撤销历史和选择，避免旧快照与候选混用。
      acceptJourney(saved);
      return { status: 'applied' };
    } catch (error) {
      if (saveGeneration.current !== requestGeneration || idRef.current !== requestJourneyId) {
        return { status: 'failed', message: '旅程已更新，请重新确认候选内容' };
      }
      if (isSessionExpired(error)) return { status: 'failed', message: '登录已失效，请重新登录' };
      if (
        error instanceof ApiError &&
        (error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR')
      ) {
        // 写入结果不确定：保留候选，先停止自动保存，等运营读取最新内容后再继续。
        setUnconfirmedSave(true);
        setSaveError('本次保存结果未确认，请读取最新内容核实');
        return { status: 'unconfirmed' };
      }
      return handleSaveError(error);
    } finally {
      savingInFlight.current = false;
    }
  }

  // 起草页打开时取消待触发的计时，返回编排后按原有规则恢复。
  useEffect(() => {
    if (!paused) return;
    cancelAutosave();
  }, [cancelAutosave, paused]);

  // 停手 800ms 后再保存；保存请求期间不排队第二个请求，结束后仍有修改会重新计时。
  useEffect(() => {
    if (paused || unconfirmedSave) return;
    if (initializedId !== id || !dirty || !parsedDefinition.success) return;
    if (!canEdit || conflict || dragging || saving.isPending) return;
    if (failedSnapshot.current === currentSnapshot) return;

    const timer = setTimeout(() => {
      autosaveTimer.current = undefined;
      void persistDraftRef.current('auto');
    }, AUTOSAVE_DEBOUNCE_MS);
    autosaveTimer.current = timer;
    return () => {
      clearTimeout(timer);
      if (autosaveTimer.current === timer) autosaveTimer.current = undefined;
    };
  }, [
    canEdit,
    conflict,
    currentSnapshot,
    dirty,
    dragging,
    id,
    initializedId,
    parsedDefinition.success,
    paused,
    saving.isPending,
    unconfirmedSave,
  ]);

  function readLatestAfterConfirm(): Promise<boolean> {
    return new Promise((resolve) => {
      Modal.confirm({
        title: '读取最新旅程？',
        content: '读取后会放弃本页尚未保存的修改。',
        okText: '读取最新内容',
        cancelText: '继续编辑',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            const latest = await getJourney(id);
            queryClient.setQueryData(queryKey, latest);
            acceptJourney(latest);
            resolve(true);
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) {
              // 已删除的旅程无法再读取成功：保留本页内容和提示，但不把运营困在起草页。
              setJourneyMissing(true);
              setSaveError('旅程已不存在，当前内容无法保存。');
            } else if (!isSessionExpired(error)) {
              setSaveError(getApiErrorMessage(error));
            }
            resolve(false);
          }
        },
        onCancel: () => resolve(false),
      });
    });
  }

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const loadError =
    query.error !== null && !notFound && !isSessionExpired(query.error)
      ? getApiErrorMessage(query.error)
      : undefined;
  const saveStatus =
    journey === undefined
      ? '正在读取旅程…'
      : saving.isPending
        ? saveSource.current === 'auto'
          ? '正在自动保存…'
          : '正在保存…'
        : dirty
          ? conflict
            ? '旅程已更新'
            : '有未保存修改'
          : !canEditCampaign(journey.campaign.status)
            ? '只读'
            : journey.draftDefinition
              ? `${lastSaveSource === 'auto' ? '已自动保存' : '草稿已保存'} · ${formatSavedAt(journey.updatedAt)}`
              : '尚未保存';

  /** 编辑器产生新操作时清掉普通失败提示；冲突和结果未确认需保留到重新读取。 */
  const clearSaveError = useCallback(() => {
    if (!conflict && !unconfirmedSave) setSaveError(undefined);
  }, [conflict, unconfirmedSave]);

  return {
    query,
    journey,
    initializedId,
    dirty,
    canEdit,
    conflict,
    mustVerify,
    serverReadOnly,
    journeyMissing,
    saveError,
    saveStatus,
    saving: saving.isPending,
    notFound,
    loadError,
    cancelAutosave,
    clearSaveError,
    readLatestAfterConfirm,
    applyDraft,
    saveDraft: () => void persistDraftRef.current('manual'),
  };
}
