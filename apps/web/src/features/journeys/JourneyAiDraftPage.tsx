import { ThemeToggle } from '@/components/ThemeToggle';
import { useColorMode } from '@/app/ThemeProvider';
import { useEffect, useMemo } from 'react';
import { ArrowLeftOutlined, InfoCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Collapse,
  Empty,
  Flex,
  Input,
  Popconfirm,
  Radio,
  Select,
  Spin,
  Tooltip,
  Typography,
} from 'antd';
import {
  AI_DRAFT_DESCRIPTION_MAX_LENGTH,
  JOURNEY_ENTRY_BEHAVIORS,
  type AiDraftQuestion,
  type JourneyDraftDefinition,
  type JourneyLayoutDirection,
} from '@journeylens/shared';
import { JourneyAiDraftPreview } from '@/features/journeys/components/JourneyAiDraftPreview';
import { layoutJourneyNodes } from '@/features/journeys/journey-layout';
import type { useJourneyAiDraft } from '@/features/journeys/hooks/useJourneyAiDraft';
import styles from './JourneyAiDraftPage.module.css';

type Props = {
  draft: ReturnType<typeof useJourneyAiDraft>;
  journeyName: string;
  segmentName: string | null;
  layoutDirection: JourneyLayoutDirection;
  hasExistingFlow: boolean;
  unsavedChanges: boolean;
  /** 保存层的核实状态与错误，不随起草输入重置。 */
  mustVerify: boolean;
  saveError: string | undefined;
  blockReason: string | undefined;
  onReturn: () => void;
  onReadLatest: () => Promise<void>;
};

