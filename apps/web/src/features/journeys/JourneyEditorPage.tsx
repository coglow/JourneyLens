import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ApartmentOutlined, ArrowLeftOutlined, ExperimentOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Dropdown,
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

export function JourneyEditorPage() {
  const { id = '', view = 'editor' } = useParams();
  const simulationPage = view === 'simulation';
  const aiDraftPage = view === 'ai-draft';
  const location = useLocation();
  const navigate = useNavigate();
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
    if (!parsedDefinition.success || warnings.length > 0) return '请先补齐流程连接并修正步骤设置';
    return undefined;
  }
  // 高亮只存在于展示副本：不改画布状态，也不进入草稿和撤销历史。
  const simulationResult = simulation.result;
  const displayNodes = useMemo(() => {
    if (simulationResult === null) return nodes;
    const traversed = new Set(
      simulationResult.steps.slice(0, simulation.visibleStepCount).map((step) => step.nodeId),
    );
    return nodes.map((node) =>
      traversed.has(node.id)
        ? { ...node, data: { ...node.data, simulationState: 'traversed' as const } }
        : node,
    );
  }, [nodes, simulationResult, simulation.visibleStepCount]);
  const displayEdges = useMemo(() => {
    if (simulationResult === null) return edges;
    // 每展示一个新步骤，才点亮到达该步骤的连线；第一步还没有经过连线。
    const traversed = new Set(
      simulationResult.traversedEdgeIds.slice(0, Math.max(0, simulation.visibleStepCount - 1)),
    );
    return edges.map((edge) =>
      traversed.has(edge.id) ? { ...edge, className: styles.simulationEdge ?? '' } : edge,
    );
  }, [edges, simulationResult, simulation.visibleStepCount]);

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
  const startNodes = canvas.currentDefinition.nodes.filter((node) => node.type === 'start');
  const startBehavior = startNodes[0]?.entryBehavior;
  // 只有画布恰有一个开始步骤时才预填进入行为；空旅程保持未选择，由运营明确决定。
  const initialEntryBehavior = startNodes.length === 1 ? startNodes[0]?.entryBehavior : undefined;
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
    : (warnings[0]?.message ?? undefined);
  const showSimulationPage =
    simulationPage && (initializedId !== id || simulationBlockReason === undefined);

  useEffect(() => {
    if (simulationPage && initializedId === id && simulationBlockReason !== undefined) {
      navigate(`/journeys/${id}/editor`, { replace: true, state: location.state });
    }
  }, [id, initializedId, location.state, navigate, simulationBlockReason, simulationPage]);

  // 编辑入口统一检查只读状态；只有操作确实生效后才清除上一次保存反馈。
  function edit(action: () => boolean): void {
    if (canEdit && action()) draft.clearSaveError();
  }

  /** 模拟结果在当前画布定位；编辑页的问题定位仍聚焦对应步骤设置。 */
  function locateNode(nodeId: string): void {
    canvas.selectNodeForIssue(nodeId, !showSimulationPage);
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
    if (showSimulationPage || aiDraftPage) return;
    const target = event.target;
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

  return (
    <section
      className={styles.editorShell}
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
          >
            {!showSimulationPage && (
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
                  </Flex>
                )}
              </header>
              <div ref={canvasElement} className={styles.canvas}>
                <ReactFlow<JourneyCanvasFlowNode, Edge>
                  nodes={displayNodes}
                  edges={displayEdges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={(connection) => edit(() => canvas.handleConnect(connection))}
                  onConnectEnd={handleConnectEnd}
                  onSelectionChange={onSelectionChange}
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
                  elementsSelectable={!showSimulationPage}
                  nodesFocusable={!showSimulationPage}
                  edgesFocusable={!showSimulationPage}
                  deleteKeyCode={null}
                  minZoom={0.25}
                  maxZoom={1.75}
                  fitView
                  fitViewOptions={fitViewOptions}
                  defaultEdgeOptions={defaultEdgeOptions}
                  ariaLabelConfig={flowAriaLabels}
                  className={styles.flow}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={22} size={1} />
                  <Controls position="top-right" showFitView showInteractive={false} />
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
            ) : (
              <aside className={styles.inspector} aria-label="步骤设置">
                <Tabs
                  className={styles.inspectorTabs ?? ''}
                  activeKey="settings"
                  items={[
                    {
                      key: 'settings',
                      label: '步骤设置',
                      children: (
                        <div className={styles.settingsPane}>
                          <div
                            ref={nodeSettingsHeading}
                            tabIndex={-1}
                            className={styles.settingsHeading}
                          >
                            {selectedNode ? (
                              <JourneyNodeSettings
                                node={selectedNode.data.draftNode}
                                disabled={!canEdit}
                                waitSecondsError={waitSecondsError}
                                startBehavior={startBehavior}
                                onChange={(node) => edit(() => canvas.updateNode(node))}
                              />
                            ) : selectedEdge ? (
                              <Flex vertical gap={12}>
                                <Typography.Text>
                                  {nodes.find((node) => node.id === selectedEdge.source)?.data
                                    .draftNode.name ?? '未知步骤'}
                                  {' → '}
                                  {nodes.find((node) => node.id === selectedEdge.target)?.data
                                    .draftNode.name ?? '未知步骤'}
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
                                  onClick={() =>
                                    edit(() => canvas.deleteSelected([], [selectedEdge.id]))
                                  }
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
                          {selectedNode && (
                            <Button
                              danger
                              block
                              disabled={!canEdit}
                              className={styles.deleteNodeButton ?? ''}
                              onClick={() =>
                                edit(() => canvas.deleteSelected([selectedNode.id], []))
                              }
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
