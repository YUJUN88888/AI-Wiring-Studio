import { useMemo, useState } from 'react';
import { COVERAGE_LABELS, ERC_COVERAGE, GRADE_LABELS, GRADE_ORDER, gradeOfSeverity, type ErcProblem, type ErcResult, type PinRef, type ProblemGrade } from '../domain';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components';

type ProblemFilter = 'ALL' | ProblemGrade;

export interface InspectorPanelProps {
  componentCount: number;
  wireCount: number;
  erc: ErcResult;
  onFocusProblem: (affectedPins: PinRef[]) => void;
  /** D：右侧栏是否收起（由上层 shell 布局控制），收起时整个 aside 隐藏、画布占满。 */
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const filters: { value: ProblemFilter; label: string }[] = [
  { value: 'ALL', label: '全部' },
  ...GRADE_ORDER.map((grade) => ({ value: grade as ProblemFilter, label: GRADE_LABELS[grade] })),
];

const ruleLabels: Record<ErcProblem['rule'], string> = {
  SHORT_CIRCUIT: '电源短路',
  POWER_CONFLICT: '电源冲突',
  OVERVOLTAGE: '输入过压',
  OUTPUT_CONFLICT: '输出冲突',
  UNCONNECTED_REQUIRED_INPUT: '必接输入未连接',
  POLARITY_ERROR: '极性错误',
  DANGLING_WIRE: '悬空线',
  MISSING_PIN: '引脚不存在',
  DUPLICATE_CONNECTION: '重复连接',
  UNCONFIRMED_NET: '待确认',
  LEVEL_MISMATCH: '电平不匹配',
  GPIO_POWERING_LOAD: '由 GPIO 供电',
  PARALLEL_POWER_OUTPUTS: '电源输出并联',
};

const evidenceLabels: Record<string, string> = {
  detectedVoltage: '检测到的电压',
  maxVoltage: '最大允许电压',
  inputRange: '可接受的输入电平范围',
  positiveVoltages: '正电源电压',
  voltages: '电压值',
  positiveVoltage: '正极电压',
  negativeVoltage: '负极电压',
  wireId: '连线',
  wireIds: '重复连线',
  voltageState: '电压状态',
  currentState: '电流状态',
};

const currentKindLabels = { Known: '已知', Estimated: '估算', Maximum: '最大值', Unknown: '未知' } as const;

/** 电压网络的折叠态记在本地存储里，否则每次打开又被内容撑开。 */
const NETS_OPEN_KEY = 'aiws.inspector.nets-open';
function readNetsOpen(): boolean {
  try { return localStorage.getItem(NETS_OPEN_KEY) !== 'closed'; } catch { return true; }
}

/** A15 检查范围的折叠态同样记在本地存储，避免这块说明长期占满检查器。 */
const COVERAGE_OPEN_KEY = 'aiws.inspector.coverage-open';
function readCoverageOpen(): boolean {
  try { return localStorage.getItem(COVERAGE_OPEN_KEY) === 'open'; } catch { return false; }
}

function EvidenceValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <span>{value.map((item) => typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item)).join('、') || '无'}</span>;
  if (typeof value === 'number') return <span>{Number.isFinite(value) ? String(value) : '未知'}</span>;
  if (typeof value === 'string' || typeof value === 'boolean') return <span>{String(value)}</span>;
  return <span>未知</span>;
}

function ProblemEvidence({ problem }: { problem: ErcProblem }) {
  const entries = Object.entries(problem.evidence);
  if (!entries.length) return <p className="evidence-empty">没有可显示的确定性证据。</p>;
  return <dl className="problem-evidence" aria-label="问题证据">
    {entries.map(([key, value]) => <div key={key}><dt>{evidenceLabels[key] ?? key}</dt><dd><EvidenceValue value={value} /></dd></div>)}
  </dl>;
}