/** 独立起草页只负责输入和预览；原画布、起草状态与保存仍由同一旅程编辑实例持有。 */
export function JourneyAiDraftPage({
  draft,
  journeyName,
  segmentName,
  layoutDirection,
  hasExistingFlow,
  unsavedChanges,
  mustVerify,
  saveError,
  blockReason,
  onReturn,
  onReadLatest,
}: Props) {
  const { mode, switching, toggleMode } = useColorMode();
  const { applying, applied, applyError } = draft;
  const applyMessage = saveError ?? applyError;
  const busy = draft.pending || applying;
  const blocked = blockReason !== undefined;
  const canSubmit =
    !busy &&
    !applied &&
    !mustVerify &&
    !blocked &&
    draft.entryBehavior !== undefined &&
    draft.description.trim() !== '' &&
    !draft.answers.some((answer) => answer.trim() === '');
  const hint =
    draft.state.status === 'unsupported'
      ? draft.state.reason
      : draft.state.status === 'error'
        ? draft.state.message
        : undefined;
  // 服务端会说明哪一步没通过检查；有具体条目时逐条展示，不让运营只看到“生成失败”。
  const errorDetails = draft.state.status === 'error' ? draft.state.details : undefined;
  // 候选按当前布局方向排好坐标后再用于预览和应用，模型不负责位置。
  const laidOutCandidate = useMemo(() => {
    const candidate = draft.candidate;
    if (candidate === undefined) return undefined;
    const positions = layoutJourneyNodes(candidate.nodes, candidate.edges, layoutDirection);
    return {
      layoutDirection,
      nodes: candidate.nodes.map((node) => ({
        ...node,
        position: positions[node.id] ?? node.position,
      })),
      edges: candidate.edges,
    } satisfies JourneyDraftDefinition;
  }, [draft.candidate, layoutDirection]);

  // 保存成功后回到原编排；只有服务器确认成功才触发返回，不绕过保存保护。
  useEffect(() => {
    if (applied) onReturn();
  }, [applied, onReturn]);

  function answerField(
    question: AiDraftQuestion | undefined,
    value: string,
    onChange: (next: string) => void,
    key: string,
  ) {
    if (question === undefined) return null;
    return question.type === 'text' ? (
      <Input
        key={key}
        aria-label={question.label}
        value={value}
        disabled={busy || applied || blocked}
        onChange={(event) => onChange(event.target.value)}
      />
    ) : (
      <Radio.Group
        key={key}
        aria-label={question.label}
        value={value}
        disabled={busy || applied || blocked}
        options={question.options.map((option) => ({ label: option.label, value: option.value }))}
        onChange={(event) => onChange(String(event.target.value))}
      />
    );
  }

  return (
    <section className={styles.page} aria-label="AI 起草旅程">
      <header className={styles.header}>
        <Flex align="center" gap={20} className={styles.heading}>
          <ThemeToggle mode={mode} switching={switching} onToggle={toggleMode} />
          <Button
            type="text"
            aria-label="返回编排"
            icon={<ArrowLeftOutlined />}
            disabled={applying || mustVerify}
            onClick={onReturn}
          >
            返回编排
          </Button>
          <Typography.Title level={3} className={styles.title ?? ''}>
            AI 起草
          </Typography.Title>
          <Typography.Text type="secondary" ellipsis className={styles.journeyName ?? ''}>
            {journeyName}
          </Typography.Text>
          <Tooltip title={`入口人群：${segmentName ?? '不限人群'}（沿用当前设置）`}>
            <Button
              type="text"
              size="small"
              aria-label={`入口人群：${segmentName ?? '不限人群'}（沿用当前设置）`}
              icon={<InfoCircleOutlined />}
            />
          </Tooltip>
        </Flex>
        {laidOutCandidate !== undefined && !applied && (
          <Flex align="center" gap={12}>
            {hasExistingFlow && (
              <Typography.Text type="secondary" className={styles.replaceHint ?? ''}>
                将替换当前草稿
              </Typography.Text>
            )}
            <Popconfirm
              disabled={!hasExistingFlow || busy || mustVerify || blocked}
              title="替换当前流程并保存？"
              description={
                <div className={styles.confirmText}>
                  应用后将替换当前全部流程，原草稿的撤销记录将清空。
                  {unsavedChanges ? '本页尚未保存的修改也会一起被替换。' : ''}请确认已核对候选内容。
                </div>
              }
              okText="替换并保存"
              cancelText="继续核对"
              onConfirm={() => draft.applyCandidate(laidOutCandidate)}
            >
              <Button
                type="primary"
                loading={applying}
                disabled={draft.pending || mustVerify || blocked}
                onClick={() => {
                  if (!hasExistingFlow) void draft.applyCandidate(laidOutCandidate);
                }}
              >
                应用并保存草稿
              </Button>
            </Popconfirm>
          </Flex>
        )}
      </header>
      {applied ? (
        <Typography.Text role="status" type="success">
          已应用并保存草稿
        </Typography.Text>
      ) : (
        <div className={styles.workspace}>
          <aside className={styles.inputPanel} aria-label="起草要求">
            <div className={styles.inputBody}>
              <Typography.Title level={5} className={styles.panelTitle ?? ''}>
                起草要求
              </Typography.Title>
              {blockReason !== undefined && <Alert type="warning" showIcon title={blockReason} />}
              <Flex vertical gap={6}>
                <Flex align="center" gap={8}>
                  <Typography.Text strong>进入行为</Typography.Text>
                  <Tooltip title="本次起草会使用这个进入行为，请先选择再生成。">
                    <QuestionCircleOutlined tabIndex={0} aria-label="进入行为说明" />
                  </Tooltip>
                </Flex>
                <Select
                  aria-label="进入行为"
                  placeholder="请选择进入行为"
                  className={styles.fullWidth ?? ''}
                  value={draft.entryBehavior}
                  disabled={busy || blocked}
                  options={JOURNEY_ENTRY_BEHAVIORS.map((item) => ({
                    label: item.label,
                    value: item.value,
                  }))}
                  onChange={(value) => {
                    if (value !== undefined) draft.changeEntryBehavior(value);
                  }}
                />
              </Flex>

              <Flex vertical gap={6}>
                <Typography.Text strong>旅程描述</Typography.Text>
                <Input.TextArea
                  aria-label="旅程描述"
                  value={draft.description}
                  disabled={busy || blocked}
                  maxLength={AI_DRAFT_DESCRIPTION_MAX_LENGTH}
                  showCount
                  autoSize={{ minRows: 7, maxRows: 14 }}
                  placeholder="例如：等待一小时内购买同一商品；等到购买就结束，超时则生成一条短信提醒后结束。"
                  onChange={(event) => draft.changeDescription(event.target.value)}
                />
              </Flex>

              {draft.clarifications.length > 0 && (
                <Collapse
                  className={styles.answers ?? ''}
                  items={[
                    {
                      key: 'answered',
                      label: `已补充信息（${draft.clarifications.length}）`,
                      children: (
                        <Flex vertical gap={12}>
                          {draft.clarifications.map((item, index) => (
                            <Flex vertical gap={4} key={`${item.question.label}-${index}`}>
                              <Typography.Text>{`问题 ${index + 1}：${item.question.label}`}</Typography.Text>
                              {answerField(
                                item.question,
                                item.answer,
                                (next) => draft.changeClarificationAnswer(index, next),
                                `answered-${index}`,
                              )}
                            </Flex>
                          ))}
                          {draft.candidate === undefined && (
                            <Typography.Text type="secondary">
                              修改补答后需要重新生成。
                            </Typography.Text>
                          )}
                        </Flex>
                      ),
                    },
                  ]}
                />
              )}

              {draft.questions.length > 0 && (
                <Flex vertical gap={10}>
                  <Typography.Text strong>需要你补充</Typography.Text>
                  {draft.questions.map((question, index) => (
                    <Flex vertical gap={4} key={`${question.label}-${index}`}>
                      <Typography.Text>{`问题 ${index + 1}：${question.label}`}</Typography.Text>
                      {answerField(
                        question,
                        draft.answers[index] ?? '',
                        (next) => draft.answerPending(index, next),
                        `pending-${index}`,
                      )}
                    </Flex>
                  ))}
                </Flex>
              )}

              {draft.pending && (
                <Flex align="center" gap={12} role="status" aria-label="正在生成方案">
                  <Spin size="small" />
                  <Typography.Text>正在生成方案，请稍候…</Typography.Text>
                  <Button type="link" onClick={draft.cancel}>
                    取消生成
                  </Button>
                </Flex>
              )}

              {hint !== undefined && (
                <Alert
                  type={draft.state.status === 'error' ? 'error' : 'warning'}
                  showIcon
                  title={hint}
                  description={
                    errorDetails === undefined ? undefined : (
                      <ul className={styles.errorDetails}>
                        {errorDetails.map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    )
                  }
                  action={
                    draft.state.status === 'error' ? (
                      <Button type="link" onClick={() => void draft.submit()} disabled={!canSubmit}>
                        重试
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </div>
            <div className={styles.inputFooter}>
              <Button
                block
                type={laidOutCandidate === undefined ? 'primary' : 'default'}
                onClick={() => void draft.submit()}
                loading={draft.pending}
                disabled={!canSubmit}
              >
                {laidOutCandidate !== undefined
                  ? '重新生成方案'
                  : draft.questions.length > 0
                    ? '补充并生成'
                    : '生成方案'}
              </Button>
            </div>
          </aside>
          <main className={styles.resultPanel} aria-label="候选流程">
            {applyMessage !== undefined && (
              <Alert
                type="error"
                showIcon
                title={applyMessage}
                action={
                  mustVerify ? (
                    <Button type="link" onClick={() => void onReadLatest()}>
                      读取最新内容
                    </Button>
                  ) : undefined
                }
              />
            )}
            {laidOutCandidate === undefined ? (
              <div className={styles.emptyResult}>
                <Empty
                  description={
                    draft.pending
                      ? '正在根据你的要求起草流程…'
                      : '填写左侧要求并生成方案，候选流程会显示在这里。'
                  }
                />
              </div>
            ) : (
              <JourneyAiDraftPreview definition={laidOutCandidate} />
            )}
          </main>
        </div>
      )}
    </section>
  );
}
