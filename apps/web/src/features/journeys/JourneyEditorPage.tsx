import { useColorMode } from '@/app/ThemeProvider';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  ExperimentOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Dropdown,
  Drawer,
  Empty,
  Flex,
  Popconfirm,
  Segmented,
  Spin,
  Tabs,
  Tooltip,
  Typography,
} from 'antd';
import {
  JOURNEY_BRANCH_LABELS,
  JOURNEY_LAYOUT_DIRECTIONS,
  JOURNEY_NODE_LIMIT,
  canEditCampaign,
  type JourneyBranch,
  type JourneyLayoutDirection,
  type JourneyNodeType,
} from '@journeylens/shared';
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  type Edge,
  type EdgeTypes,
  type NodeTypes,
  type OnConnectEnd,
} from '@xyflow/react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { campaignStatusLabels } from '@/features/campaigns/campaign-status';
import {
  JourneyCanvasNode,
  type JourneyCanvasFlowNode,
} from '@/features/journeys/components/JourneyCanvasNode';
import { JourneyNodeSettings } from '@/features/journeys/components/JourneyNodeSettings';
import { JourneyEdge } from '@/features/journeys/components/JourneyEdge';
import { JourneyAiDraftPage } from './JourneyAiDraftPage';
import { useJourneyAiDraft } from '@/features/journeys/hooks/useJourneyAiDraft';
import { useJourneyEditorNavigation } from '@/features/journeys/hooks/useJourneyEditorNavigation';
import { JourneyEditorPalette } from '@/features/journeys/components/JourneyEditorPalette';
import { JourneyFlowCheck } from '@/features/journeys/components/JourneyFlowCheck';
import { JourneyPublishDialog } from '@/features/journeys/components/JourneyPublishDialog';
import { JourneySimulationPanel } from '@/features/journeys/components/JourneySimulationPanel';
import { getSimulationHighlights } from './simulation-display';
import { journeyBranchFromHandle } from '@/features/journeys/journey-canvas';
import { journeyNodeOptions } from '@/features/journeys/journey-node-options';
import { fitViewOptions, useJourneyCanvas } from '@/features/journeys/hooks/useJourneyCanvas';
import { useJourneyDraftPersistence } from '@/features/journeys/hooks/useJourneyDraftPersistence';
import { useJourneySimulation } from '@/features/journeys/hooks/useJourneySimulation';
import styles from '@/features/journeys/components/JourneyDraftEditor.module.css';
import { readReturnTo } from '@/utils/return-to';

const nodeTypes: NodeTypes = { journey: JourneyCanvasNode };
const edgeTypes: EdgeTypes = { journey: JourneyEdge };
const defaultEdgeOptions = { type: 'journey' as const, interactionWidth: 18 };
const flowAriaLabels = {
  'node.a11yDescription.default':
    '按 Enter 或空格选中节点，方向键移动节点，按 Delete 删除，可撤销。',
  'node.a11yDescription.keyboardDisabled':
    '按 Enter 或空格选中节点，方向键移动节点，按 Delete 删除，可撤销。',
  'edge.a11yDescription.default': '按 Enter 或空格选中连线，按 Delete 删除，可撤销。',
  'controls.ariaLabel': '画布控制',
  'controls.zoomIn.ariaLabel': '放大画布',
  'controls.zoomOut.ariaLabel': '缩小画布',
  'controls.fitView.ariaLabel': '适配可见内容',
  'handle.ariaLabel': '连线位置',
};

type QuickAddState = {
  sourceId: string;
  branch?: JourneyBranch;
  clientPosition: { x: number; y: number };
  anchor: { x: number; y: number };
};

