import { useState } from 'react';
import { UserOutlined } from '@ant-design/icons';
import {
  Alert,
  Avatar,
  Button,
  Collapse,
  Descriptions,
  Flex,
  message,
  App as AntApp,
  Spin,
  Typography,
} from 'antd';
import {
  AUDIENCE_FIELDS,
  JOURNEY_EVENT_TYPE_LABELS,
  audienceField,
  type JourneyDraftDefinition,
  type JourneySimulationScenario,
  type SegmentRule,
} from '@journeylens/shared';
import type { JourneySimulationController } from '@/features/journeys/hooks/useJourneySimulation';
import { formatSimulationEvent } from '@/features/journeys/simulation-display';
import { formatFieldValue } from '@/utils/format-field-value';
import { SimulationResultView } from './SimulationResultView';
import { SimulationScenarioEditor } from './SimulationScenarioEditor';
import styles from './JourneySimulationPanel.module.css';

type Props = {
  journeyId: string;
  definition: JourneyDraftDefinition;
  segmentRules: SegmentRule | null;
  simulation: JourneySimulationController;
  onLocate: (nodeId: string) => void;
};

function ScenarioSummary({
  scenario,
  onEdit,
}: {
  scenario: JourneySimulationScenario;
  onEdit: () => void;
}) {
  const userRows = [
    { label: '邮箱', value: formatFieldValue(scenario.user.email, audienceField('email')) },
    ...AUDIENCE_FIELDS.filter(
      (field) =>
        field.key !== 'displayName' &&
        field.key !== 'email' &&
        field.key in scenario.user.attributes,
    ).map((field) => ({
      label: field.label,
      value: formatFieldValue(scenario.user.attributes[field.key], field),
    })),
  ];

  return (
    <section className={styles.scenario ?? ''} aria-label="当前模拟资料">
      <Flex align="start" gap={12}>
        <Avatar icon={<UserOutlined />} className={styles.avatar ?? ''} />
        <div className={styles.scenarioOverview ?? ''}>
          <Flex justify="space-between" align="center" gap={8}>
            <Typography.Text strong className={styles.userName ?? ''}>
              {scenario.user.displayName ?? '未填写昵称'}
            </Typography.Text>
            <Button type="link" size="small" aria-label="编辑模拟资料" onClick={onEdit}>
              编辑资料
            </Button>
          </Flex>
          <Typography.Paragraph type="secondary" className={styles.meta ?? ''}>
            {JOURNEY_EVENT_TYPE_LABELS[scenario.entryEvent.type]} · 历史{' '}
            {scenario.historicalEvents.length} 条 · 后续 {scenario.scheduledEvents.length} 条
          </Typography.Paragraph>
          <Collapse
            ghost
            size="small"
            classNames={{
              header: styles.disclosureHeader ?? '',
              body: styles.disclosureBody ?? '',
            }}
            items={[
              {
                key: 'scenario',
                label: '查看完整模拟资料',
                children: (
                  <div className={styles.scenarioDetails ?? ''}>
                    <Descriptions
                      size="small"
                      column={1}
                      colon={false}
                      classNames={{
                        label: styles.detailLabel ?? '',
                        content: styles.detailValue ?? '',
                      }}
                      items={userRows.map((row) => ({
                        label: row.label,
                        key: row.label,
                        children: row.value,
                      }))}
                    />
                    {[
                      { label: '进入行为', events: [scenario.entryEvent] },
                      { label: '历史行为', events: scenario.historicalEvents },
                      { label: '后续行为', events: scenario.scheduledEvents },
                    ].map(({ label, events }) => (
                      <div key={label} className={styles.scenarioSection ?? ''}>
                        <Typography.Text type="secondary">{label}</Typography.Text>
                        {events.length === 0 ? (
                          <Typography.Text type="secondary">没有填写</Typography.Text>
                        ) : (
                          events.map((event) => (
                            <div key={event.id} className={styles.scenarioEvent ?? ''}>
                              {formatSimulationEvent(scenario, event.id)}
                            </div>
                          ))
                        )}
                      </div>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Flex>
    </section>
  );
}

/** 条件里用到的用户属性，作为编辑模拟资料时的推荐字段。 */
function suggestUserFields(
  definition: JourneyDraftDefinition,
  segmentRules: SegmentRule | null,
): string[] {
  const fields = new Set<string>(['displayName', 'email']);
  const collect = (rule: SegmentRule): void => {
    if (rule.kind === 'compare') {
      fields.add(rule.left.path);
      return;
    }
    if (rule.kind === 'not') collect(rule.child);
    else rule.children.forEach(collect);
  };

  if (segmentRules !== null) collect(segmentRules);
  for (const node of definition.nodes) {
    if (
      node.type === 'condition' &&
      node.rules.kind === 'compare' &&
      node.rules.left.source === 'user'
    ) {
      fields.add(node.rules.left.path);
    }
  }
  return [...fields];
}

export function JourneySimulationPanel({
  journeyId,
  definition,
  segmentRules,
  simulation,
  onLocate,
}: Props) {
  const { modal } = AntApp.useApp();
  const [editorOpen, setEditorOpen] = useState(false);
  const [messageApi, messageContext] = message.useMessage();
  const canStart = simulation.scenarioErrors.length === 0 && !simulation.pending;

  async function startSimulation(): Promise<void> {
    messageApi.destroy();
    const result = await simulation.start();
    // 失败或输入变化导致响应失效时没有有效结果，不显示完成提示。
    if (result !== undefined) void messageApi.success('本次模拟已完成');
  }

  function resetScenario(): void {
    modal.confirm({
      title: '重置模拟资料？',
      content: '用户资料和行为样本都会恢复为示例内容。',
      okText: '重置资料',
      cancelText: '取消',
      onOk: simulation.resetScenario,
    });
  }

  return (
    <div className={styles.panel ?? ''}>
      {messageContext}
      <header className={styles.header ?? ''}>
        <div>
          <Typography.Title level={4} className={styles.heading ?? ''}>
            旅程模拟
          </Typography.Title>
        </div>
        <Button
          type="primary"
          loading={simulation.pending}
          disabled={!canStart}
          onClick={() => void startSimulation()}
        >
          {simulation.pending ? '模拟中…' : simulation.result !== null ? '重新模拟' : '开始模拟'}
        </Button>
      </header>
      <div className={styles.body ?? ''}>
        <ScenarioSummary scenario={simulation.scenario} onEdit={() => setEditorOpen(true)} />
        {simulation.scenarioErrors.length > 0 && (
          <Alert
            type="warning"
            showIcon
            title="模拟资料有问题，请先修正。"
            action={
              <Button type="link" size="small" onClick={() => setEditorOpen(true)}>
                查看资料
              </Button>
            }
          />
        )}
        {simulation.stale && <Alert type="info" showIcon title="模拟条件已变化，请重新模拟。" />}
        {simulation.error !== undefined && <Alert type="error" showIcon title={simulation.error} />}

        {simulation.pending && simulation.result === null && (
          <Flex role="status" align="center" gap={8}>
            <Spin size="small" />
            <Typography.Text>模拟中…</Typography.Text>
          </Flex>
        )}
        {simulation.result !== null && (
          <SimulationResultView
            result={simulation.result}
            visibleStepCount={simulation.visibleStepCount}
            scenario={simulation.scenario}
            onLocate={onLocate}
          />
        )}
      </div>

      <SimulationScenarioEditor
        key={journeyId}
        open={editorOpen}
        scenario={simulation.scenario}
        setScenario={simulation.setScenario}
        errors={simulation.scenarioErrors}
        suggestedUserFields={suggestUserFields(definition, segmentRules)}
        onReset={resetScenario}
        onClose={() => setEditorOpen(false)}
      />
    </div>
  );
}
