import { useState } from 'react';
import {
  JOURNEY_ENTRY_BEHAVIORS,
  JOURNEY_MESSAGE_CHANNELS,
  JOURNEY_WAIT_MAX_SECONDS,
  type JourneyDraftNode,
} from '@journeylens/shared';
import { Divider, Flex, Input, InputNumber, Select, Typography } from 'antd';
import { RuleCompareFields } from '@/components/RuleCompareFields';
import {
  WAIT_UNITS,
  formatWaitDuration,
  waitUnitFor,
  type WaitUnit,
} from '@/features/journeys/journey-wait';

type Props = {
  node: JourneyDraftNode;
  disabled: boolean;
  onChange: (node: JourneyDraftNode) => void;
  /** 共享草稿校验给出的等待时长错误；没有错误时为 undefined，调用方总是显式传入。 */
  waitSecondsError: string | undefined;
};

function NodeFields({ node, disabled, onChange, waitSecondsError }: Props) {
  const waitSeconds = node.type === 'wait' ? node.waitSeconds : undefined;
  const [waitUnit, setWaitUnit] = useState<WaitUnit>(() =>
    waitSeconds === undefined ? 'seconds' : waitUnitFor(waitSeconds).value,
  );

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
        <RuleCompareFields
          value={node.rules}
          label="条件"
          layout="stacked"
          disabled={disabled}
          onChange={(rules) => onChange({ ...node, rules })}
        />
      </>
    );
  }

  if (node.type === 'wait') {
    const unit = WAIT_UNITS.find((item) => item.value === waitUnit)!;
    return (
      <>
        <Typography.Text strong>等待时长</Typography.Text>
        <Flex gap={8}>
          <InputNumber
            aria-label="等待时长数值"
            min={1}
            precision={0}
            status={waitSecondsError === undefined ? '' : 'error'}
            value={node.waitSeconds / unit.seconds}
            disabled={disabled}
            style={{ flex: 1 }}
            onChange={(value) => onChange({ ...node, waitSeconds: (value ?? 0) * unit.seconds })}
          />
          <Select
            aria-label="等待时长单位"
            style={{ width: 80 }}
            value={waitUnit}
            disabled={disabled}
            options={WAIT_UNITS.map(({ label, value }) => ({ label, value }))}
            onChange={(nextUnit) => {
              const next = WAIT_UNITS.find((item) => item.value === nextUnit)!;
              setWaitUnit(nextUnit);
              // 单位切换保留当前数值；超限由共享校验提示，输入框不能截断输入。
              onChange({
                ...node,
                waitSeconds: (node.waitSeconds / unit.seconds) * next.seconds,
              });
            }}
          />
        </Flex>
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

export function JourneyNodeSettings({ node, disabled, onChange, waitSecondsError }: Props) {
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
      />
    </Flex>
  );
}
