import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from 'antd';
import { useBlocker } from 'react-router';
import {
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

/**
 * 保存基准和本地草稿都按共享校验输出后的结果序列化，
 * 避免字段顺序或首尾空格被去掉后造成“保存了仍显示未保存”。
 */
function definitionSnapshot(definition: JourneyDraftDefinition): string {
  const parsed = journeyDraftDefinitionSchema.safeParse(definition);
  return JSON.stringify(parsed.success ? parsed.data : definition);
}

type Options = {
  id: string;
  definition: JourneyDraftDefinition;
  parsedDefinition: ReturnType<typeof journeyDraftDefinitionSchema.safeParse>;
  dragging: boolean;
  onAcceptDefinition: (definition: JourneyDraftDefinition) => void;
};

/** 统一读取、保存基准、自动保存与冲突处理；保存成功不重建画布或撤销历史。 */
export function useJourneyDraftPersistence({
  id,
  definition: currentDefinition,
  parsedDefinition,
  dragging,
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
  const [lastSaveSource, setLastSaveSource] = useState<'auto' | 'manual'>();
  const revision = useRef<number | undefined>(undefined);
  const allowNavigation = useRef(false);
  const promptOpen = useRef(false);
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

  useEffect(() => {
    // 放行只属于当前跳转；进入另一条旅程后重新启用离开保护。
    allowNavigation.current = false;
  }, [id]);

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
    journey?.campaign.status !== 'draft' ||
    serverReadOnly ||
    journeyMissing ||
    initializedId !== id;
  // 保存期间仍允许编辑，只是不允许再发第二个保存请求。
  const canEdit = !readOnly;
  const blocker = useBlocker(() => (dirty || saving.isPending) && !allowNavigation.current);
  useEffect(() => {
    // 保存请求未结束时也不能直接离开，否则离开后无法确认最新内容。
    if (!dirty && !saving.isPending) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warnBeforeLeave);
    return () => window.removeEventListener('beforeunload', warnBeforeLeave);
  }, [dirty, saving.isPending]);

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      promptOpen.current = false;
      return;
    }
    if (promptOpen.current) return;
    promptOpen.current = true;
    const blockedNavigation = blocker;
    const pendingOnly = saving.isPending && !dirty;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let leaveConfirmed = false;
    Modal.confirm({
      title: pendingOnly ? '保存尚未完成，仍要离开？' : '放弃未保存的修改？',
      content: pendingOnly
        ? '保存请求还没有结束，离开后可能无法确认最新内容。'
        : '当前修改还没有保存，离开后将无法恢复。',
      okText: '放弃修改',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      focusable: { autoFocusButton: 'cancel', focusTriggerAfterClose: false },
      onOk: () => {
        leaveConfirmed = true;
        allowNavigation.current = true;
        blockedNavigation.proceed();
      },
      onCancel: () => blockedNavigation.reset(),
      afterClose: () => {
        if (!leaveConfirmed && returnFocus?.isConnected) returnFocus.focus();
      },
    });
  }, [blocker, dirty, saving.isPending]);
  /** 自动保存和手动保存共用同一条请求流程，保存成功后不重置历史和选中状态。 */
  async function persistDraft(source: 'auto' | 'manual'): Promise<void> {
    if (revision.current === undefined || savingInFlight.current || saving.isPending) return;
    if (!parsedDefinition.success || !canEdit || conflict || !dirty) return;

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
      if (error instanceof ApiError && error.code === 'JOURNEY_REVISION_CONFLICT') {
        setConflict(true);
        setSaveError('旅程已在其他页面修改，你的内容仍保留在本页。读取最新内容前会先确认。');
      } else if (error instanceof ApiError && error.code === 'CAMPAIGN_NOT_DRAFT') {
        setServerReadOnly(true);
        setSaveError('活动已不能编辑，当前编排无法保存。');
      } else if (error instanceof ApiError && error.status === 404) {
        setJourneyMissing(true);
        setSaveError('旅程已不存在，当前编排无法保存。');
      } else {
        // 普通失败后暂停自动保存，等业务内容再次变化或用户手动保存时再试。
        failedSnapshot.current = sentSnapshot;
        setSaveError(getWriteErrorMessage(error));
      }
    } finally {
      savingInFlight.current = false;
    }
  }

  const persistDraftRef = useRef(persistDraft);
  persistDraftRef.current = persistDraft;

  // 停手 800ms 后再保存；保存请求期间不排队第二个请求，结束后仍有修改会重新计时。
  useEffect(() => {
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
    saving.isPending,
  ]);

  function readLatestAfterConfirm(): void {
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
        } catch (error) {
          if (!isSessionExpired(error)) setSaveError(getApiErrorMessage(error));
        }
      },
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
          : journey?.campaign.status !== 'draft'
            ? '只读'
            : journey.draftDefinition
              ? `${lastSaveSource === 'auto' ? '已自动保存' : '草稿已保存'} · ${formatSavedAt(journey.updatedAt)}`
              : '尚未保存';

  /** 编辑器产生新操作时清掉上一次失败提示；冲突需要保留直到重新读取。 */
  const clearSaveError = useCallback(() => {
    if (!conflict) setSaveError(undefined);
  }, [conflict]);

  return {
    query,
    journey,
    initializedId,
    dirty,
    canEdit,
    conflict,
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
    saveDraft: () => void persistDraftRef.current('manual'),
  };
}
