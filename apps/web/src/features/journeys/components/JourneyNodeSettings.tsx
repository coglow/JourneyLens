import {
  JOURNEY_ENTRY_BEHAVIORS,
  JOURNEY_EVENT_TYPE_LABELS,
  JOURNEY_ENTRY_BEHAVIOR_VALUES,
  JOURNEY_MESSAGE_CHANNELS,
  JOURNEY_WAIT_MAX_SECONDS,
  journeyEventHasProductId,
  type JourneyEventType,
  type JourneyDraftNode,
} from '@journeylens/shared';
import { Checkbox, Divider, Flex, Input, InputNumber, Select, Typography } from 'antd';
import { JourneyConditionFields, JourneyEventFilterFields } from './JourneyConditionFields';
import { JourneyDurationInput } from './JourneyDurationInput';
import { formatWaitDuration } from '@/features/journeys/journey-wait';

type Props = {
  node: JourneyDraftNode;
  disabled: boolean;
  onChange: (node: JourneyDraftNode) => void;
  startBehavior: JourneyEventType | undefined;
  /** 共享草稿校验给出的等待时长错误；没有错误时为 undefined，调用方总是显式传入。 */
  waitSecondsError: string | undefined;
};

function NodeFields({ node, disabled, onChange, waitSecondsError, startBehavior }: Props) {
  if (node.type === 'start') {
    return (
      <>
        <Typography.Text strong>进入行为</Typography.Text>
        <Select
          aria-label="进入行为"
          value={node.entryBehavior}
          disabled={disabled}
          options={JOURNEY_ENTRY_BEHAVIORS.map(({ label, value }) => ({ label, value }))}
          onChange={(entryBehavior) => onChange({ ...node, entryBehavior })}
        />
      </>
    );
  }

  if (node.type === 'condition') {
    return (
      <>
        <Typography.Text strong>判断条件</Typography.Text>
        <JourneyConditionFields
          value={node.rules}
          disabled={disabled}
          startBehavior={startBehavior}
          onChange={(rules) => onChange({ ...node, rules })}
        />
      </>
    );
  }

  if (node.type === 'wait') {
    return (
      <>
        <Typography.Text strong>等待时长</Typography.Text>
        <JourneyDurationInput
          label="等待时长"
          seconds={node.waitSeconds}
          min={1}
          disabled={disabled}
          hasError={waitSecondsError !== undefined}
          onChange={(seconds) => onChange({ ...node, waitSeconds: seconds ?? 0 })}
        />
        {/* 出错时就地提示替换范围说明；输入值保持用户填的内容，不截断成上限。 */}
        {waitSecondsError === undefined ? (
          <Typography.Text type="secondary">
            可设置 1 秒至 {formatWaitDuration(JOURNEY_WAIT_MAX_SECONDS)}。
          </Typography.Text>
        ) : (
          <Typography.Text type="danger">{waitSecondsError}</Typography.Text>
        )}
      </>
    );
  }

  if (node.type === 'wait_for_event') {
    const canUseSameProduct =
      journeyEventHasProductId(node.eventType) &&
      (startBehavior === undefined || journeyEventHasProductId(startBehavior));
    return (
      <>
        <Typography.Text strong>等待行为</Typography.Text>
        <Select
          aria-label="等待行为类型"
          value={node.eventType}
          disabled={disabled}
          options={JOURNEY_ENTRY_BEHAVIOR_VALUES.map((value) => ({
            value,
            label: JOURNEY_EVENT_TYPE_LABELS[value],
          }))}
          onChange={(eventType: JourneyEventType) =>
            onChange({
              ...node,
              eventType,
              filter: undefined,
              sameProduct: node.sameProduct && journeyEventHasProductId(eventType),
            })
          }
        />
        <Typography.Text strong>最长等待时间（秒）</Typography.Text>
        <InputNumber
          aria-label="最长等待时间（秒）"
          min={1}
          max={JOURNEY_WAIT_MAX_SECONDS}
          precision={0}
          value={node.waitSeconds}
          status={waitSecondsError === undefined ? '' : 'error'}
          disabled={disabled}
          style={{ width: '100%' }}
          onChange={(value) => onChange({ ...node, waitSeconds: value ?? 0 })}
        />
        <JourneyEventFilterFields
          eventType={node.eventType}
          value={node.filter}
          label="等待行为筛选"
          disabled={disabled}
          onChange={(filter) =>
            onChange({ ...node, ...(filter === undefined ? { filter: undefined } : { filter }) })
          }
        />
        <Checkbox
          checked={node.sameProduct}
          disabled={disabled || (!canUseSameProduct && !node.sameProduct)}
          onChange={(event) => onChange({ ...node, sameProduct: event.target.checked })}
        >
          只等待与进入行为同一商品
        </Checkbox>
        {waitSecondsError !== undefined && (
          <Typography.Text type="danger">{waitSecondsError}</Typography.Text>
        )}
      </>
    );
  }

  if (node.type === 'message') {
    return (
      <>
        <Typography.Text strong>消息渠道</Typography.Text>
        <Select
          aria-label="消息渠道"
          value={node.channel}
          disabled={disabled}
          options={JOURNEY_MESSAGE_CHANNELS.map(({ label, value }) => ({ label, value }))}
          onChange={(channel) => {
            // 渠道切换后旧正文和主题不再适用，统一清空，避免把上一个渠道的文案带过去。
            if (channel === node.channel) return;
            onChange({ ...node, channel, subject: null, body: '' });
          }}
        />
        {node.channel === 'email' && (
          <>
            <Typography.Text strong>邮件主题</Typography.Text>
            <Input
              aria-label="邮件主题"
              maxLength={200}
              value={node.subject ?? ''}
              disabled={disabled}
              onChange={(event) => onChange({ ...node, subject: event.target.value })}
            />
          </>
        )}
        <Typography.Text strong>消息内容</Typography.Text>
        <Input.TextArea
          aria-label="消息内容"
          rows={5}
          maxLength={2_000}
          showCount
          value={node.body}
          disabled={disabled}
          onChange={(event) => onChange({ ...node, body: event.target.value })}
        />
      </>
    );
  }

  return (
    <>
      <Typography.Text strong>结束说明</Typography.Text>
      <Input.TextArea
        aria-label="结束说明"
        rows={4}
        maxLength={500}
        showCount
        value={node.note ?? ''}
        disabled={disabled}
        onChange={(event) => onChange({ ...node, note: event.target.value })}
      />
    </>
  );
}

export function JourneyNodeSettings({
  node,
  disabled,
  onChange,
  waitSecondsError,
  startBehavior,
}: Props) {
  return (
    <Flex vertical gap={12}>
      <Typography.Text strong>节点名称</Typography.Text>
      <Input
        aria-label="节点名称"
        maxLength={120}
        value={node.name}
        disabled={disabled}
        onChange={(event) => onChange({ ...node, name: event.target.value })}
      />
      <Divider style={{ marginBlock: 4 }} />
      {/* 更换步骤时按其当前时长重新选择默认单位；编辑期间保留用户选择的单位。 */}
      <NodeFields
        key={node.id}
        node={node}
        disabled={disabled}
        onChange={onChange}
        waitSecondsError={waitSecondsError}
        startBehavior={startBehavior}
      />
    </Flex>
  );
}
