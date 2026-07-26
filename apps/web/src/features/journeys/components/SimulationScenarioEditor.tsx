import { useState, type Dispatch, type SetStateAction } from 'react';
import { InfoCircleOutlined, PlusOutlined } from '@ant-design/icons';
import {
  AUDIENCE_COLUMN_KEYS,
  AUDIENCE_FIELDS,
  AUDIENCE_FIELD_GROUPS,
  JOURNEY_ENTRY_BEHAVIOR_VALUES,
  JOURNEY_EVENT_TYPE_LABELS,
  journeyEventFields,
  type JourneyEventType,
  type JourneySimulationScenario,
} from '@journeylens/shared';
import {
  Alert,
  Button,
  Card,
  Dropdown,
  Flex,
  Modal,
  Select,
  Tabs,
  Tooltip,
  Typography,
} from 'antd';
import { SimulationFieldInput } from './SimulationFieldInput';
import styles from './SimulationScenarioEditor.module.css';
import { JourneyDurationInput } from './JourneyDurationInput';

type ScenarioEvent = {
  id: string;
  type: JourneyEventType;
  offsetSeconds: number;
  payload: JourneySimulationScenario['entryEvent']['payload'];
};

type Props = {
  open: boolean;
  scenario: JourneySimulationScenario;
  setScenario: Dispatch<SetStateAction<JourneySimulationScenario>>;
  errors: readonly string[];
  suggestedUserFields: readonly string[];
  onReset: () => void;
  onClose: () => void;
};

function createEvent(type: JourneyEventType, offsetSeconds: number): ScenarioEvent {
  return { id: `event-${crypto.randomUUID()}`, type, offsetSeconds, payload: {} };
}

type EventGroup = 'historicalEvents' | 'scheduledEvents';

/** 历史行为和后续行为共用一份列表更新逻辑，调用方只描述要变成什么。 */
function updateEvents(
  setScenario: Props['setScenario'],
  group: EventGroup,
  update: (events: ScenarioEvent[]) => ScenarioEvent[],
): void {
  setScenario((current) =>
    group === 'historicalEvents'
      ? { ...current, historicalEvents: update(current.historicalEvents) }
      : { ...current, scheduledEvents: update(current.scheduledEvents) },
  );
}

function EventEditor({
  title,
  event,
  fixedTime = false,
  beforeEntry = false,
  onChange,
  onDuplicate,
  duplicateDisabled = false,
  onRemove,
}: {
  title: string;
  event: ScenarioEvent;
  fixedTime?: boolean;
  beforeEntry?: boolean;
  onChange: (event: ScenarioEvent) => void;
  onDuplicate?: () => void;
  duplicateDisabled?: boolean;
  onRemove?: () => void;
}) {
  const fields = journeyEventFields(event.type);
  return (
    <Card
      size="small"
      title={
        <Flex justify="space-between" align="center" gap={8}>
          <span>{title}</span>
          <Typography.Text type="secondary">
            {JOURNEY_EVENT_TYPE_LABELS[event.type]}
          </Typography.Text>
        </Flex>
      }
      extra={
        <Flex gap={4}>
          {onDuplicate && (
            <Button type="link" size="small" disabled={duplicateDisabled} onClick={onDuplicate}>
              复制
            </Button>
          )}
          {onRemove && (
            <Button type="link" size="small" danger onClick={onRemove}>
              删除
            </Button>
          )}
        </Flex>
      }
    >
      <Flex vertical gap={12}>
        <div className={fixedTime ? styles.eventSettingsSingle : styles.eventSettings}>
          <Flex vertical gap={4}>
            <Typography.Text type="secondary">行为类型</Typography.Text>
            <Select
              aria-label={`${title}行为类型`}
              value={event.type}
              options={JOURNEY_ENTRY_BEHAVIOR_VALUES.map((type) => ({
                value: type,
                label: JOURNEY_EVENT_TYPE_LABELS[type],
              }))}
              onChange={(type: JourneyEventType) => onChange({ ...event, type, payload: {} })}
            />
          </Flex>
          {!fixedTime && (
            <Flex vertical gap={4}>
              <Typography.Text type="secondary">
                {beforeEntry ? '进入前的时间' : '进入后的时间'}
              </Typography.Text>
              <JourneyDurationInput
                label={`${title} ${beforeEntry ? '进入前的时间' : '进入后的时间'}`}
                seconds={Math.abs(event.offsetSeconds)}
                min={beforeEntry ? 1 : 0}
                onChange={(seconds) => {
                  if (seconds === null) return;
                  onChange({
                    ...event,
                    offsetSeconds: beforeEntry ? -Math.abs(seconds) : Math.max(0, seconds),
                  });
                }}
              />
            </Flex>
          )}
        </div>
        {fields.length !== 0 && (
          <div className={styles.eventFields}>
            {fields.map((field) => (
              <SimulationFieldInput
                key={field.key}
                field={field}
                value={event.payload[field.key]}
                onChange={(value) => {
                  const payload = { ...event.payload };
                  if (value === undefined) delete payload[field.key];
                  else {
                    payload[field.key] =
                      value as JourneySimulationScenario['entryEvent']['payload'][string];
                  }
                  onChange({ ...event, payload });
                }}
              />
            ))}
          </div>
        )}
      </Flex>
    </Card>
  );
}

