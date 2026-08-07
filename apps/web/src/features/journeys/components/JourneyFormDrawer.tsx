import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Drawer, Flex, Form, Input, App as AntApp, Spin } from 'antd';
import { journeyCreateSchema, type JourneyDetail, type JourneyListItem } from '@journeylens/shared';
import { useBlocker } from 'react-router';
import { ApiError, getWriteErrorMessage, isSessionExpired } from '@/services/api';
import { createJourney, getJourney, updateJourney } from '@/services/journeys';
import { journeyQueryKeys } from '../journey-queries';
import { SegmentPicker } from './SegmentPicker';

type FormValues = { name: string; description: string; segmentId: string | null };
type Props = {
  open: boolean;
  campaignId: string;
  journey?: JourneyListItem;
  onCancel: () => void;
  onSaved: (journey: JourneyDetail, created: boolean) => void;
  restoreFocus: () => void;
};

const EMPTY_VALUES: FormValues = { name: '', description: '', segmentId: null };

function sameValues(left: FormValues, right: FormValues): boolean {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.segmentId === right.segmentId
  );
}

export function JourneyFormDrawer({
  open,
  campaignId,
  journey,
  onCancel,
  onSaved,
  restoreFocus,
}: Props) {
  const { modal } = AntApp.useApp();
  const editing = journey !== undefined;
  const journeyId = journey?.id;
  const queryClient = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [error, setError] = useState<{ message: string; conflict: boolean }>();
  const [ready, setReady] = useState(false);
  const initialValues = useRef(EMPTY_VALUES);
  // 冲突检查固定使用打开表单时的修订号，后台读取不能悄悄替换提交基准。
  const revision = useRef<number | undefined>(undefined);
  const initializedFor = useRef<string | undefined>(undefined);
  // 打开前的成功读取次数；只有本次打开后又有读取成功，才用它建立编辑快照。
  const fetchedCount = useRef(-1);
  const allowNavigation = useRef(false);
  const promptOpen = useRef(false);
  const journeyQuery = useQuery({
    queryKey: journeyQueryKeys.detail(journeyId ?? ''),
    queryFn: ({ signal }) => getJourney(journeyId ?? '', signal),
    enabled: open && journeyId !== undefined,
    refetchOnWindowFocus: false,
  });
  const currentJourney = journeyQuery.data;
  const mutation = useMutation({
    mutationFn: (input: FormValues) => {
      if (!editing) {
        return createJourney(campaignId, {
          name: input.name,
          description: input.description,
          segmentId: input.segmentId,
        });
      }
      if (journeyId === undefined || revision.current === undefined) {
        throw new Error('旅程信息尚未读取完成');
      }
      return updateJourney(journeyId, {
        revision: revision.current,
        name: input.name,
        description: input.description,
        segmentId: input.segmentId,
      });
    },
  });
  const submitting = mutation.isPending;
  // 以已填字段快照判断是否需要保护关闭、路由离开和刷新。
  const dirty = open && ready && !sameValues(values, initialValues.current);
  const blocker = useBlocker(() => dirty && !allowNavigation.current);

  useEffect(() => {
    if (!open) {
      initializedFor.current = undefined;
      fetchedCount.current = -1;
      allowNavigation.current = false;
      setReady(false);
      setValues(EMPTY_VALUES);
      setError(undefined);
      return;
    }
    if (editing) {
      // 缓存里可能还是上次打开时的内容；等本次打开触发的读取成功后再建立编辑快照。
      const fetched =
        queryClient.getQueryState(journeyQueryKeys.detail(journeyId ?? ''))?.dataUpdateCount ?? 0;
      if (fetchedCount.current === -1) fetchedCount.current = fetched;
      if (currentJourney === undefined || fetched <= fetchedCount.current) return;
    }
    const identity = journeyId ?? 'new';
    if (initializedFor.current === identity) return;
    initializedFor.current = identity;
    const next: FormValues = {
      name: currentJourney?.name ?? '',
      description: currentJourney?.description ?? '',
      segmentId: currentJourney?.segment?.id ?? null,
    };
    revision.current = currentJourney?.revision;
    initialValues.current = next;
    allowNavigation.current = false;
    // 表单实例由 useForm 持有，重新打开时表单内容不会因重新挂载自动回到快照，需显式回填。
    form.resetFields();
    form.setFieldsValue(next);
    setValues(next);
    setError(undefined);
    setReady(true);
  }, [currentJourney, editing, form, journeyId, journeyQuery.dataUpdatedAt, open, queryClient]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warnBeforeLeave);
    return () => window.removeEventListener('beforeunload', warnBeforeLeave);
  }, [dirty]);

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      promptOpen.current = false;
      return;
    }
    if (submitting) {
      blocker.reset();
      return;
    }
    if (promptOpen.current) return;
    promptOpen.current = true;
    const blockedNavigation = blocker;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let leaveConfirmed = false;
    modal.confirm({
      title: editing ? '放弃修改？' : '放弃填写？',
      content: '已填写的内容不会保存。',
      okText: editing ? '放弃修改' : '放弃填写',
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
  }, [blocker, editing, submitting, modal]);

  function close(): void {
    allowNavigation.current = true;
    form.resetFields();
    setError(undefined);
    onCancel();
  }

  function requestClose(): void {
    if (submitting) return;
    if (!dirty) {
      close();
      return;
    }
    let discardConfirmed = false;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal.confirm({
      title: editing ? '放弃修改？' : '放弃填写？',
      content: '已填写的内容不会保存。',
      okText: editing ? '放弃修改' : '放弃填写',
      cancelText: '继续填写',
      okButtonProps: { danger: true },
      focusable: { autoFocusButton: 'cancel', focusTriggerAfterClose: false },
      onOk: () => {
        discardConfirmed = true;
        close();
      },
      afterClose: () => {
        if (discardConfirmed) restoreFocus();
        else if (returnFocus?.isConnected) returnFocus.focus();
      },
    });
  }

  async function reloadLatest(): Promise<void> {
    if (journeyId === undefined) return;
    const reload = async () => {
      setError(undefined);
      try {
        const latest = await getJourney(journeyId);
        queryClient.setQueryData(journeyQueryKeys.detail(journeyId), latest);
        revision.current = latest.revision;
        const next: FormValues = {
          name: latest.name,
          description: latest.description ?? '',
          segmentId: latest.segment?.id ?? null,
        };
        initialValues.current = next;
        setValues(next);
        form.resetFields();
        form.setFieldsValue(next);
      } catch (requestError) {
        if (!isSessionExpired(requestError)) {
          setError({ message: '暂时无法读取最新旅程，请稍后重试。', conflict: true });
        }
      }
    };
    if (!dirty) {
      await reload();
      return;
    }
    modal.confirm({
      title: '读取最新旅程？',
      content: '读取后会替换当前填写的内容。',
      okText: '读取最新内容',
      cancelText: '继续编辑',
      onOk: reload,
    });
  }

  async function submit(input: FormValues): Promise<void> {
    if (submitting || (editing && !ready)) return;
    setError(undefined);
    try {
      const saved = await mutation.mutateAsync(input);
      onSaved(saved, !editing);
    } catch (requestError) {
      if (isSessionExpired(requestError)) return;
      if (requestError instanceof ApiError && requestError.code === 'JOURNEY_REVISION_CONFLICT') {
        setError({ message: '旅程已被修改，请重新读取最新内容后再保存。', conflict: true });
        return;
      }
      setError({ message: getWriteErrorMessage(requestError), conflict: false });
    }
  }

  return (
    <Drawer
      title={editing ? '编辑旅程' : '新建旅程'}
      open={open}
      size="large"
      closable={{ disabled: submitting, 'aria-label': '关闭' }}
      keyboard={!submitting}
      focusable={{ focusTriggerAfterClose: false }}
      onClose={requestClose}
      afterOpenChange={(visible) => {
        if (!visible) restoreFocus();
      }}
      footer={
        <Flex justify="end" gap={8}>
          <Button disabled={submitting} onClick={requestClose}>
            取消
          </Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={submitting || (editing && !ready)}
            onClick={() => form.submit()}
          >
            {submitting ? (editing ? '正在保存…' : '正在创建…') : editing ? '保存修改' : '创建旅程'}
          </Button>
        </Flex>
      }
    >
      {editing &&
        journeyQuery.error !== null &&
        journeyQuery.error !== undefined &&
        !isSessionExpired(journeyQuery.error) && (
          <Alert
            style={{ marginBottom: 16 }}
            type="error"
            showIcon
            title="旅程暂时无法读取"
            action={<Button onClick={() => void journeyQuery.refetch()}>重试</Button>}
          />
        )}
      {editing && !ready && journeyQuery.error === null && (
        <Flex
          justify="center"
          role="status"
          aria-label="正在读取旅程"
          style={{ padding: '32px 0' }}
        >
          <Spin />
        </Flex>
      )}
      {error && (
        <Alert
          style={{ marginBottom: 16 }}
          type="error"
          showIcon
          title={error.message}
          action={
            error.conflict ? (
              <Button onClick={() => void reloadLatest()}>重新读取</Button>
            ) : undefined
          }
        />
      )}
      {(!editing || ready) && (
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            name: currentJourney?.name ?? '',
            description: currentJourney?.description ?? '',
            segmentId: currentJourney?.segment?.id ?? null,
          }}
          onValuesChange={(_changed, allValues: FormValues) => {
            setValues({
              name: allValues.name ?? '',
              description: allValues.description ?? '',
              segmentId: allValues.segmentId ?? null,
            });
            setError(undefined);
          }}
          onFinish={submit}
        >
          <Form.Item
            label="旅程名称"
            name="name"
            required
            rules={[
              {
                validator: async (_rule, value: string | undefined) => {
                  const result = journeyCreateSchema.safeParse({
                    name: value ?? '',
                    segmentId: null,
                  });
                  const issue = result.success
                    ? undefined
                    : result.error.issues.find((item) => item.path[0] === 'name');
                  if (issue) throw new Error(issue.message);
                },
              },
            ]}
          >
            <Input autoComplete="off" placeholder="请输入旅程名称" maxLength={180} />
          </Form.Item>
          <Form.Item
            label="说明"
            name="description"
            rules={[{ max: 4000, message: '说明不能超过 4000 个字符' }]}
          >
            <Input.TextArea rows={4} showCount maxLength={4000} placeholder="请输入旅程说明" />
          </Form.Item>
          <Form.Item label="入口分群" name="segmentId">
            <SegmentPicker />
          </Form.Item>
        </Form>
      )}
    </Drawer>
  );
}
