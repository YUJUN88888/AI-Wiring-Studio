import { WIRE_PURPOSE_LABELS, type WirePurpose } from '../domain';

/**
 * 批次1【选中线路的文字信息】。
 *
 * 需求明确要求"线路不能只依靠颜色区分，还应有名称、标签或选中后的文字信息"，
 * 所以选中一根线就把起点、终点、用途、网络名摆出来。
 * 这些值全部取自画布上已有的数据（引脚本身、电气网络分类），判不出来时如实写「未分类」。
 */
export type WireInfoData = {
  wireId: string;
  /** 起点：`元件名.引脚名`。 */
  source: string;
  target: string;
  purpose: WirePurpose;
  /** 用户自定义的线路分类文字（`Wire.label`），没有则为空字符串。 */
  label: string;
  /** 网络标识：网络编号 + 规模，例：`net-2 · 3 个引脚 / 3 根线`。 */
  netLabel: string;
  /** 网络电压：已确认的具体值，否则明确写未知/冲突。 */
  netDetail: string;
  /** A7 动手接线模式留下的「已接好」标记（写在项目文件里）。 */
  manuallyWired: boolean;
};

export function WireInfoPanel({ info }: { info: WireInfoData }) {
  return <div className="wire-info" role="status" aria-label="选中线路信息">
    <strong>选中线路：{info.wireId}</strong>
    <dl>
      <div><dt>起点</dt><dd>{info.source}</dd></div>
      <div><dt>终点</dt><dd>{info.target}</dd></div>
      <div><dt>用途</dt><dd>{WIRE_PURPOSE_LABELS[info.purpose]}</dd></div>
      {info.label && <div><dt>分类文字</dt><dd>{info.label}</dd></div>}
      <div><dt>网络</dt><dd>{info.netLabel}</dd></div>
      <div><dt>电压</dt><dd>{info.netDetail}</dd></div>
      <div><dt>接线进度</dt><dd>{info.manuallyWired ? '已在实物上接好' : '未标记为已接好'}</dd></div>
    </dl>
    <span className="wire-info-note">用途与网络都来自画布上已有的电气连接数据；判不出来时显示「未分类」，不做猜测。点画布空白处即可恢复正常显示。</span>
  </div>;
}