/** 历史行为与后续行为的列表编辑：新增、复制、修改和删除只差初始时间和标识前缀。 */
function EventListEditor({
  group,
  eventLabel,
  beforeEntry = false,
  defaultOffsetSeconds,
  idPrefix,
  events,
  setScenario,
}: {
  group: EventGroup;
  eventLabel: string;
  beforeEntry?: boolean;
  defaultOffsetSeconds: number;
  idPrefix: string;
  events: readonly ScenarioEvent[];
  setScenario: Props['setScenario'];
}) {
  const reachedLimit = events.length >= 100;
  return (
    <Flex vertical gap={12}>
      {events.map((event, index) => (
        <EventEditor
          key={event.id}
          title={`${eventLabel} ${index + 1}`}
          event={event}
          beforeEntry={beforeEntry}
          duplicateDisabled={reachedLimit}
          onChange={(next) =>
            updateEvents(setScenario, group, (list) =>
              list.map((item, itemIndex) => (itemIndex === index ? next : item)),
            )
          }
          onDuplicate={() =>
            updateEvents(setScenario, group, (list) => [
              ...list,
              { ...event, id: `${idPrefix}-${crypto.randomUUID()}` },
            ])
          }
          onRemove={() =>
            updateEvents(setScenario, group, (list) =>
              list.filter((_, itemIndex) => itemIndex !== index),
            )
          }
        />
      ))}
      <Button
        disabled={reachedLimit}
        onClick={() =>
          updateEvents(setScenario, group, (list) => [
            ...list,
            createEvent('purchase_completed', defaultOffsetSeconds),
          ])
        }
      >
        添加{eventLabel}
      </Button>
    </Flex>
  );
}

