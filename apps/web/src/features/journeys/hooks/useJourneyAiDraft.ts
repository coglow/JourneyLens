import { useRef, useState } from 'react';
import {
  type AiDraftClarification,
  type AiDraftQuestion,
  type JourneyAiDraftResult,
  type JourneyDraftDefinition,
  type JourneyEventType,
} from '@journeylens/shared';
import { ApiError, getApiErrorMessage, isSessionExpired } from '@/services/api';
import { generateJourneyAiDraft } from '@/services/journeys';
import type { ApplyDraftResult } from './useJourneyDraftPersistence';

export type AiDraftStatus =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'needs_input'; questions: AiDraftQuestion[] }
  | { status: 'ready'; draftDefinition: JourneyDraftDefinition }
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; message: string; details?: readonly string[] | undefined };

type Options = {
  journeyId: string;
  /** 当前画布唯一合法开始行为，仅用于进入起草页时的预填。 */
  initialEntryBehavior?: JourneyEventType | undefined;
  onApply: (definition: JourneyDraftDefinition) => Promise<ApplyDraftResult>;
};

function applyFailure(result: Exclude<ApplyDraftResult, { status: 'applied' }>): string {
  switch (result.status) {
    case 'conflict':
      return '旅程已在其他页面修改，请读取最新内容后重新确认';
    case 'unconfirmed':
      return '本次保存结果未确认，请读取最新内容核实';
    case 'read-only':
      return '活动已不能编辑，本次方案未保存';
    case 'missing':
      return '旅程已不存在，本次方案未保存';
    case 'failed':
      return result.message;
  }
}

/**
 * 起草页的本地状态：进入行为、描述、成对补答、候选与失败反馈。
 * 只保留当前起草页内容，候选不写入草稿，也不进入自动保存。
 */
export function useJourneyAiDraft({ journeyId, initialEntryBehavior, onApply }: Options) {
  const [entryBehavior, setEntryBehavior] = useState<JourneyEventType | undefined>(
    initialEntryBehavior,
  );
  const [description, setDescription] = useState('');
  const [clarifications, setClarifications] = useState<AiDraftClarification[]>([]);
  // 尚未作答的新问题与答案按顺序对应；提交后再合并进 clarifications。
  const [questions, setQuestions] = useState<AiDraftQuestion[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [state, setState] = useState<AiDraftStatus>({ status: 'idle' });
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState<string>();
  // 请求序号：切换输入、取消或开始新一轮后，旧响应不再写回界面。
  const sequence = useRef(0);

  function resetClarifications(): void {
    sequence.current += 1;
    setClarifications([]);
    setQuestions([]);
    setAnswers([]);
    setState({ status: 'idle' });
    setApplying(false);
    setApplied(false);
    setApplyError(undefined);
  }

  /** 进入起草页时重置全部内容，只保留传入的预填进入行为。 */
  function start(entry: JourneyEventType | undefined): void {
    resetClarifications();
    setDescription('');
    setEntryBehavior(entry);
  }

  function clear(): void {
    resetClarifications();
    setDescription('');
    setEntryBehavior(undefined);
  }

  /** 修改进入行为或原描述表示重新起草，已填写的补答一并清空。 */
  function changeEntryBehavior(value: JourneyEventType): void {
    if (value === entryBehavior) return;
    resetClarifications();
    setEntryBehavior(value);
  }

  function changeDescription(value: string): void {
    resetClarifications();
    setDescription(value);
  }

  /** 修改任一答案会让候选失效，但保留题目和其他答案供重新提交。 */
  function invalidateCandidate(): void {
    setState((current) => (current.status === 'ready' ? { status: 'idle' } : current));
  }

  function answerPending(index: number, value: string): void {
    setAnswers((current) => current.map((item, position) => (position === index ? value : item)));
    invalidateCandidate();
  }

  function changeClarificationAnswer(index: number, value: string): void {
    setClarifications((current) =>
      current.map((item, position) => (position === index ? { ...item, answer: value } : item)),
    );
    invalidateCandidate();
  }

  function applyResult(result: JourneyAiDraftResult): void {
    if (result.status === 'ready') {
      setQuestions([]);
      setAnswers([]);
      setState({ status: 'ready', draftDefinition: result.draftDefinition });
      return;
    }
    if (result.status === 'unsupported') {
      setState({ status: 'unsupported', reason: result.reason });
      return;
    }
    // 仍需补充：已回答内容原样保留，新问题追加到表单。
    setQuestions(result.questions);
    setAnswers(result.questions.map(() => ''));
    setState({ status: 'needs_input', questions: result.questions });
  }

  /** 首次生成和补答共用一次提交：每次点击最多一次模型调用。 */
  async function submit(): Promise<void> {
    if (state.status === 'pending') return;
    if (entryBehavior === undefined) {
      setState({ status: 'error', message: '请选择进入行为' });
      return;
    }
    if (description.trim() === '') {
      setState({ status: 'error', message: '请填写旅程描述' });
      return;
    }
    const trimmedAnswers = questions.map((_, index) => (answers[index] ?? '').trim());
    if (trimmedAnswers.some((answer) => answer === '')) {
      setState({ status: 'error', message: '请填写全部补充信息后再生成' });
      return;
    }

    const nextClarifications: AiDraftClarification[] = [
      ...clarifications,
      ...questions.map((question, index) => ({ question, answer: trimmedAnswers[index]! })),
    ];
    setClarifications(nextClarifications);
    setQuestions([]);
    setAnswers([]);
    setState({ status: 'pending' });

    const requestSequence = sequence.current + 1;
    sequence.current = requestSequence;
    try {
      const result = await generateJourneyAiDraft(journeyId, {
        entryBehavior,
        description: description.trim(),
        ...(nextClarifications.length === 0 ? {} : { clarifications: nextClarifications }),
      });
      if (sequence.current !== requestSequence) return;
      applyResult(result);
    } catch (error) {
      if (sequence.current !== requestSequence) return;
      // 登录失效由统一拦截处理，这里不覆盖地址跳转。
      if (isSessionExpired(error)) return;
      setState({
        status: 'error',
        message: getApiErrorMessage(error),
        // 服务端会说明哪一步没通过检查，页面逐条展示，避免只说“生成失败”。
        details: error instanceof ApiError ? error.details : undefined,
      });
    }
  }

  /** 放弃本次等待：前端只丢弃迟到响应，服务端仍在原超时内结束调用。 */
  function cancel(): void {
    sequence.current += 1;
    setState({ status: 'idle' });
  }

  /** 应用与生成分开：只有保存确认成功后，才允许直接离开起草页。 */
  async function applyCandidate(definition: JourneyDraftDefinition): Promise<void> {
    if (applying) return;
    setApplying(true);
    setApplyError(undefined);
    const result = await onApply(definition);
    setApplying(false);
    if (result.status === 'applied') setApplied(true);
    else setApplyError(applyFailure(result));
  }

  return {
    entryBehavior,
    description,
    clarifications,
    questions,
    answers,
    state,
    applying,
    applied,
    applyError,
    hasContent:
      !applied && (description.trim() !== '' || clarifications.length > 0 || questions.length > 0),
    pending: state.status === 'pending',
    candidate: state.status === 'ready' ? state.draftDefinition : undefined,
    start,
    clear,
    changeEntryBehavior,
    changeDescription,
    answerPending,
    changeClarificationAnswer,
    submit,
    cancel,
    applyCandidate,
  };
}