// 与样式表的 1250px 断点一致；全局门槛负责拦截小于 768px 的窗口。
const COMPACT_QUERY = '(max-width: 1250px)';
function subscribeCompact(onChange: () => void) {
  const media = window.matchMedia(COMPACT_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
function getCompact() {
  return window.matchMedia(COMPACT_QUERY).matches;
}

export function JourneyEditorPage() {
  const { mode } = useColorMode();
  const { id = '', view = 'editor' } = useParams();
  const simulationPage = view === 'simulation';
  const aiDraftPage = view === 'ai-draft';
  const location = useLocation();
  const navigate = useNavigate();
  const compact = useSyncExternalStore(subscribeCompact, getCompact);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // 专注只改变工作区布局，退出时恢复右栏原先的收起状态，不改动草稿和观看位置。
  const [focused, setFocused] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);

  const canvas = useJourneyCanvas();
  const draft = useJourneyDraftPersistence({
    id,
    definition: canvas.currentDefinition,
    parsedDefinition: canvas.parsedDefinition,
    dragging: canvas.dragging,
    // 起草页与编排共用原画布，起草期间暂停自动保存。
    paused: aiDraftPage,
    onAcceptDefinition: canvas.resetDefinition,
  });
  const { clearSaveError } = draft;
  const {
    nodes,
    edges,
    layoutDirection,
    selectedNode,
    selectedEdge,
    selectedNodeIds,
    selectedEdgeIds,
    canUndo,
    canRedo,
    currentDefinition,
    parsedDefinition,
    warnings,
    canvasElement,
    flowInstance,
    nodeSettingsHeading,
    onNodesChange,
    onEdgesChange,
    onSelectionChange,
    undo: undoCanvas,
    redo: redoCanvas,
    copySelection,
    pasteSelection,
    hasClipboard,
  } = canvas;
  const {
    query,
    journey,
    initializedId,
    dirty,
    canEdit,
    conflict,
    mustVerify,
    serverReadOnly,
    journeyMissing,
    saveError,
    saveStatus,
    saving,
    notFound,
    loadError,
    readLatestAfterConfirm,
  } = draft;
  // 商品变量来源问题要优先展示具体原因，其他未完成流程仍用原提示。
  const productWarning = warnings.find((warning) => warning.code === 'message-product-unavailable');
  const simulation = useJourneySimulation({
    journeyId: id,
    active: simulationPage,
    definition: currentDefinition,
    normalizedDefinition: parsedDefinition.success ? parsedDefinition.data : null,
    warnings,
  });

  // 起草入口只需要可写且没有在途保存或冲突；未保存修改和暂不合法的旧图都可以继续起草。
  function getAiDraftBlockReason(): string | undefined {
    if (journey === undefined || initializedId !== id) return '正在读取旅程，请稍后再试';
    if (journeyMissing) return '旅程已不存在，无法起草';
    if (serverReadOnly || !canEditCampaign(journey.campaign.status))
      return '当前活动已不能编辑，无法起草';
    if (saving) return '正在保存，请稍后再起草';
    if (conflict) return '旅程已在其他页面修改，请先读取最新内容';
    return undefined;
  }

  // 发布只针对已保存且可写的内容：先看旅程当前状态，再看本地编辑状态，最后看流程检查。
  function getPublishBlockReason(): string | undefined {
    if (journey === undefined || initializedId !== id) return '正在读取旅程，请稍后再试';
    if (journeyMissing) return '旅程已不存在，无法发布';
    if (serverReadOnly) return '当前活动已不能编辑，无法发布';
    if (saving) return '正在保存，请稍后再试';
    if (conflict) return '旅程已在其他页面修改，请先读取最新内容';
    if (mustVerify) return '上次保存结果尚未确认，请先读取最新内容';
    if (dirty) return '请先保存当前修改';
    if (journey.draftDefinition === null) return '请先保存编排';
    if (!parsedDefinition.success) return '请先修正步骤设置';
    if (productWarning !== undefined) return productWarning.message;
    if (warnings.length > 0) return '请先补齐流程连接并修正步骤设置';
    return undefined;
  }
  const simulationResult = simulation.result;
  const highlights = useMemo(
    () => getSimulationHighlights(simulationResult, simulation.visibleStepCount),
    [simulationResult, simulation.visibleStepCount],
  );
  const displayNodes = useMemo(() => {
    if (simulationResult === null) return nodes;
    return nodes.map((node) =>
      highlights.nodeIds.has(node.id)
        ? { ...node, data: { ...node.data, simulationState: 'traversed' as const } }
        : node,
    );
  }, [nodes, simulationResult, highlights]);
  const displayEdges = useMemo(() => {
    if (simulationResult === null) return edges;
    return edges.map((edge) =>
      highlights.edgeIds.has(edge.id) ? { ...edge, className: styles.simulationEdge ?? '' } : edge,
    );
  }, [edges, simulationResult, highlights]);

  const currentStatus = journey ? campaignStatusLabels[journey.campaign.status] : undefined;
  const hasSelection = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0;

  // 等待时长的错误只由共享草稿校验产生；取出当前节点该字段的一条，交给设置面板就地提示。
  const waitSecondsError =
    selectedNode !== undefined &&
    (selectedNode.data.draftNode.type === 'wait' ||
      selectedNode.data.draftNode.type === 'wait_for_event')
      ? canvas.issues.find(
          (issue) => issue.nodeId === selectedNode.id && issue.path.at(-1) === 'waitSeconds',
        )?.message
      : undefined;
  // 条件统计时间窗口的错误同理由共享草稿校验产生，就地提示与等待时长保持一致。
  const windowSecondsError =
    selectedNode?.data.draftNode.type === 'condition'
      ? canvas.issues.find(
          (issue) => issue.nodeId === selectedNode.id && issue.path.at(-1) === 'windowSeconds',
        )?.message
      : undefined;
  const startNodes = canvas.currentDefinition.nodes.filter((node) => node.type === 'start');
  const startBehavior = startNodes[0]?.entryBehavior;
  const hasUniqueStart = startNodes.length === 1;
  // 消息变量错误按字段取出，交给设置面板就地提示；保存禁用仍由共享校验统一决定。
  const messageSubjectError =
    selectedNode?.data.draftNode.type === 'message'
      ? canvas.issues.find(
          (issue) => issue.nodeId === selectedNode.id && issue.path.at(-1) === 'subject',
        )?.message
      : undefined;
  const messageBodyError =
    selectedNode?.data.draftNode.type === 'message'
      ? canvas.issues.find(
          (issue) => issue.nodeId === selectedNode.id && issue.path.at(-1) === 'body',
        )?.message
      : undefined;
  const initialEntryBehavior = hasUniqueStart ? startNodes[0]?.entryBehavior : undefined;
  const aiDraft = useJourneyAiDraft({
    journeyId: id,
    initialEntryBehavior,
    onApply: draft.applyDraft,
  });
  const aiDraftRef = useRef(aiDraft);
  aiDraftRef.current = aiDraft;
  const initialBehaviorRef = useRef(initialEntryBehavior);
  initialBehaviorRef.current = initialEntryBehavior;
  // 切换同一旅程的页面不卸载编辑器；只在进入起草时建立新输入，离开后清除候选。
  useEffect(() => {
    if (aiDraftPage && initializedId === id) aiDraftRef.current.start(initialBehaviorRef.current);
    else aiDraftRef.current.clear();
  }, [id, aiDraftPage, initializedId]);
  useJourneyEditorNavigation({ id, dirty, saving, mustVerify, aiDraftPage, aiDraft });

  const simulationBlockReason = !parsedDefinition.success
    ? (canvas.issues[0]?.message ?? '旅程设置有问题，请先修正。')
    : (productWarning?.message ?? warnings[0]?.message);
  const showSimulationPage =
    simulationPage && (initializedId !== id || simulationBlockReason === undefined);
  const inspectorInDrawer = showSimulationPage || compact || focused;

  useEffect(() => {
    const element = canvasElement.current;
    if (!element) return;
    let previous: DOMRectReadOnly | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      if (previous?.width === width && previous.height === height) return;
      const shrunk = previous && (width < previous.width || height < previous.height);
      previous = entry!.contentRect;
      clearTimeout(timer);
      if (shrunk) {
        timer = setTimeout(() => {
          void flowInstance.current?.fitView(fitViewOptions);
        }, 150);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    // 数据载入和起草/模拟切换会挂载或移除画布，需要重新绑定实际容器。
    // 收放侧栏时重新开始测量，首次尺寸不触发整图缩放；窗口继续缩小时沿用自动适配。
  }, [
    initializedId,
    aiDraftPage,
    showSimulationPage,
    canvasElement,
    flowInstance,
    focused,
    inspectorCollapsed,
    compact,
  ]);

  useEffect(() => {
    if (simulationPage && initializedId === id && simulationBlockReason !== undefined) {
      navigate(`/journeys/${id}/editor`, { replace: true, state: location.state });
    }
  }, [id, initializedId, location.state, navigate, simulationBlockReason, simulationPage]);

  // 编辑入口统一检查只读状态；只有操作确实生效后才清除上一次保存反馈。
  function edit(action: () => boolean): void {
    if (canEdit && !showSimulationPage && action()) draft.clearSaveError();
  }

  // 使用抽屉时保留右栏原先的收起状态，只有普通布局才展开侧栏。
  function openInspector(): void {
    if (inspectorInDrawer) setInspectorOpen(true);
    else setInspectorCollapsed(false);
  }

  /** 模拟结果在当前画布定位；编辑页的问题定位仍聚焦对应步骤设置。 */
  function locateNode(nodeId: string): void {
    canvas.selectNodeForIssue(nodeId, !showSimulationPage);
    if (!showSimulationPage) openInspector();
  }

  function openSimulation(): void {
    navigate(`/journeys/${id}/simulation`, { state: location.state });
  }

  /** 优先回到来源页，保留其筛选与页码；直接从链接打开时按旅程归属回到活动。 */
  function goBack(): void {
    const returnTo = readReturnTo(location.state);
    if (returnTo !== undefined) {
      navigate(returnTo.path, { state: returnTo.state });
      return;
    }
    navigate(journey ? `/campaigns/${journey.campaign.id}` : '/campaigns');
  }

  function handleCanvasKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (aiDraftPage) return;
    const target = event.target;
    if (
      inspectorInDrawer &&
      (event.key === 'Enter' || event.key === ' ') &&
      target instanceof Element &&
      target.closest('.react-flow__node, .react-flow__edge')
    )
      openInspector();
    if (showSimulationPage) return;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
    )
      return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && hasSelection) {
      event.preventDefault();
      edit(() => canvas.deleteSelected());
    }
  }

  useEffect(() => {
    function handleCanvasShortcut(event: KeyboardEvent): void {
      if (showSimulationPage || aiDraftPage) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (!['z', 'y', 'c', 'v'].includes(key)) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
      )
        return;
      if (
        document.querySelector('[role="dialog"]') ||
        (target instanceof Element && target.closest('.ant-modal-root'))
      )
        return;

      // 只读时不接管复制、粘贴、撤销和重做，交回浏览器默认行为。
      if (!canEdit) return;

      if (key === 'c') {
        if (!hasSelection || window.getSelection()?.toString()) return;
        event.preventDefault();
        copySelection();
        return;
      }
      if (key === 'v') {
        if (!hasClipboard()) return;
        event.preventDefault();
        if (pasteSelection()) clearSaveError();
        return;
      }

      event.preventDefault();
      const changed = key === 'y' || event.shiftKey ? redoCanvas() : undoCanvas();
      if (changed) clearSaveError();
    }

    // 模拟页只读，关闭编辑快捷键；编排页的快捷键仍与节点焦点无关。
    window.addEventListener('keydown', handleCanvasShortcut);
    return () => window.removeEventListener('keydown', handleCanvasShortcut);
  }, [
    canEdit,
    clearSaveError,
    copySelection,
    hasClipboard,
    hasSelection,
    pasteSelection,
    redoCanvas,
    undoCanvas,
    showSimulationPage,
    aiDraftPage,
  ]);

  function handleConnectEnd(
    event: Parameters<OnConnectEnd>[0],
    connection: Parameters<OnConnectEnd>[1],
  ): void {
    if (showSimulationPage || !canEdit || !connection.fromNode || !connection.fromHandle) return;
    if (connection.fromHandle.type !== 'source' || connection.toNode || connection.toHandle) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    const canvasRect = canvas.canvasElement.current?.getBoundingClientRect();
    const clientPosition =
      'clientX' in event
        ? { x: event.clientX, y: event.clientY }
        : (() => {
            const touch = event.changedTouches[0] ?? event.touches[0];
            return touch ? { x: touch.clientX, y: touch.clientY } : undefined;
          })();
    if (
      !canvasRect ||
      !clientPosition ||
      clientPosition.x < canvasRect.left ||
      clientPosition.x > canvasRect.right ||
      clientPosition.y < canvasRect.top ||
      clientPosition.y > canvasRect.bottom ||
      // 只有落在画布空白处才算新增下一步；节点、连线和工具栏都不算。
      !target.closest('.react-flow__pane') ||
      target.closest('.react-flow__node, .react-flow__edge')
    ) {
      return;
    }

    const sourceId = connection.fromNode.id;
    const source = nodes.find((node) => node.id === sourceId);
    if (!source || source.data.draftNode.type === 'end') return;
    const handleId = connection.fromHandle.id;
    const branch = journeyBranchFromHandle(source.data.draftNode.type, handleId);
    if (!canvas.canQuickAddFrom(sourceId, branch)) return;

    setQuickAdd({
      sourceId,
      ...(branch === undefined ? {} : { branch }),
      clientPosition,
      // 菜单挂在指针位置，超出视口时由下拉层自己调整方向。
      anchor: { x: clientPosition.x - canvasRect.left, y: clientPosition.y - canvasRect.top },
    });
  }

  function restoreQuickAddSourceFocus(sourceId: string): void {
    window.requestAnimationFrame(() => {
      canvas.canvasElement.current
        ?.querySelector<HTMLElement>(`[data-testid="rf__node-${sourceId}"]`)
        ?.focus();
    });
  }

  if (aiDraftPage && initializedId === id && journey !== undefined) {
    return (
      <JourneyAiDraftPage
        draft={aiDraft}
        journeyName={journey.name}
        segmentName={journey.segment?.name ?? null}
        layoutDirection={layoutDirection}
        hasExistingFlow={nodes.length > 0}
        unsavedChanges={dirty}
        mustVerify={mustVerify}
        saveError={saveError}
        blockReason={getAiDraftBlockReason()}
        onReturn={() => navigate(`/journeys/${id}/editor`, { state: location.state })}
        onReadLatest={async () => {
          if (await readLatestAfterConfirm()) aiDraft.clear();
        }}
      />
    );
  }

  const settingsPanel = (
    <aside className={styles.inspector} aria-label="步骤设置">
      <Tabs
        className={styles.inspectorTabs ?? ''}
        activeKey="settings"
        tabBarExtraContent={
          !inspectorInDrawer && (
            <Button
              type="text"
              size="small"
              aria-label="收起步骤设置"
              icon={<MenuFoldOutlined />}
              onClick={() => setInspectorCollapsed(true)}
            />
          )
        }
        items={[
          {
            key: 'settings',
            label: '步骤设置',
            children: (
              <div className={styles.settingsPane}>
                <div ref={nodeSettingsHeading} tabIndex={-1} className={styles.settingsHeading}>
                  {selectedNode ? (
                    <JourneyNodeSettings
                      node={selectedNode.data.draftNode}
                      disabled={!canEdit || showSimulationPage}
                      waitSecondsError={waitSecondsError}
                      windowSecondsError={windowSecondsError}
                      startBehavior={startBehavior}
                      hasUniqueStart={hasUniqueStart}
                      messageSubjectError={messageSubjectError}
                      messageBodyError={messageBodyError}
                      onChange={(node) => edit(() => canvas.updateNode(node))}
                    />
                  ) : selectedEdge ? (
                    <Flex vertical gap={12}>
                      <Typography.Text>
                        {nodes.find((node) => node.id === selectedEdge.source)?.data.draftNode
                          .name ?? '未知步骤'}
                        {' → '}
                        {nodes.find((node) => node.id === selectedEdge.target)?.data.draftNode
                          .name ?? '未知步骤'}
                      </Typography.Text>
                      {selectedEdge.sourceHandle === 'met' ||
                      selectedEdge.sourceHandle === 'unmet' ||
                      selectedEdge.sourceHandle === 'matched' ||
                      selectedEdge.sourceHandle === 'timeout' ? (
                        <Typography.Text>
                          路径：{JOURNEY_BRANCH_LABELS[selectedEdge.sourceHandle]}
                        </Typography.Text>
                      ) : null}
                      <Button
                        danger
                        disabled={!canEdit}
                        onClick={() => edit(() => canvas.deleteSelected([], [selectedEdge.id]))}
                      >
                        删除连线
                      </Button>
                    </Flex>
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="选择一个步骤查看设置。"
                    />
                  )}
                </div>
                {selectedNode && !showSimulationPage && (
                  <Button
                    danger
                    block
                    disabled={!canEdit}
                    className={styles.deleteNodeButton ?? ''}
                    onClick={() => edit(() => canvas.deleteSelected([selectedNode.id], []))}
                  >
                    删除步骤及相关连线
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
    </aside>
  );

  return (
    <section
      className={`${styles.editorShell ?? ''} ${showSimulationPage ? (styles.simulationShell ?? '') : ''}`}
      aria-label={showSimulationPage ? '旅程模拟' : '旅程编排'}
      onKeyDown={handleCanvasKeyDown}
    >
      <header className={styles.topbar}>
        <div className={styles.topbarTitle}>
          {showSimulationPage ? (
            <Button
              type="link"
              icon={<ArrowLeftOutlined />}
              aria-label="返回编排"
              onClick={() => navigate(`/journeys/${id}/editor`, { state: location.state })}
            >
              返回编排
            </Button>
          ) : (
            <Button type="link" icon={<ArrowLeftOutlined />} onClick={goBack}>
              返回活动
            </Button>
          )}
          <div className={styles.journeyHeading}>
            <Typography.Title level={3} className={styles.journeyName ?? ''}>
              {journey?.name ?? '旅程编排'}
            </Typography.Title>
          </div>
        </div>
        <Flex align="center" gap={12} className={styles.topbarActions}>
          <Typography.Text
            role="status"
            className={`${styles.saveStatus ?? ''} ${dirty ? (styles.saveStatusDirty ?? '') : ''}`}
          >
            {saveStatus}
          </Typography.Text>
          {!showSimulationPage && (
            <Tooltip
              title={
                simulationBlockReason ??
                (!initializedId || initializedId !== id ? '旅程正在读取，请稍后再试。' : undefined)
              }
              placement="bottom"
            >
              <span className={styles.disabledButtonTrigger ?? ''}>
                <Button
                  icon={<ExperimentOutlined />}
                  aria-label="打开旅程模拟"
                  disabled={
                    !initializedId || initializedId !== id || simulationBlockReason !== undefined
                  }
                  onClick={openSimulation}
                >
                  旅程模拟
                </Button>
              </span>
            </Tooltip>
          )}
          {journey !== undefined && canEditCampaign(journey.campaign.status) && (
            <JourneyPublishDialog
              journeyId={id}
              revision={journey.revision}
              blockReason={getPublishBlockReason()}
              onReadLatest={readLatestAfterConfirm}
            />
          )}
          {journey !== undefined && canEditCampaign(journey.campaign.status) && (
            <Button
              type="primary"
              loading={saving}
              disabled={
                !canEdit ||
                mustVerify ||
                saving ||
                !dirty ||
                !parsedDefinition.success ||
                nodes.length === 0
              }
              onClick={draft.saveDraft}
            >
              保存编排
            </Button>
          )}
        </Flex>
      </header>

      {journey && !canEditCampaign(journey.campaign.status) && (
        <Alert
          className={styles.pageAlert ?? ''}
          type="warning"
          showIcon
          title={`当前活动为${currentStatus}，旅程只能查看。`}
        />
      )}
      {(serverReadOnly || journeyMissing) && (
        <Alert
          className={styles.pageAlert ?? ''}
          type="warning"
          showIcon
          title={
            journeyMissing
              ? '旅程已不存在，当前内容无法保存。'
              : '活动已不能编辑，当前内容无法保存。'
          }
          action={
            conflict || serverReadOnly ? (
              <Button onClick={readLatestAfterConfirm}>重新读取旅程</Button>
            ) : undefined
          }
        />
      )}
      {notFound && (
        <Alert className={styles.pageAlert ?? ''} type="warning" showIcon title="旅程不存在。" />
      )}
      {loadError && (
        <Alert
          className={styles.pageAlert ?? ''}
          type="error"
          showIcon
          title="旅程暂时无法读取。"
          description={loadError}
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      )}
      {!initializedId || initializedId !== id ? (
        query.isPending || query.isFetching ? (
          <Flex justify="center" role="status" aria-label="正在读取旅程" className={styles.loading}>
            <Spin />
          </Flex>
        ) : null
      ) : (
        <>
          <div
            className={`${styles.editorWorkspace ?? ''} ${
              showSimulationPage ? (styles.simulationWorkspace ?? '') : ''
            }`}
            data-focused={!showSimulationPage && focused}
            data-inspector-hidden={!showSimulationPage && inspectorCollapsed}
          >
            {!showSimulationPage && !focused && (
              <JourneyEditorPalette
                canEdit={canEdit}
                nodeLimitReached={nodes.length >= JOURNEY_NODE_LIMIT}
                hasStart={nodes.some((node) => node.data.draftNode.type === 'start')}
                hasSelection={hasSelection}
                canUndo={canUndo}
                canRedo={canRedo}
                aiDraftBlockReason={getAiDraftBlockReason()}
                onOpenAiDraft={() =>
                  navigate(`/journeys/${id}/ai-draft`, { state: location.state })
                }
                onAddNode={(type) => edit(() => canvas.addNode(type))}
                onUndo={() => edit(canvas.undo)}
                onRedo={() => edit(canvas.redo)}
                onCopy={canvas.copySelection}
                onDelete={() => edit(() => canvas.deleteSelected())}
              />
            )}
            <main className={styles.canvasPanel} aria-label="旅程画布">
              <header className={styles.canvasHeader}>
                <Typography.Title level={4} className={styles.panelTitle ?? ''}>
                  旅程画布
                </Typography.Title>
                {!showSimulationPage && (
                  <Flex align="center" gap={8} wrap>
                    <Segmented
                      aria-label="布局方向"
                      value={layoutDirection}
                      disabled={!canEdit}
                      options={JOURNEY_LAYOUT_DIRECTIONS.map((value) => ({
                        label: value === 'vertical' ? '纵向' : '横向',
                        value,
                      }))}
                      onChange={(value) =>
                        edit(() => canvas.changeLayoutDirection(value as JourneyLayoutDirection))
                      }
                    />
                    <Popconfirm
                      title="自动排列会调整所有步骤的位置。"
                      description="你可以使用撤销恢复原来的位置。"
                      okText="自动排列"
                      cancelText="取消"
                      onConfirm={() => edit(canvas.autoArrange)}
                    >
                      <Button icon={<ApartmentOutlined />} disabled={!canEdit || nodes.length < 2}>
                        自动排列
                      </Button>
                    </Popconfirm>
                    <Button
                      icon={focused ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                      onClick={() => {
                        setInspectorOpen(false);
                        setFocused(!focused);
                      }}
                    >
                      {focused ? '退出专注' : '专注画布'}
                    </Button>
                  </Flex>
                )}
              </header>
              <div ref={canvasElement} className={styles.canvas} tabIndex={-1}>
                <ReactFlow<JourneyCanvasFlowNode, Edge>
                  colorMode={mode}
                  nodes={displayNodes}
                  edges={displayEdges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={(connection) => edit(() => canvas.handleConnect(connection))}
                  onConnectEnd={handleConnectEnd}
                  onSelectionChange={onSelectionChange}
                  onNodeClick={() => {
                    // 模拟页复用步骤设置抽屉，只读查看配置，不改变模拟资料或执行结果。
                    if (inspectorInDrawer) openInspector();
                  }}
                  onEdgeClick={() => {
                    if (!showSimulationPage && inspectorInDrawer) openInspector();
                  }}
                  onInit={(instance) => {
                    flowInstance.current = instance;
                  }}

                  onNodeDragStart={() => {
                    canvas.startDrag();
                    draft.cancelAutosave();
                  }}
                  onNodeDragStop={() => {
                    canvas.finishDrag();
                    draft.clearSaveError();
                  }}
                  nodesDraggable={canEdit && !showSimulationPage}
                  nodesConnectable={canEdit && !showSimulationPage}
                  elementsSelectable
                  nodesFocusable
                  edgesFocusable={!showSimulationPage}
                  deleteKeyCode={null}
                  minZoom={0.25}
                  maxZoom={1.75}
                  fitView
                  fitViewOptions={fitViewOptions}
                  defaultEdgeOptions={defaultEdgeOptions}
                  ariaLabelConfig={
                    showSimulationPage
                      ? {
                          ...flowAriaLabels,
                          'node.a11yDescription.default': '按 Enter 或空格查看步骤配置。',
                          'node.a11yDescription.keyboardDisabled': '按 Enter 或空格查看步骤配置。',
                        }
                      : flowAriaLabels
                  }
                  className={styles.flow}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={22} size={1} />
                  {!showSimulationPage && ((!compact && inspectorCollapsed) || focused) && (
                    <Panel position="top-right" className={styles.inspectorToggle}>
                      <Button
                        size="small"
                        aria-label="展开步骤设置"
                        icon={<MenuUnfoldOutlined />}
                        disabled={focused && !hasSelection}
                        onClick={openInspector}
                      >
                        步骤设置
                      </Button>
                    </Panel>
                  )}
                  <Controls position="bottom-right" showFitView showInteractive={false} />
                  {nodes.length === 0 && (
                    <Panel position="top-center">
                      <div className={styles.emptyCanvas}>
                        {showSimulationPage ? '画布中暂无步骤' : '从左侧添加步骤开始编排'}
                      </div>
                    </Panel>
                  )}
                </ReactFlow>
                {!showSimulationPage && quickAdd && (
                  <Dropdown
                    open
                    autoFocus
                    trigger={['click']}
                    placement="bottomLeft"
                    autoAdjustOverflow
                    destroyOnHidden
                    rootClassName={styles.quickAddDropdown ?? ''}
                    onOpenChange={(open) => {
                      if (!open) setQuickAdd(null);
                    }}
                    menu={{
                      items: journeyNodeOptions
                        .filter((option) => option.value !== 'start')
                        .map((option) => ({
                          key: option.value,
                          label: option.label,
                          icon: option.icon,
                        })),
                      onClick: ({ key }) => {
                        const option = journeyNodeOptions.find((item) => item.value === key);
                        const currentQuickAdd = quickAdd;
                        if (!option || !currentQuickAdd) return;
                        setQuickAdd(null);
                        const center =
                          flowInstance.current?.screenToFlowPosition(
                            currentQuickAdd.clientPosition,
                          ) ?? currentQuickAdd.clientPosition;
                        edit(() =>
                          canvas.addConnectedNode(
                            option.value as JourneyNodeType,
                            currentQuickAdd.sourceId,
                            currentQuickAdd.branch,
                            center,
                          ),
                        );
                      },
                      onKeyDown: (event) => {
                        if (event.key === 'Escape' && quickAdd) {
                          restoreQuickAddSourceFocus(quickAdd.sourceId);
                        }
                      },
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={styles.quickAddAnchor}
                      style={{ left: quickAdd.anchor.x, top: quickAdd.anchor.y }}
                    />
                  </Dropdown>
                )}
              </div>
            </main>

            {showSimulationPage ? (
              <aside className={styles.simulationInspector ?? ''} aria-label="旅程模拟">
                <JourneySimulationPanel
                  journeyId={id}
                  definition={canvas.currentDefinition}
                  segmentRules={journey?.segment?.rules ?? null}
                  simulation={simulation}
                  onLocate={locateNode}
                />
              </aside>
            ) : !inspectorInDrawer && !inspectorCollapsed ? (
              settingsPanel
            ) : null}
            {/* 关闭时卸载抽屉；模拟页的配置和删除入口均按只读处理。 */}
            {inspectorInDrawer && inspectorOpen && hasSelection && (
              <Drawer
                title="步骤设置"
                open
                size={380}
                onClose={() => {
                  setInspectorOpen(false);
                  canvasElement.current?.focus();
                }}
                afterOpenChange={(open) => {
                  if (open) nodeSettingsHeading.current?.focus();
                }}
                styles={{ body: { padding: 0 } }}
              >
                {settingsPanel}
              </Drawer>
            )}
          </div>

          <JourneyFlowCheck
            issues={canvas.issues}
            warnings={canvas.warnings}
            canvasErrors={canvas.canvasErrors}
            saveError={saveError}
            conflict={conflict}
            onClearErrors={canvas.clearErrors}
            onSelectNode={locateNode}
            onReadLatest={readLatestAfterConfirm}
          />
        </>
      )}
    </section>
  );
}
