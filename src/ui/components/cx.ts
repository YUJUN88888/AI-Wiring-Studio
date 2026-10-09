/** 极简 className 组合器：过滤 false / null / undefined 后空格拼接，不引入 classnames 依赖。 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}