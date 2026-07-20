import { useMemo, useRef, type ComponentRef } from 'react';
import { Alert, Button, Flex, Popconfirm, Radio, Typography } from 'antd';
import { DeleteOutlined, EnvironmentOutlined, PlusOutlined } from '@ant-design/icons';
import {
  AUDIENCE_FIELDS,
  SEGMENT_CHILDREN_LIMIT,
  SEGMENT_MAX_DEPTH,
  SEGMENT_MAX_NODES,
  analyzeSegmentRuleSatisfiability,
  segmentRuleSchema,
  type SegmentRule,
  type SegmentRuleFinding,
  type SegmentRulePath,
} from '@journeylens/shared';
import {
  countRuleNodes,
  containsCondition,
  removeAtPath,
  ruleDepthAtPath,
  rulePathId,
  updateAtPath,
} from '@/features/segments/segment-rule-tree';
import { RuleCompareEditor } from './RuleCompareEditor';
import styles from './RuleTreeEditor.module.css';

type RuleTreeEditorProps = {
  value: SegmentRule;
  onChange: (value: SegmentRule) => void;
};

type RuleNodeEditorProps = RuleTreeEditorProps & {
  treeRoot: SegmentRule;
  path: SegmentRulePath;
  findings: readonly SegmentRuleFinding[];
  canRemove: boolean;
};

type RuleGroupEditorProps = Omit<RuleNodeEditorProps, 'value'> & {
  value: Extract<SegmentRule, { kind: 'all' | 'any' }>;
  nested: boolean;
  insideExclusion: boolean;
};

const newCompareRule = (): SegmentRule => {
  const field = AUDIENCE_FIELDS[0]!;
  return {
    kind: 'compare',
    left: { source: 'user', path: field.key },
    operator: field.operators[0]!,
  };
};

function samePath(left: SegmentRulePath, right: SegmentRulePath): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function hasFinding(path: SegmentRulePath, findings: readonly SegmentRuleFinding[]): boolean {
  return findings.some(
    (finding) =>
      samePath(path, finding.path) ||
      finding.memberPaths.some((memberPath) => samePath(path, memberPath)),
  );
}

function pathLabel(path: SegmentRulePath): string {
  const conditions: number[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const childIndex = path[index + 1];
    if (path[index] === 'children' && typeof childIndex === 'number') {
      conditions.push(childIndex + 1);
      index += 1;
    }
  }
  return conditions.length === 0 ? '规则' : `条件 ${conditions.join('.')}`;
}

function RuleNodeEditor({
  treeRoot,
  value,
  onChange,
  path,
  findings,
  canRemove,
}: RuleNodeEditorProps) {
  if (value.kind === 'compare') {
    return (
      <RuleCompareEditor
        value={value}
        treeRoot={treeRoot}
        path={path}
        label={pathLabel(path)}
        conflicted={hasFinding(path, findings)}
        canRemove={canRemove}
        onChange={onChange}
      />
    );
  }

  if (value.kind === 'not') {
    return (
      <section id={rulePathId(path)} tabIndex={-1} className={styles.exclusion}>
        <Flex justify="space-between" align="center" gap={12}>
          <Typography.Text strong className={styles.exclusionTitle ?? ''}>
            排除满足以下条件的用户
          </Typography.Text>
          {canRemove && (
            <RemoveGroupButton value={value} path={path} treeRoot={treeRoot} onChange={onChange} />
          )}
        </Flex>
        <RuleNodeEditor
          value={value.child}
          treeRoot={treeRoot}
          onChange={onChange}
          path={[...path, 'child']}
          findings={findings}
          canRemove={false}
        />
      </section>
    );
  }

  return (
    <RuleGroupEditor
      value={value}
      treeRoot={treeRoot}
      onChange={onChange}
      path={path}
      findings={findings}
      canRemove={canRemove}
      nested={path.length > 0}
      insideExclusion={path[path.length - 1] === 'child'}
    />
  );
}

