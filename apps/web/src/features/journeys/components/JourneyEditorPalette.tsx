import { QuestionCircleOutlined, RobotOutlined } from '@ant-design/icons';
import { Button, Flex, Popover, Tooltip, Typography } from 'antd';
import type { JourneyNodeType } from '@journeylens/shared';
import { journeyNodeOptions } from '@/features/journeys/journey-node-options';
import styles from './JourneyDraftEditor.module.css';

type Props = {
  canEdit: boolean;
  nodeLimitReached: boolean;
  hasStart: boolean;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  aiDraftBlockReason: string | undefined;
  onOpenAiDraft: () => void;
  onAddNode: (type: JourneyNodeType) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onDelete: () => void;
};

/** 步骤入口与编辑按钮只展示可用状态，实际操作交由页面协调。 */
export function JourneyEditorPalette({
  canEdit,
  nodeLimitReached,
  hasStart,
  hasSelection,
  canUndo,
  canRedo,
  aiDraftBlockReason,
  onOpenAiDraft,
  onAddNode,
  onUndo,
  onRedo,
  onCopy,
  onDelete,
}: Props) {
  return (
    <aside className={styles.palette} aria-label="添加步骤">
      <div className={styles.aiDraftEntry}>
        <Tooltip title={aiDraftBlockReason} placement="right">
          <span className={styles.disabledButtonTrigger ?? ''}>
            <Button
              type="primary"
              block
              icon={<RobotOutlined />}
              disabled={!canEdit || aiDraftBlockReason !== undefined}
              onClick={onOpenAiDraft}
            >
              AI 生成旅程
            </Button>
          </span>
        </Tooltip>
      </div>
      <Typography.Title level={4} className={styles.panelTitle ?? ''}>
        手动添加步骤
      </Typography.Title>
      <Flex vertical className={styles.paletteList}>
        {journeyNodeOptions.map((option) => {
          const startAlreadyAdded = option.value === 'start' && hasStart;
          const button = (
            <Button
              key={option.value}
              type="text"
              block
              aria-label={`添加${option.label}`}
              className={`${styles.paletteItem ?? ''} ${styles[`tone_${option.value}`] ?? ''}`}
              disabled={!canEdit || nodeLimitReached || startAlreadyAdded}
              title={
                !canEdit ? '当前旅程只能查看' : nodeLimitReached ? '步骤数量已达上限' : undefined
              }
              onClick={() => onAddNode(option.value)}
            >
              <span className={styles.paletteIcon}>{option.icon}</span>
              <span className={styles.paletteText}>
                <Typography.Text strong>{option.label}</Typography.Text>
                <Typography.Text type="secondary">{option.description}</Typography.Text>
              </span>
              {startAlreadyAdded && <span className={styles.addedLabel}>已添加</span>}
            </Button>
          );

          return startAlreadyAdded ? (
            <Tooltip
              key={option.value}
              title="这条旅程已经有开始步骤，不能重复添加。"
              placement="right"
            >
              <span className={styles.disabledButtonTrigger ?? ''}>{button}</span>
            </Tooltip>
          ) : (
            button
          );
        })}
      </Flex>
      <div className={styles.paletteActions}>
        <Flex align="center" gap={4}>
          <Typography.Text strong>快捷操作</Typography.Text>
          <Popover
            placement="right"
            trigger={['hover', 'focus']}
            title="查看快捷键"
            content={
              <div className={styles.keyboardHint}>
                <div>Ctrl / ⌘ + Z：撤销</div>
                <div>Ctrl / ⌘ + Shift + Z：重做</div>
                <div>Ctrl / ⌘ + C / V：复制、粘贴</div>
                <div>Delete：删除；输入框内不生效。</div>
                <div>从节点的连接点拖到空白处，选择下一步。</div>
              </div>
            }
          >
            <Button
              type="text"
              size="small"
              aria-label="查看快捷键"
              icon={<QuestionCircleOutlined />}
            />
          </Popover>
        </Flex>
        <div className={styles.editActionRow}>
          <Button
            autoInsertSpace={false}
            aria-label="撤销"
            disabled={!canEdit || !canUndo}
            onClick={onUndo}
          >
            撤销
          </Button>
          <Button
            autoInsertSpace={false}
            aria-label="重做"
            disabled={!canEdit || !canRedo}
            onClick={onRedo}
          >
            重做
          </Button>
          <Button
            autoInsertSpace={false}
            aria-label="复制"
            disabled={!canEdit || !hasSelection}
            onClick={onCopy}
          >
            复制
          </Button>
          <Button
            autoInsertSpace={false}
            aria-label="删除"
            disabled={!canEdit || !hasSelection}
            onClick={onDelete}
          >
            删除
          </Button>
        </div>
        {!canEdit && (
          <Typography.Text type="secondary" className={styles.keyboardHint ?? ''}>
            只读：可以查看画布、步骤设置和旅程模拟，不能复制、粘贴或修改。
          </Typography.Text>
        )}
      </div>
    </aside>
  );
}
