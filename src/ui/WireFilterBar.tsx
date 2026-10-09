import { WIRE_FILTER_LABELS, WIRE_FILTER_ORDER, type WireFilter } from '../domain';

/**
 * 批次1【线路筛选】。
 *
 * 只切换"哪一类线路留在画布上"的显示：不新建、不删除、不改变任何连接，也不写项目文件。
 * 用途分类来自领域层已有的确定性电气网络分类（`net.ts` 的 `classifyNet`），
 * 判不出来的连线一律算「未分类」，绝不按引脚名或电压猜。
 */
export function WireFilterBar({ filter, matched, total, unclassified, moduleNeedsFocus, collapsed, onToggleCollapse, onChange }: {
  filter: WireFilter;
  /** 当前筛选命中的连线数。 */
  matched: number;
  /** 画布上的连线总数。 */
  total: number;
  /** 用途判不出来（未分类）的连线数。 */
  unclassified: number;
  /** 「当前模块相关」暂时没有聚焦目标，已退回「全部」。 */
  moduleNeedsFocus: boolean;
  /** 是否已最小化成左下角的一个按钮。 */
  collapsed: boolean;
  onToggleCollapse: () => void;
  onChange: (filter: WireFilter) => void;
}) {
  // 最小化态：整个筛选条缩成左下角一个按钮（放在「适配视口」控件上方），点一下还原。
  if (collapsed) {
    return <button type="button" className="wire-filter-min" aria-label="展开线路筛选" title="展开线路筛选" aria-expanded={false} onClick={onToggleCollapse}>
      <span aria-hidden="true">▴</span> 线路筛选
    </button>;
  }
  return <div className="wire-filter" role="group" aria-label="线路筛选">
    <span className="wire-filter-title">线路筛选</span>
    <button type="button" className="wire-filter-toggle" aria-label="收起线路筛选" title="收起线路筛选" aria-expanded={true} onClick={onToggleCollapse}>▾</button>
    {WIRE_FILTER_ORDER.map((value) => (
      <button
        key={value}
        type="button"
        className={`wire-filter-chip${value === filter ? ' active' : ''}`}
        aria-pressed={value === filter}
        onClick={() => onChange(value)}
      >{WIRE_FILTER_LABELS[value]}</button>
    ))}
    {/* 明确告知"只是淡出，没有删线"，避免用户以为筛选改动了电路。 */}
    <span className="wire-filter-title" role="status">{filter === 'all' ? `共 ${total} 根` : `命中 ${matched} / ${total} 根`}</span>
    {moduleNeedsFocus && <span className="wire-filter-note">「当前模块相关」要先选中或悬停一个模块，现在暂时按「全部」显示。</span>}
    {!moduleNeedsFocus && filter !== 'all' && matched === 0 && <span className="wire-filter-note">这一类当前没有线路；筛选只让连线淡出，不会隐藏或删除任何连接。</span>}
    {filter === 'all' && unclassified > 0 && <span className="wire-filter-note">其中 {unclassified} 根用途未分类（现有数据不足以判定，不猜）。</span>}
  </div>;
}