function RuleGroupEditor({
  treeRoot,
  value,
  onChange,
  path,
  findings,
  canRemove,
  nested,
  insideExclusion,
}: RuleGroupEditorProps) {
  // 按补齐至少一个条件所需的层数和节点数预留余量：普通条件占 1，条件组占 2，排除组占 3。
  const depth = ruleDepthAtPath(treeRoot, path) ?? 1;
  const className = insideExclusion
    ? styles.exclusionContents
    : nested
      ? `${styles.nestedGroup} ${depth % 2 === 0 ? styles.nestedTinted : styles.nestedPlain}`
      : styles.rootGroup;

  function appendGroup(kind: 'all' | 'any' | 'not'): void {
    // “非组”需要一个子规则，因此先放入空的且组，等用户补上条件后再参与校验。
    const group: SegmentRule =
      kind === 'not'
        ? { kind: 'not', child: { kind: 'all', children: [] } }
        : { kind, children: [] };
    onChange(
      updateAtPath(treeRoot, path, (node) => {
        if (node.kind === 'all' || node.kind === 'any') {
          node.children.push(group);
        }
      }),
    );
  }

  return (
    <section id={rulePathId(path)} tabIndex={-1} className={`${styles.group} ${className}`}>
      <Flex justify="space-between" align="center" wrap gap={12} className={styles.groupHeader}>
        {!insideExclusion && (
          <Typography.Text strong {...(nested ? {} : { className: styles.rootTitle })}>
            满足以下条件
          </Typography.Text>
        )}
        {(!insideExclusion || value.children.length > 1) && (
          <Radio.Group
            aria-label={`${pathLabel(path)}分组逻辑`}
            optionType="button"
            value={value.kind}
            options={[
              { label: '全部满足', value: 'all' },
              { label: '任一满足', value: 'any' },
            ]}
            onChange={(event) => {
              const kind = event.target.value as 'all' | 'any';
              onChange(
                updateAtPath(treeRoot, path, (node) => {
                  if (node.kind === 'all' || node.kind === 'any') {
                    node.kind = kind;
                  }
                }),
              );
            }}
          />
        )}
        {canRemove && (
          <RemoveGroupButton value={value} path={path} treeRoot={treeRoot} onChange={onChange} />
        )}
      </Flex>

      {value.children.length === 0 ? (
        <Typography.Text type="secondary" className={styles.emptyHint ?? ''}>
          添加一个条件开始设置
        </Typography.Text>
      ) : (
        <div className={styles.children}>
          {value.children.map((child, index) => {
            const childPath: SegmentRulePath = [...path, 'children', index];
            return (
              <div className={styles.childEntry} key={rulePathId(childPath)}>
                {index > 0 && (
                  <div
                    className={`${styles.operatorConnector} ${
                      value.kind === 'all' ? styles.connectorAnd : styles.connectorOr
                    }`}
                    aria-label={value.kind === 'all' ? '且' : '或'}
                  >
                    {value.kind === 'all' ? '且' : '或'}
                  </div>
                )}
                <RuleNodeEditor
                  value={child}
                  treeRoot={treeRoot}
                  onChange={onChange}
                  path={childPath}
                  findings={findings}
                  canRemove
                />
              </div>
            );
          })}
        </div>
      )}

      <Flex wrap gap={8} className={styles.groupActions}>
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          disabled={
            value.children.length >= SEGMENT_CHILDREN_LIMIT ||
            countRuleNodes(treeRoot) + 1 > SEGMENT_MAX_NODES ||
            depth + 1 > SEGMENT_MAX_DEPTH
          }
          onClick={() =>
            onChange(
              updateAtPath(treeRoot, path, (node) => {
                if (node.kind === 'all' || node.kind === 'any') {
                  node.children.push(newCompareRule());
                }
              }),
            )
          }
        >
          添加条件
        </Button>
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          disabled={
            value.children.length >= SEGMENT_CHILDREN_LIMIT ||
            countRuleNodes(treeRoot) + 2 > SEGMENT_MAX_NODES ||
            depth + 2 > SEGMENT_MAX_DEPTH
          }
          onClick={() => appendGroup(value.kind === 'all' ? 'any' : 'all')}
        >
          添加条件组
        </Button>
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          disabled={
            value.children.length >= SEGMENT_CHILDREN_LIMIT ||
            countRuleNodes(treeRoot) + 3 > SEGMENT_MAX_NODES ||
            depth + 3 > SEGMENT_MAX_DEPTH
          }
          onClick={() => appendGroup('not')}
        >
          添加排除组
        </Button>
      </Flex>
    </section>
  );
}

function RemoveGroupButton({
  value,
  treeRoot,
  path,
  onChange,
}: {
  value: SegmentRule;
  treeRoot: SegmentRule;
  path: SegmentRulePath;
  onChange: (value: SegmentRule) => void;
}) {
  const buttonRef = useRef<ComponentRef<typeof Button>>(null);
  const popupRef = useRef<ComponentRef<typeof Popconfirm>>(null);
  const groupName = value.kind === 'not' ? '排除组' : '条件组';
  const hasContent = containsCondition(value);

  const remove = () => {
    onChange(removeAtPath(treeRoot, path));
    document.getElementById(rulePathId(path.slice(0, -2)))?.focus();
  };

  const trigger = (
    <Button
      ref={buttonRef}
      aria-label={`删除${groupName}`}
      icon={<DeleteOutlined />}
      type="text"
      onClick={hasContent ? undefined : remove}
    />
  );

  if (!hasContent) return trigger;

  return (
    <Popconfirm
      ref={popupRef}
      title={`删除${groupName}？`}
      description="组内条件也会一起删除。"
      okText={`删除`}
      cancelText={`保留`}
      okButtonProps={{ danger: true }}
      onConfirm={remove}
      onOpenChange={(open) => {
        if (!open && popupRef.current?.popupElement?.contains(document.activeElement)) {
          buttonRef.current?.focus();
        }
      }}
    >
      {trigger}
    </Popconfirm>
  );
}

export function RuleTreeEditor({ value, onChange }: RuleTreeEditorProps) {
  const parsed = useMemo(() => segmentRuleSchema.safeParse(value), [value]);
  const findings = useMemo(
    () => (parsed.success ? analyzeSegmentRuleSatisfiability(parsed.data).findings : []),
    [parsed],
  );

  return (
    <Flex vertical gap={12}>
      <RuleNodeEditor
        value={value}
        treeRoot={value}
        onChange={onChange}
        path={[]}
        findings={findings}
        canRemove={false}
      />
      {findings.map((finding, index) => {
        const overall = finding.path.length === 0;
        const targetPath = finding.memberPaths[0] ?? finding.path;
        const title =
          overall && finding.kind === 'unsatisfiable'
            ? '分群条件互相矛盾'
            : finding.kind === 'unsatisfiable'
              ? '这组条件互相矛盾，分群仍可保存'
              : '这组条件没有起到筛选作用，请确认';
        return (
          <Alert
            key={`${finding.kind}-${rulePathId(finding.path)}-${index}`}
            type={finding.kind === 'unsatisfiable' ? 'warning' : 'info'}
            title={
              <Flex justify="space-between" align="center" gap={8} wrap>
                <span>{title}</span>
                <Button
                  icon={<EnvironmentOutlined />}
                  onClick={() => {
                    const target = document.getElementById(rulePathId(targetPath));
                    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
                    target?.focus({ preventScroll: true });
                  }}
                >
                  定位条件
                </Button>
              </Flex>
            }
            description={finding.message}
          />
        );
      })}
    </Flex>
  );
}