export function SimulationScenarioEditor({
  open,
  scenario,
  setScenario,
  errors,
  suggestedUserFields,
  onReset,
  onClose,
}: Props) {
  // 字段是否显示与是否已填写分开，新增、清除或恢复填写都不写入假数据。
  const [addedUserFields, setAddedUserFields] = useState<string[]>([]);
  const currentAttributeKeys = Object.keys(scenario.user.attributes);
  const visibleUserFields = [
    ...new Set([
      'displayName',
      'email',
      ...suggestedUserFields,
      ...currentAttributeKeys,
      ...addedUserFields,
    ]),
  ]
    .map((key) => AUDIENCE_FIELDS.find((field) => field.key === key))
    .filter((field) => field !== undefined);
  const addableFields = AUDIENCE_FIELDS.filter(
    (field) =>
      !(AUDIENCE_COLUMN_KEYS as readonly string[]).includes(field.key) &&
      !visibleUserFields.some((visible) => visible.key === field.key),
  );

  function setUserField(fieldKey: string, value: unknown): void {
    if (value === undefined) {
      setAddedUserFields((current) => [...new Set([...current, fieldKey])]);
    }
    setScenario((current) => {
      if (fieldKey === 'displayName' || fieldKey === 'email') {
        return {
          ...current,
          user: { ...current.user, [fieldKey]: value === undefined ? null : value },
        };
      }
      const attributes = { ...current.user.attributes };
      if (value === undefined) delete attributes[fieldKey];
      else {
        attributes[fieldKey] = value as JourneySimulationScenario['user']['attributes'][string];
      }
      return { ...current, user: { ...current.user, attributes } };
    });
  }

  const entryEvent: ScenarioEvent = scenario.entryEvent;

  return (
    <Modal
      title={<span className={styles.editorTitle}>编辑模拟资料</span>}
      open={open}
      centered
      width={800}
      styles={{
        body: { maxHeight: '65vh', overflowY: 'auto', paddingBlock: 16 },
        footer: {
          borderTop: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
          paddingTop: 16,
          marginTop: 0,
        },
      }}
      destroyOnHidden={false}
      onCancel={onClose}
      footer={
        <Flex justify="space-between" align="center" gap={12} wrap>
          <Typography.Text type="secondary" className={styles.footerNote ?? ''}>
            刷新或离开当前旅程后清空
          </Typography.Text>
          <Flex gap={12}>
            <Button type="text" onClick={onReset}>
              重置示例资料
            </Button>
            <Button type="primary" onClick={onClose}>
              完成
            </Button>
          </Flex>
        </Flex>
      }
    >
      <Flex vertical gap={12}>
        <Flex align="center" gap={4}>
          <Typography.Text type="secondary">
            手动填写或使用示例资料，不会修改真实资料
          </Typography.Text>
          <Tooltip title="空白表示未提供；可通过字段右侧的更多操作设为空值或空列表。昵称和邮箱未填写时按空值处理。资料只在当前旅程页面保留，刷新后清空。">
            <Button
              type="text"
              size="small"
              icon={<InfoCircleOutlined aria-hidden />}
              aria-label="模拟资料说明"
            />
          </Tooltip>
        </Flex>
        {errors.length > 0 && (
          <Alert
            type="error"
            showIcon
            title="请检查模拟资料"
            description={
              <ul>
                {errors.map((error, index) => (
                  <li key={`${error}-${index}`}>{error}</li>
                ))}
              </ul>
            }
          />
        )}
        <Tabs
          items={[
            {
              key: 'user',
              label: '用户资料',
              children: (
                <Flex vertical gap={20}>
                  <div className={styles.userFields}>
                    {visibleUserFields.map((field) => (
                      <SimulationFieldInput
                        key={field.key}
                        field={field}
                        value={
                          field.key === 'displayName'
                            ? scenario.user.displayName
                            : field.key === 'email'
                              ? scenario.user.email
                              : scenario.user.attributes[field.key]
                        }
                        onChange={(value) => setUserField(field.key, value)}
                      />
                    ))}
                  </div>
                  <div>
                    <Dropdown
                      trigger={['click']}
                      autoFocus
                      menu={{
                        items: AUDIENCE_FIELD_GROUPS.map((group) => ({
                          type: 'group' as const,
                          key: group,
                          label: group,
                          children: addableFields
                            .filter((field) => field.group === group)
                            .map((field) => ({ label: field.label, key: field.key })),
                        })).filter((group) => group.children.length > 0),
                        onClick: ({ key }) => setAddedUserFields((current) => [...current, key]),
                      }}
                    >
                      <Button
                        type="dashed"
                        icon={<PlusOutlined aria-hidden />}
                        disabled={addableFields.length === 0}
                      >
                        添加用户属性
                      </Button>
                    </Dropdown>
                  </div>
                </Flex>
              ),
            },
            {
              key: 'entry',
              label: '进入行为',
              children: (
                <EventEditor
                  title="进入时"
                  event={entryEvent}
                  fixedTime
                  onChange={(event) =>
                    setScenario((current) => ({
                      ...current,
                      entryEvent: { ...event, offsetSeconds: 0 },
                    }))
                  }
                />
              ),
            },
            {
              key: 'history',
              label: `历史行为（${scenario.historicalEvents.length}）`,
              children: (
                <EventListEditor
                  group="historicalEvents"
                  eventLabel="历史行为"
                  beforeEntry
                  defaultOffsetSeconds={-24 * 60 * 60}
                  idPrefix="history"
                  events={scenario.historicalEvents}
                  setScenario={setScenario}
                />
              ),
            },
            {
              key: 'scheduled',
              label: `后续行为（${scenario.scheduledEvents.length}）`,
              children: (
                <EventListEditor
                  group="scheduledEvents"
                  eventLabel="后续行为"
                  defaultOffsetSeconds={24 * 60 * 60}
                  idPrefix="scheduled"
                  events={scenario.scheduledEvents}
                  setScenario={setScenario}
                />
              ),
            },
          ]}
        />
      </Flex>
    </Modal>
  );
}