export function InspectorPanel({ componentCount, wireCount, erc, onFocusProblem, collapsed, onToggleCollapse }: InspectorPanelProps) {
  const [filter, setFilter] = useState<ProblemFilter>('ALL');
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  const [netsOpen, setNetsOpen] = useState(readNetsOpen);
  const [coverageOpen, setCoverageOpen] = useState(readCoverageOpen);
  const visibleProblems = useMemo(() => filter === 'ALL' ? erc.problems : erc.problems.filter((problem) => gradeOfSeverity(problem.severity) === filter), [erc.problems, filter]);
  const selectedProblem = erc.problems.find((problem) => problem.id === selectedProblemId) ?? null;

  const selectProblem = (problem: ErcProblem) => {
    setSelectedProblemId(problem.id);
    onFocusProblem(problem.affectedPins);
  };

  /** 折叠/展开电压网络，并把状态写进本地存储。 */
  const toggleNets = () => setNetsOpen((open) => {
    const next = !open;
    try { localStorage.setItem(NETS_OPEN_KEY, next ? 'open' : 'closed'); } catch { /* 存储不可用时只在本次会话内记住 */ }
    return next;
  });

  /** A15：折叠/展开「检查范围」说明，同样记住折叠态。 */
  const toggleCoverage = () => setCoverageOpen((open) => {
    const next = !open;
    try { localStorage.setItem(COVERAGE_OPEN_KEY, next ? 'open' : 'closed'); } catch { /* 存储不可用时只在本次会话内记住 */ }
    return next;
  });

  return <aside className="inspector" data-collapsed={collapsed} aria-label="ERC 检查器">
    <div className="panel-head">
      <h2>检查器</h2>
      {/* D：收起右侧栏，让画布占满；收起后在画布右边缘留一个展开条。 */}
      <button type="button" className="panel-collapse" aria-label="收起检查器" title="收起检查器" onClick={onToggleCollapse}>»</button>
    </div>
    {/* 项目规模是常驻状态行：不随标签页切换消失，用户随时知道自己在看多大的工程。 */}
    <p className="inspector-summary">项目：{componentCount} 个组件，{wireCount} 根连线，{erc.nets.length} 个网络。</p>
    {/* 标签页组织：把「属性（电压网络）」与「检查」分开，避免所有内容纵向堆叠挤占画布。检查为默认页。 */}
    <Tabs defaultValue="check" className="inspector-tabs">
      <TabsList>
        <TabsTrigger value="props">属性</TabsTrigger>
        <TabsTrigger value="check">检查</TabsTrigger>
      </TabsList>
      <TabsContent value="props">
        <div className="nets-heading">
          <h2>电压网络</h2>
          <button type="button" className="nets-toggle" aria-expanded={netsOpen} aria-label={netsOpen ? '折叠电压网络' : '展开电压网络'} title={netsOpen ? '折叠电压网络' : '展开电压网络'} onClick={toggleNets}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d={netsOpen ? 'M3 6l5 5 5-5z' : 'M6 3l5 5-5 5z'} /></svg>
          </button>
        </div>
        {netsOpen && (erc.nets.length ? <div className="nets">{erc.nets.map((net) => {
          const state = erc.voltages[net.id];
          const current = erc.currents[net.id];
          const value = state?.kind === 'Known' ? `${state.value} V` : state?.kind === 'Conflict' ? '冲突' : '未知';
          const currentValue = current?.kind === 'Unknown' ? '未知' : current?.value === undefined ? current ? currentKindLabels[current.kind] : '未知' : `${currentKindLabels[current.kind]}：${current.value} ${current.unit}`;
          const kind = net.kind === 'POWER' ? '电源' : net.kind === 'GROUND' ? '地' : net.kind === 'SIGNAL' ? '信号' : '未知';
          return <div key={net.id} className={`net ${state?.kind.toLowerCase() ?? 'unknown'}`}><b>{net.id} · {kind}</b><span>电压：{value}</span><span>电流：{currentValue}</span>{current?.reason && <small>原因：{current.reason}</small>}</div>;
        })}</div> : <p className="hint">连接引脚后显示电压域；无明确来源时显示“未知”。</p>)}
      </TabsContent>
      <TabsContent value="check">
        <div className="problems-heading"><h2>问题 · {erc.problems.length}</h2><span>{filters.find((item) => item.value === filter)?.label}</span></div>
        <div className="problem-filters" aria-label="问题分级筛选">
          {filters.map((item) => <button type="button" key={item.value} className={filter === item.value ? 'active' : ''} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}
        </div>
        {erc.problems.length ? <div className="problems">{visibleProblems.length ? visibleProblems.map((item) => <button key={item.id} className={`problem ${item.severity.toLowerCase()} ${selectedProblemId === item.id ? 'selected' : ''}`} onClick={() => selectProblem(item)}><b>{GRADE_LABELS[gradeOfSeverity(item.severity)]} · {ruleLabels[item.rule]}</b><span>{item.message}</span></button>) : <div className="problem info"><b>信息</b><span>当前筛选条件下没有问题。</span></div>}</div> : <div className="problem info"><b>信息</b><span>当前没有确定性 ERC 问题。</span></div>}
        {selectedProblem && <section className="evidence" aria-live="polite">
          <h3>问题详情</h3>
          <p>{ruleLabels[selectedProblem.rule]} · {selectedProblem.netId ?? '组件内部关系'}</p>
          <dl className="problem-detail">
            <div><dt>原因</dt><dd>{selectedProblem.message}</dd></div>
            <div><dt>可能后果</dt><dd>{selectedProblem.consequence}</dd></div>
            <div><dt>处理方法</dt><dd>{selectedProblem.handling}</dd></div>
          </dl>
          <h3>问题证据</h3>
          <ProblemEvidence problem={selectedProblem} />
        </section>}
        <p className="hint">点击问题可定位受影响元件。未知数据不会被当作安全结论。</p>
        {/* A15：把「检查了什么 / 什么算不出来 / 什么不做」如实写在检查器里，避免软件暗示自己做过没做的事。 */}
        <div className="nets-heading coverage-heading">
          <h2>检查范围</h2>
          <button type="button" className="nets-toggle" aria-expanded={coverageOpen} aria-label={coverageOpen ? '折叠检查范围' : '展开检查范围'} title={coverageOpen ? '折叠检查范围' : '展开检查范围'} onClick={toggleCoverage}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d={coverageOpen ? 'M3 6l5 5 5-5z' : 'M6 3l5 5-5 5z'} /></svg>
          </button>
        </div>
        {coverageOpen && <ul className="coverage" aria-label="检查范围">
          {ERC_COVERAGE.map((entry) => <li key={entry.layer} className={`coverage-item ${entry.status.toLowerCase()}`}>
            <b>{entry.layer} · {COVERAGE_LABELS[entry.status]}</b>
            <small>{entry.note}</small>
          </li>)}
        </ul>}
      </TabsContent>
    </Tabs>
  </aside>;
}