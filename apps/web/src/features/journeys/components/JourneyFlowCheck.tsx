import { ExclamationCircleOutlined } from '@ant-design/icons';
import { Button, Typography } from 'antd';
import type { JourneyDraftWarning } from '@journeylens/shared';
import type { DraftIssue } from '@/features/journeys/journey-canvas';
import styles from './JourneyDraftEditor.module.css';

// 面板只按条展示，不区分出错字段，因此不需要草稿里的字段路径。
type FlowCheckItem = Omit<DraftIssue, 'path'> & {
  severity: 'error' | 'warning';
  source: 'validation' | 'canvas' | 'save';
};

type Props = {
  issues: readonly DraftIssue[];
  warnings: readonly JourneyDraftWarning[];
  canvasErrors: readonly string[];
  saveError: string | undefined;
  conflict: boolean;
  onClearErrors: () => void;
  onSelectNode: (nodeId: string) => void;
  onReadLatest: () => void;
};

/** 配置问题与操作提示统一展示，节点定位和冲突恢复由页面提供。 */
export function JourneyFlowCheck({
  issues,
  warnings,
  canvasErrors,
  saveError,
  conflict,
  onClearErrors,
  onSelectNode,
  onReadLatest,
}: Props) {
  const flowCheckItems: FlowCheckItem[] = [
    ...issues.map((issue) => ({
      ...issue,
      severity: 'error' as const,
      source: 'validation' as const,
    })),
    ...warnings.map((warning, index) => ({
      message: warning.message,
      ...(warning.nodeIds[0] === undefined ? {} : { nodeId: warning.nodeIds[0] }),
      key: `warning-${warning.code}-${warning.nodeIds.join('-')}-${index}`,
      severity: 'warning' as const,
      source: 'validation' as const,
    })),
    ...canvasErrors.map((message, canvasErrorIndex) => ({
      message,
      key: `canvas-${canvasErrorIndex}`,
      severity: 'error' as const,
      source: 'canvas' as const,
    })),
    ...(saveError === undefined
      ? []
      : [
          {
            message: saveError,
            key: 'save-error',
            severity: 'error' as const,
            source: 'save' as const,
          },
        ]),
  ];
  const flowCheckCount = issues.length + warnings.length;
  if (flowCheckItems.length === 0) return null;
  return (
    <section
      className={styles.flowCheckPanel}
      aria-label={flowCheckCount > 0 ? '流程检查' : '操作提示'}
      aria-live="polite"
    >
      <div className={styles.flowCheckCard}>
        <header className={styles.flowCheckHeader}>
          <div className={styles.flowCheckTitle}>
            <Typography.Text strong>{flowCheckCount > 0 ? '流程检查' : '操作提示'}</Typography.Text>
            {flowCheckCount > 0 && (
              <span
                className={`${styles.flowCheckCount ?? ''} ${
                  issues.length > 0
                    ? (styles.flowCheckCountError ?? '')
                    : (styles.flowCheckCountWarning ?? '')
                }`}
              >
                {flowCheckCount} 个问题
              </span>
            )}
          </div>
          {canvasErrors.length > 0 && (
            <Button type="link" size="small" onClick={onClearErrors}>
              清除画布提示
            </Button>
          )}
        </header>
        <div className={styles.flowCheckList}>
          {flowCheckItems.map((item) => (
            <div
              key={item.key}
              className={`${styles.flowCheckRow ?? ''} ${
                item.severity === 'error'
                  ? (styles.flowCheckError ?? '')
                  : (styles.flowCheckWarning ?? '')
              }`}
            >
              <ExclamationCircleOutlined aria-hidden="true" />
              <div className={styles.flowCheckBody}>
                <Typography.Text className={styles.flowCheckMessage ?? ''}>
                  {item.message}
                </Typography.Text>
                {item.source === 'validation' && item.nodeId ? (
                  <Button type="link" size="small" onClick={() => onSelectNode(item.nodeId!)}>
                    定位
                  </Button>
                ) : item.source === 'save' && conflict ? (
                  <Button type="link" size="small" onClick={onReadLatest}>
                    读取最新内容
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
