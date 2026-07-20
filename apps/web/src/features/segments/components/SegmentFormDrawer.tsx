import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Flex,
  Form,
  Input,
  Modal,
  Progress,
  Spin,
  Typography,
} from 'antd';
import {
  analyzeSegmentRuleSatisfiability,
  segmentCreateSchema,
  segmentRuleSchema,
  type SegmentCreateInput,
  type SegmentDetail,
  type SegmentPreview,
  type SegmentRule,
} from '@journeylens/shared';
import { useBlocker } from 'react-router';
import { getApiErrorMessage, getWriteErrorMessage, isSessionExpired } from '@/services/api';
import {
  createSegment,
  getSegment,
  refreshSegmentEstimate,
  updateSegment,
} from '@/services/segments';
import { useSegmentPreview } from '@/features/segments/hooks/useSegmentPreview';
import { segmentQueryKeys } from '@/features/segments/segment-queries';
import { RuleTreeEditor } from './RuleTreeEditor';
import { SegmentRuleView } from './SegmentRuleView';

type SegmentFormValues = { name: string; description?: string };
type PendingCreate = { values: SegmentFormValues; rules: SegmentRule };
/** 打开表单时冻结的分群标识与修订号，保证提交内容与冲突检查基准来自同一次读取。 */
type EditingTarget = { id: string; revision: number };

type SegmentFormDrawerProps = {
  open: boolean;
  segment?: SegmentDetail;
  segmentId?: string;
  onCancel: () => void;
  onSaved: (segment: SegmentDetail, estimateRefreshFailed: boolean) => void;
  restoreFocus: () => void;
};

const EMPTY_VALUES: SegmentFormValues = { name: '', description: '' };
const EMPTY_RULE: SegmentRule = { kind: 'all', children: [] };

function snapshot(values: SegmentFormValues, rules: SegmentRule): string {
  return JSON.stringify({ name: values.name ?? '', description: values.description ?? '', rules });
}

function previewPercent(result: SegmentPreview): string {
  return result.total === 0 ? '0' : ((result.matched / result.total) * 100).toFixed(1);
}

