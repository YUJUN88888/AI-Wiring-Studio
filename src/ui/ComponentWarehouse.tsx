import { useMemo, useState } from 'react';
import type { BuiltInComponentKind, ComponentCategory, ComponentDefinition } from '../domain';
import { categoryLabels } from './ComponentEditor';
import { Dialog, DialogContent, DialogTitle } from './components';

/**
 * 内置元件仓库（弹窗）。
 *
 * 侧栏里把内置元件排成一长列不便阅读，改为一个入口按钮 + 这个仓库窗口：
 * - 默认显示全部元件（内置 + 我的元件），用分类 chips 筛选，含「我的元件」分类；
 * - 顶部关键字检索同时匹配名称、型号、厂商与类型标识；
 * - 内置元件不会在这里被修改："添加"只是把一个实例放到画布上。
 */

/** 组件库拖拽到画布时使用的自定义数据类型（与 App 中的常量保持一致）。 */
const USER_COMPONENT_MIME = 'application/aiws-user-component';

/** 分类顺序：从供电到杂项，与元件编辑器的分类枚举一一对应。 */
const CATEGORY_ORDER: ComponentCategory[] = ['power', 'ground', 'mcu', 'regulator', 'diode', 'capacitor', 'passive', 'switch', 'other'];

export interface WarehouseBuiltInChoice {
  kind: BuiltInComponentKind;
  definitionId: string;
  label: string;
  category: ComponentCategory;
  pinCount: number;
}

export interface ComponentWarehouseProps {
  /** 用户元件库中的定义（含由内置元件改尺寸/传图片后转成的那些）。 */
  userDefinitions: readonly ComponentDefinition[];
  /** 内置元件条目，直接由内置目录派生。 */
  builtInChoices: readonly WarehouseBuiltInChoice[];
  /** 把一个内置元件放到画布。 */
  onAddBuiltIn: (kind: BuiltInComponentKind) => void;
  /** 把一个用户元件放到画布。 */
  onPlaceDefinition: (definition: ComponentDefinition) => void;
  onEditDefinition: (definition: ComponentDefinition) => void;
  onDeleteDefinition: (definition: ComponentDefinition) => void;
  onClose: () => void;
}

type Filter = 'all' | 'mine' | ComponentCategory;

export function ComponentWarehouse({
  userDefinitions,
  builtInChoices,
  onAddBuiltIn,
  onPlaceDefinition,
  onEditDefinition,
  onDeleteDefinition,
  onClose,
}: ComponentWarehouseProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (...parts: (string | undefined)[]) =>
    normalizedQuery === '' || parts.some((part) => part !== undefined && part.toLowerCase().includes(normalizedQuery));

  // 内置元件一旦被改尺寸或上传图片，就以同一个 definitionId 写进了用户库；此时它已属于「我的元件」，
  // 内置列表里必须去掉，避免同一型号出现两个可点条目。
  const builtInVisible = useMemo(
    () => builtInChoices.filter((choice) => !userDefinitions.some((definition) => definition.id === choice.definitionId)),
    [builtInChoices, userDefinitions],
  );

  const users = userDefinitions.filter((definition) => matchesQuery(definition.displayName, definition.model, definition.manufacturer, definition.id));
  const builtIns = builtInVisible.filter((choice) => matchesQuery(choice.label, choice.kind, choice.definitionId));

  // 只保留"实际有内容"的分类 chips：点一个空分类只会得到空列表，没有意义。
  const availableCategories = useMemo(() => {
    const present = new Set<ComponentCategory>();
    for (const definition of userDefinitions) present.add(definition.category);
    for (const choice of builtInVisible) present.add(choice.category);
    return CATEGORY_ORDER.filter((category) => present.has(category));
  }, [userDefinitions, builtInVisible]);

  const userShown = filter === 'all' || filter === 'mine' ? users : users.filter((definition) => definition.category === filter);
  const builtInShown = filter === 'mine' ? [] : builtIns.filter((choice) => filter === 'all' || choice.category === filter);
  const total = userShown.length + builtInShown.length;

  const groups = CATEGORY_ORDER
    .map((category) => ({
      category,
      users: userShown.filter((definition) => definition.category === category),
      builtIns: builtInShown.filter((choice) => choice.category === category),
    }))
    .filter((group) => group.users.length + group.builtIns.length > 0);

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'mine', label: '我的元件' },
    ...availableCategories.map((category) => ({ key: category as Filter, label: categoryLabels[category] })),
  ];

  return <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent className="editor warehouse" aria-label="元件仓库">
      <header className="editor-head">
        <DialogTitle asChild><strong>元件仓库</strong></DialogTitle>
        <span>默认显示全部元件；可按分类筛选或输入关键字检索。内置元件只能放上画布，不会被修改。</span>
      </header>
      <div className="editor-body">
        <input aria-label="在仓库中搜索元件" className="warehouse-search" placeholder="输入关键字检索名称、型号、厂商、类型…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="ai-kind-row warehouse-filters">
          {chips.map((chip) => <button
            type="button"
            key={chip.key}
            aria-pressed={filter === chip.key}
            className={filter === chip.key ? 'active' : ''}
            onClick={() => setFilter(chip.key)}
          >{chip.label}</button>)}
        </div>
        <p className="hint" role="status">共 {total} 个元件{normalizedQuery === '' ? '' : `（关键字「${query.trim()}」）`}。</p>

        {total === 0
          ? <p className="hint">没有匹配的元件。可以换一个关键字，或先「新建元件」录入自己的元件。</p>
          : <div className="catalog">{groups.map((group) => <section className="library-group" key={group.category}>
            <h4>{categoryLabels[group.category]}</h4>
            {group.users.map((definition) => <div className="user-component" key={definition.id} draggable onDragStart={(event) => event.dataTransfer.setData(USER_COMPONENT_MIME, definition.id)}>
              <button title="放入画布，也可直接拖到画布上" onClick={() => onPlaceDefinition(definition)}>＋ {definition.displayName}</button>
              <button className="ghost" aria-label={`编辑元件 ${definition.displayName}`} onClick={() => onEditDefinition(definition)}>编辑</button>
              <button className="ghost danger" aria-label={`从库中删除 ${definition.displayName}`} onClick={() => onDeleteDefinition(definition)}>删除</button>
              <span className="user-component-tags">
                <span className="tag">{definition.pins.length} 引脚</span>
                <span className="tag">{definition.footprint.width}×{definition.footprint.height}</span>
                <span className={`tag${definition.image ? ' ok' : ''}`}>{definition.image ? '有图' : '无图'}</span>
              </span>
            </div>)}
            {group.builtIns.map((choice) => <div className="user-component" key={choice.kind}>
              <button onClick={() => onAddBuiltIn(choice.kind)}>＋ {choice.label}</button>
              <span className="user-component-tags"><span className="tag">{choice.pinCount} 引脚</span><span className="tag">内置</span></span>
            </div>)}
          </section>)}</div>}
      </div>
      <footer className="editor-foot">
        <span className="hint">内置参数只包含已确认模型；未知额定值和电流不会被虚构。</span>
        <div><button type="button" onClick={onClose}>关闭</button></div>
      </footer>
    </DialogContent>
  </Dialog>;
}