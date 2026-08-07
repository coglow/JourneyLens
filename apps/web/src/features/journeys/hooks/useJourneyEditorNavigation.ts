import { useEffect, useMemo, useRef } from 'react';
import { App as AntApp } from 'antd';
import { useBlocker, useLocation } from 'react-router';
import type { useJourneyAiDraft } from './useJourneyAiDraft';

type Options = {
  id: string;
  dirty: boolean;
  saving: boolean;
  mustVerify: boolean;
  aiDraftPage: boolean;
  aiDraft: Pick<
    ReturnType<typeof useJourneyAiDraft>,
    'hasContent' | 'pending' | 'applying' | 'cancel'
  >;
};

type LeavePrompt = {
  title: string;
  content: string;
  okText: string;
  cancelText: string;
  /** 为真时只能留在本页：确定按钮禁用，取消按钮提示“留在此页”。 */
  mustStay: boolean;
};

function buildLeavePrompt(input: {
  aiDraftPage: boolean;
  applying: boolean;
  mustVerify: boolean;
  aiPending: boolean;
  hasAiContent: boolean;
  saving: boolean;
  dirty: boolean;
  leavingWorkspace: boolean;
}): LeavePrompt {
  if (input.aiDraftPage) {
    // 起草页的候选和补答都不保存，离开即丢失；原编排是否也有未保存修改要单独说明。
    const candidateGone = `离开后本次输入、补充信息和候选都不会保留。${
      input.leavingWorkspace && input.dirty ? '原编排的未保存修改也会丢失。' : '原编排内容仍保留。'
    }`;

    if (input.applying) {
      return {
        title: '正在保存方案，请稍候',
        content: '正在保存，请等待保存结束后再离开。',
        okText: '放弃并离开',
        cancelText: '留在此页',
        mustStay: true,
      };
    }
    if (input.mustVerify) {
      return {
        title: '请先读取最新旅程',
        content: '请先读取最新内容，确认当前旅程后再离开。',
        okText: '放弃并离开',
        cancelText: '留在此页',
        mustStay: true,
      };
    }
    if (input.aiPending) {
      return {
        title: '方案还在生成，仍要离开？',
        content: candidateGone,
        okText: '放弃并离开',
        cancelText: '继续编辑',
        mustStay: false,
      };
    }
    if (input.hasAiContent) {
      return {
        title: '放弃本次起草？',
        content: candidateGone,
        okText: '放弃并离开',
        cancelText: '继续编辑',
        mustStay: false,
      };
    }
  }

  if (input.saving && !input.dirty) {
    return {
      title: '保存尚未完成，仍要离开？',
      content: '保存请求还没有结束，离开后可能无法确认最新内容。',
      okText: '放弃修改',
      cancelText: '继续编辑',
      mustStay: false,
    };
  }

  return {
    title: '放弃未保存的修改？',
    content: '当前修改还没有保存，离开后将无法恢复。',
    okText: '放弃修改',
    cancelText: '继续编辑',
    mustStay: false,
  };
}

/** 编排、模拟与起草共用一个离开保护，避免多个路由拦截器互相覆盖。 */
export function useJourneyEditorNavigation({
  id,
  dirty,
  saving,
  mustVerify,
  aiDraftPage,
  aiDraft,
}: Options) {
  const { modal } = AntApp.useApp();
  const location = useLocation();
  const allowNavigation = useRef(false);
  const promptOpen = useRef(false);
  useEffect(() => {
    allowNavigation.current = false;
  }, [location.key]);

  const sharedPaths = useMemo(
    () => [`/journeys/${id}/editor`, `/journeys/${id}/simulation`, `/journeys/${id}/ai-draft`],
    [id],
  );
  const aiProtected =
    aiDraftPage && (aiDraft.hasContent || aiDraft.pending || aiDraft.applying || mustVerify);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !allowNavigation.current &&
      currentLocation.pathname !== nextLocation.pathname &&
      (aiProtected ||
        ((dirty || saving) &&
          !(
            sharedPaths.includes(currentLocation.pathname) &&
            sharedPaths.includes(nextLocation.pathname)
          ))),
  );

  useEffect(() => {
    if (!dirty && !saving && !aiProtected) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving, aiProtected]);

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      promptOpen.current = false;
      return;
    }
    if (promptOpen.current) return;
    promptOpen.current = true;
    const blocked = blocker;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let confirmed = false;
    const leavingWorkspace = !sharedPaths.includes(blocked.location.pathname);
    const copy = buildLeavePrompt({
      aiDraftPage,
      applying: aiDraft.applying,
      mustVerify,
      aiPending: aiDraft.pending,
      hasAiContent: aiDraft.hasContent,
      saving,
      dirty,
      leavingWorkspace,
    });
    modal.confirm({
      title: copy.title,
      content: copy.content,
      okText: copy.okText,
      cancelText: copy.cancelText,
      okButtonProps: { danger: true, disabled: copy.mustStay },
      focusable: { autoFocusButton: 'cancel', focusTriggerAfterClose: false },
      onOk: () => {
        confirmed = true;
        if (aiDraftPage) aiDraft.cancel();
        allowNavigation.current = true;
        blocked.proceed();
      },
      onCancel: () => blocked.reset(),
      afterClose: () => {
        if (!confirmed && returnFocus?.isConnected) returnFocus.focus();
      },
    });
  }, [blocker, dirty, saving, aiProtected, aiDraftPage, aiDraft, mustVerify, sharedPaths, modal]);
}