export function SegmentFormDrawer({
  open,
  segment,
  segmentId,
  onCancel,
  onSaved,
  restoreFocus,
}: SegmentFormDrawerProps) {
  const editing = segment !== undefined || segmentId !== undefined;
  const segmentQuery = useQuery({
    queryKey: segmentQueryKeys.detail(segmentId ?? ''),
    queryFn: ({ signal }) => getSegment(segmentId ?? '', signal),
    enabled: open && segment === undefined && segmentId !== undefined,
    refetchOnWindowFocus: false,
  });
  const currentSegment =
    segment ?? (segmentQuery.isFetchedAfterMount ? segmentQuery.data : undefined);
  const loadError =
    segmentQuery.error !== null && !isSessionExpired(segmentQuery.error)
      ? getApiErrorMessage(segmentQuery.error)
      : undefined;
  const [form] = Form.useForm<SegmentFormValues>();
  const [formValues, setFormValues] = useState<SegmentFormValues>(EMPTY_VALUES);
  const [rules, setRules] = useState<SegmentRule>(EMPTY_RULE);
  const [error, setError] = useState<string>();
  const [pendingCreate, setPendingCreate] = useState<PendingCreate>();
  const initialSnapshot = useRef(snapshot(EMPTY_VALUES, EMPTY_RULE));
  const initializedFor = useRef<string | undefined>(undefined);
  const editingTarget = useRef<EditingTarget | undefined>(undefined);
  const blockerPromptOpen = useRef(false);
  const allowNavigation = useRef(false);
  const currentValues = {
    name: formValues.name ?? '',
    description: formValues.description ?? '',
  };
  const isDirty = open && snapshot(currentValues, rules) !== initialSnapshot.current;
  const blocker = useBlocker(() => isDirty && !allowNavigation.current);

  const ruleResult = useMemo(() => segmentRuleSchema.safeParse(rules), [rules]);
  const analysis = useMemo(
    () => (ruleResult.success ? analyzeSegmentRuleSatisfiability(ruleResult.data) : undefined),
    [ruleResult],
  );
  const previewRule =
    ruleResult.success && analysis?.rootUnsatisfiable !== true ? ruleResult.data : undefined;
  const { previewState, cancelPreview } = useSegmentPreview(open, previewRule);
  const saveMutation = useMutation({
    mutationFn: ({ values, rules: savedRules }: PendingCreate) => {
      const input = {
        name: values.name,
        description: values.description,
        rules: savedRules,
      } satisfies SegmentCreateInput;
      if (!editing) return createSegment(input);
      const target = editingTarget.current;
      if (target === undefined) throw new Error('分群信息尚未读取完成');
      return updateSegment(target.id, { ...input, revision: target.revision });
    },
  });
  const estimateMutation = useMutation({
    mutationFn: ({ segmentId, revision }: { segmentId: string; revision: number }) =>
      refreshSegmentEstimate(segmentId, revision),
  });
  const isSaving = saveMutation.isPending || estimateMutation.isPending;

  useEffect(() => {
    if (open) {
      if (editing && currentSegment === undefined) return;
      const identity = editing ? currentSegment?.id : 'new';
      if (initializedFor.current === identity) return;
      initializedFor.current = identity;
      // 后台刷新只更新详情展示，不能悄悄替换这次编辑提交的冲突检查基准。
      editingTarget.current =
        currentSegment === undefined
          ? undefined
          : { id: currentSegment.id, revision: currentSegment.revision };
      const values = {
        name: currentSegment?.name ?? '',
        description: currentSegment?.description ?? '',
      };
      const nextRules = currentSegment?.rules ?? EMPTY_RULE;
      allowNavigation.current = false;
      form.resetFields();
      form.setFieldsValue(values);
      setFormValues(values);
      setRules(nextRules);
      setError(undefined);
      initialSnapshot.current = snapshot(values, nextRules);
      return;
    }

    initializedFor.current = undefined;
    editingTarget.current = undefined;
    setFormValues(EMPTY_VALUES);
    setRules(EMPTY_RULE);
    setError(undefined);
    initialSnapshot.current = snapshot(EMPTY_VALUES, EMPTY_RULE);
  }, [
    form,
    open,
    editing,
    currentSegment?.description,
    currentSegment?.id,
    currentSegment?.name,
    currentSegment?.revision,
    currentSegment?.rules,
    currentSegment,
  ]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeLeave);
    return () => window.removeEventListener('beforeunload', warnBeforeLeave);
  }, [isDirty]);

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      blockerPromptOpen.current = false;
      return;
    }
    if (pendingCreate !== undefined) {
      setPendingCreate(undefined);
      return;
    }
    if (blockerPromptOpen.current) return;
    blockerPromptOpen.current = true;
    const blockedNavigation = blocker;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let leaveConfirmed = false;
    Modal.confirm({
      title: editing ? '放弃修改？' : '放弃填写？',
      content: '已填写的内容不会保存。',
      okText: editing ? '放弃修改' : '放弃填写',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      focusable: { autoFocusButton: 'cancel', focusTriggerAfterClose: false },
      onOk: () => {
        leaveConfirmed = true;
        allowNavigation.current = true;
        cancelPreview();
        onCancel();
        blockedNavigation.proceed();
      },
      onCancel: () => blockedNavigation.reset(),
      afterClose: () => {
        if (!leaveConfirmed && returnFocus?.isConnected) returnFocus.focus();
      },
    });
  }, [blocker, cancelPreview, editing, onCancel, pendingCreate]);

  function changeRules(next: SegmentRule): void {
    cancelPreview();
    setError(undefined);
    setRules(next);
  }

  function close(): void {
    allowNavigation.current = true;
    cancelPreview();
    onCancel();
  }

  function requestClose(): void {
    if (isSaving) return;
    if (!isDirty) {
      close();
      return;
    }

    let discardConfirmed = false;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    Modal.confirm({
      title: editing ? '放弃修改？' : '放弃填写？',
      content: '已填写的内容不会保存。',
      okText: editing ? '放弃修改' : '放弃填写',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      focusable: { autoFocusButton: 'cancel', focusTriggerAfterClose: false },
      onOk: () => {
        discardConfirmed = true;
        close();
      },
      afterClose: () => {
        if (discardConfirmed) {
          window.setTimeout(() => {
            restoreFocus();
          }, 50);
        } else if (returnFocus?.isConnected) returnFocus.focus();
      },
    });
  }

  async function save(values: SegmentFormValues, currentRules: SegmentRule): Promise<void> {
    if (isSaving) return;
    setError(undefined);
    let saved: SegmentDetail;
    try {
      saved = await saveMutation.mutateAsync({ values, rules: currentRules });
    } catch (requestError) {
      if (!isSessionExpired(requestError)) setError(getWriteErrorMessage(requestError));
      return;
    }

    allowNavigation.current = true;
    initialSnapshot.current = snapshot(
      { name: saved.name, description: saved.description ?? '' },
      saved.rules,
    );
    cancelPreview();

    let savedWithEstimate = saved;
    let estimateRefreshFailed = false;
    try {
      const estimate = await estimateMutation.mutateAsync({
        segmentId: saved.id,
        revision: saved.revision,
      });
      savedWithEstimate = { ...saved, audienceEstimate: { ...estimate, isStale: false } };
    } catch {
      // 保存已成功；预估失败单独反馈，不能让用户误以为规则也没保存。
      estimateRefreshFailed = true;
    }
    onSaved(savedWithEstimate, estimateRefreshFailed);
  }

  async function submit(values: SegmentFormValues): Promise<void> {
    if (isSaving || (editing && currentSegment === undefined)) return;
    setError(undefined);
    if (!ruleResult.success) {
      setError('请至少添加一个完整条件，并填写所需的比较值。');
      return;
    }
    if (analysis?.rootUnsatisfiable) {
      setError(
        analysis.findings.find((finding) => finding.path.length === 0)?.message ??
          '分群条件互相矛盾，无法筛选出用户。请修改冲突的条件。',
      );
      return;
    }

    if (!editing) {
      // 创建前保存一份待确认快照，确保弹窗展示的规则就是随后提交的规则。
      setPendingCreate({ values, rules: ruleResult.data });
      return;
    }
    await save(values, ruleResult.data);
  }

  return (
    <>
      <Drawer
        title={editing ? '编辑分群' : '新建分群'}
        open={open}
        size="large"
        destroyOnHidden

        closable={{ disabled: isSaving, 'aria-label': '关闭' }}
        keyboard={!isSaving}
        focusable={{ focusTriggerAfterClose: false }}
        onClose={requestClose}
        footer={
          <Flex justify="end" gap={8}>
            <Button disabled={isSaving} onClick={requestClose}>
              取消
            </Button>
            <Button
              type="primary"
              loading={isSaving}
              disabled={
                isSaving ||
                pendingCreate !== undefined ||
                (editing && currentSegment === undefined) ||
                !ruleResult.success ||
                analysis?.rootUnsatisfiable === true
              }
              onClick={() => form.submit()}
            >
              {isSaving ? '正在保存并更新人数…' : editing ? '保存修改' : '创建分群'}
            </Button>
          </Flex>
        }
        afterOpenChange={(visible) => {
          if (!visible) restoreFocus();
        }}
      >
        {editing && currentSegment === undefined ? (
          loadError ? (
            <Alert
              type="error"
              showIcon
              title={loadError}
              action={<Button onClick={() => void segmentQuery.refetch()}>重试</Button>}
            />
          ) : (
            <div
              role="status"
              aria-label="正在读取分群"
              style={{ padding: '48px 0', textAlign: 'center' }}
            >
              <Spin />
            </div>
          )
        ) : (
          <Form
            form={form}
            layout="vertical"
            initialValues={EMPTY_VALUES}
            scrollToFirstError={{ behavior: 'instant', block: 'end', focus: true }}
            onValuesChange={(_, values: SegmentFormValues) => setFormValues(values)}
            onFinish={submit}
          >
            {error && <Alert style={{ marginBottom: 16 }} type="error" showIcon title={error} />}
            <Card title="基本信息" style={{ marginBottom: 16 }}>
              <Form.Item
                label="分群名称"
                name="name"
                required
                rules={[
                  {
                    validator: async (_, value: string | undefined) => {
                      const result = segmentCreateSchema.shape.name.safeParse(value ?? '');
                      if (!result.success)
                        throw new Error(result.error.issues[0]?.message ?? '请检查分群名称');
                    },
                  },
                ]}
              >
                <Input autoComplete="off" placeholder="请输入分群名称" />
              </Form.Item>
              <Form.Item
                label="说明"
                name="description"
                rules={[
                  {
                    validator: async (_, value: string | undefined) => {
                      const result = segmentCreateSchema.shape.description.safeParse(value ?? '');
                      if (!result.success)
                        throw new Error(result.error.issues[0]?.message ?? '请检查分群说明');
                    },
                  },
                ]}
              >
                <Input.TextArea rows={3} showCount maxLength={2000} placeholder="说明该分群用途" />
              </Form.Item>
            </Card>

            <Card title="规则条件" style={{ marginBottom: 16 }}>
              <RuleTreeEditor value={rules} onChange={changeRules} />
              {!ruleResult.success && (
                <Alert
                  style={{ marginTop: 12 }}
                  type="info"
                  showIcon
                  title="请至少添加一个完整条件，并填写所需的比较值。"
                />
              )}
            </Card>

            <Card title="人群预估">
              <Flex vertical gap={12}>
                <Typography.Text type="secondary">补全分群规则后会自动预估。</Typography.Text>
                {previewState?.status === 'loading' && (
                  <Typography.Text role="status">正在预估…</Typography.Text>
                )}
                {previewState?.status === 'success' && (
                  <Flex align="center" gap={16} role="status" aria-live="polite">
                    <Flex align="baseline" gap={8} wrap={false} style={{ whiteSpace: 'nowrap' }}>
                      <Typography.Text>预计匹配</Typography.Text>
                      <Typography.Text
                        strong
                        style={{ color: 'var(--ant-color-primary)', fontSize: 30 }}
                      >
                        {previewState.result.matched.toLocaleString('zh-CN')}
                      </Typography.Text>
                      <Typography.Text>人</Typography.Text>
                    </Flex>
                    <Progress
                      percent={
                        previewState.result.total === 0
                          ? 0
                          : (previewState.result.matched / previewState.result.total) * 100
                      }
                      showInfo={false}
                      strokeColor="#52c41a"
                      style={{ flex: 1, minWidth: 80, margin: 0 }}
                    />
                    <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
                      约占全部用户 {previewPercent(previewState.result)}%
                    </Typography.Text>
                  </Flex>
                )}
                {previewState?.status === 'error' && (
                  <Alert type="error" showIcon title={previewState.message} />
                )}
              </Flex>
            </Card>
          </Form>
        )}
      </Drawer>
      <Modal
        title="确认创建分群"
        open={pendingCreate !== undefined}
        zIndex={1100}
        okText="确认创建"
        cancelText="返回修改"
        confirmLoading={isSaving}
        closable={!isSaving}
        keyboard={!isSaving}
        cancelButtonProps={{ disabled: isSaving }}
        onCancel={() => setPendingCreate(undefined)}
        onOk={async () => {
          if (pendingCreate === undefined) return;
          await save(pendingCreate.values, pendingCreate.rules);
          setPendingCreate(undefined);
        }}
      >
        {pendingCreate && (
          <Flex vertical gap={12}>
            <Descriptions
              column={1}
              size="small"
              items={[
                { key: 'name', label: '分群名称', children: pendingCreate.values.name },
                {
                  key: 'description',
                  label: '分群说明',
                  children: pendingCreate.values.description || '—',
                },
              ]}
            />
            <Typography.Text type="secondary">规则条件</Typography.Text>
            <SegmentRuleView rules={pendingCreate.rules} />
            {previewState?.status === 'loading' && (
              <Typography.Text type="secondary">正在预估…</Typography.Text>
            )}
            {previewState?.status === 'success' && (
              <Typography.Text type="secondary">
                预计匹配 {previewState.result.matched.toLocaleString('zh-CN')} 人，约占全部用户{' '}
                {previewPercent(previewState.result)}%
              </Typography.Text>
            )}
          </Flex>
        )}
      </Modal>
    </>
  );
}
