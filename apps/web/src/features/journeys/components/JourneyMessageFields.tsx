import type { ComponentRef } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Flex, Input, Select, Typography } from 'antd';
import type { InputRef } from 'antd';
import {
  JOURNEY_MESSAGE_BODY_MAX_LENGTH,
  JOURNEY_MESSAGE_CHANNELS,
  JOURNEY_MESSAGE_PRODUCT_VARIABLE,
  JOURNEY_MESSAGE_SUBJECT_MAX_LENGTH,
  JOURNEY_MESSAGE_VARIABLES,
  journeyEntrySupportsProductName,
  journeyMessageFieldLabel,
  journeyMessageFieldLimit,
  type JourneyDraftNode,
  type JourneyEventType,
} from '@journeylens/shared';

type MessageNode = Extract<JourneyDraftNode, { type: 'message' }>;
type Field = 'subject' | 'body';
type Selection = { start: number; end: number };

type Props = {
  node: MessageNode;
  disabled: boolean;
  onChange: (node: JourneyDraftNode) => void;
  /** 画布恰有一个开始步骤时才有值；多个或没有开始步骤时不能使用商品变量。 */
  startBehavior: JourneyEventType | undefined;
  hasUniqueStart: boolean;
  subjectError: string | undefined;
  bodyError: string | undefined;
};

function readSelection(target: HTMLInputElement | HTMLTextAreaElement): Selection {
  return {
    start: target.selectionStart ?? target.value.length,
    end: target.selectionEnd ?? target.value.length,
  };
}

/** 消息节点的渠道、主题、正文与固定变量插入；只服务消息配置，不封装公共输入框。 */
export function JourneyMessageFields({
  node,
  disabled,
  onChange,
  startBehavior,
  hasUniqueStart,
  subjectError,
  bodyError,
}: Props) {
  const subjectRef = useRef<InputRef>(null);
  const bodyRef = useRef<ComponentRef<typeof Input.TextArea>>(null);
  const [subjectSelection, setSubjectSelection] = useState<Selection>();
  const [bodySelection, setBodySelection] = useState<Selection>();
  const [insertError, setInsertError] = useState<{ field: Field; message: string }>();

  // 切换消息节点后丢弃上一个节点的光标位置，避免插到另一个节点的错误位置。
  useEffect(() => {
    setSubjectSelection(undefined);
    setBodySelection(undefined);
    setInsertError(undefined);
  }, [node.id]);

  const productAvailable =
    hasUniqueStart && startBehavior !== undefined && journeyEntrySupportsProductName(startBehavior);
  const productDisabledReason = hasUniqueStart
    ? '当前进入行为没有商品信息'
    : '请先设置一个带商品资料的开始步骤';

  function insertVariable(field: Field, marker: string): void {
    const value = field === 'subject' ? (node.subject ?? '') : node.body;
    const selection = (field === 'subject' ? subjectSelection : bodySelection) ?? {
      start: value.length,
      end: value.length,
    };
    const nextValue = `${value.slice(0, selection.start)}${marker}${value.slice(selection.end)}`;
    const limit = journeyMessageFieldLimit(field);
    if (nextValue.length > limit) {
      setInsertError({
        field,
        message: `插入后${journeyMessageFieldLabel(field)}超过 ${limit} 字，请先精简`,
      });
      return;
    }

    setInsertError(undefined);
    if (field === 'subject') {
      onChange({ ...node, subject: nextValue });
      setSubjectSelection({
        start: selection.start + marker.length,
        end: selection.start + marker.length,
      });
    } else {
      onChange({ ...node, body: nextValue });
      setBodySelection({
        start: selection.start + marker.length,
        end: selection.start + marker.length,
      });
    }

    const caret = selection.start + marker.length;
    window.requestAnimationFrame(() => {
      if (field === 'subject') {
        subjectRef.current?.focus();
        subjectRef.current?.input?.setSelectionRange(caret, caret);
        return;
      }
      bodyRef.current?.focus();
      bodyRef.current?.resizableTextArea?.textArea.setSelectionRange(caret, caret);
    });
  }

  function variableMenu(field: Field) {
    return (
      <Dropdown
        trigger={['click']}
        disabled={disabled}
        menu={{
          items: JOURNEY_MESSAGE_VARIABLES.map((variable) => {
            const productDisabled =
              variable.marker === JOURNEY_MESSAGE_PRODUCT_VARIABLE && !productAvailable;
            return {
              key: variable.marker,
              label: productDisabled
                ? `${variable.label}（${productDisabledReason}）`
                : `${variable.label}（${variable.description}）`,
              disabled: productDisabled,
            };
          }),
          onClick: ({ key }) => insertVariable(field, key),
        }}
      >
        <Button
          size="small"
          disabled={disabled}
          aria-label={`向${journeyMessageFieldLabel(field)}插入变量`}
        >
          插入变量
        </Button>
      </Dropdown>
    );
  }

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
          setInsertError(undefined);
          onChange({ ...node, channel, subject: null, body: '' });
        }}
      />

      {node.channel === 'email' && (
        <>
          <Typography.Text strong>邮件主题</Typography.Text>
          <Flex gap={8} align="flex-start">
            <Input
              ref={subjectRef}
              aria-label="邮件主题"
              maxLength={JOURNEY_MESSAGE_SUBJECT_MAX_LENGTH}
              value={node.subject ?? ''}
              status={subjectError === undefined ? '' : 'error'}
              disabled={disabled}
              onSelect={(event) => setSubjectSelection(readSelection(event.currentTarget))}
              onClick={(event) => setSubjectSelection(readSelection(event.currentTarget))}
              onKeyUp={(event) => setSubjectSelection(readSelection(event.currentTarget))}
              onChange={(event) => {
                setInsertError(undefined);
                setSubjectSelection(readSelection(event.currentTarget));
                onChange({ ...node, subject: event.target.value });
              }}
            />
            {variableMenu('subject')}
          </Flex>
          {subjectError !== undefined && (
            <Typography.Text type="danger">{subjectError}</Typography.Text>
          )}
          {insertError?.field === 'subject' && (
            <Typography.Text type="danger">{insertError.message}</Typography.Text>
          )}
        </>
      )}

      <Typography.Text strong>消息内容</Typography.Text>
      <Input.TextArea
        ref={bodyRef}
        aria-label="消息内容"
        rows={5}
        maxLength={JOURNEY_MESSAGE_BODY_MAX_LENGTH}
        showCount
        value={node.body}
        status={bodyError === undefined ? '' : 'error'}
        disabled={disabled}
        onSelect={(event) => setBodySelection(readSelection(event.currentTarget))}
        onClick={(event) => setBodySelection(readSelection(event.currentTarget))}
        onKeyUp={(event) => setBodySelection(readSelection(event.currentTarget))}
        onChange={(event) => {
          setInsertError(undefined);
          setBodySelection(readSelection(event.currentTarget));
          onChange({ ...node, body: event.target.value });
        }}
      />
      <Flex justify="flex-end">{variableMenu('body')}</Flex>
      {insertError?.field === 'body' && (
        <Typography.Text type="danger">{insertError.message}</Typography.Text>
      )}
      {bodyError !== undefined && <Typography.Text type="danger">{bodyError}</Typography.Text>}
    </>
  );
}
