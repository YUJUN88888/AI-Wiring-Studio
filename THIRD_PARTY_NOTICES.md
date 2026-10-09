# 第三方组件声明（Third-Party Notices）

本文件列出 AI Wiring Studio 分发时所依赖的第三方组件及其许可证。
所有列出的许可证均为宽松型（MIT / Apache-2.0 / ISC），允许再分发，但要求保留版权与许可声明。

> 若再分发，应随二进制或源码一并保留对应许可证原文。本项目已把各直接依赖的许可证全文收录在 [`LICENSES/`](./LICENSES/) 目录（`LICENSES/npm/` 与 `LICENSES/cargo/`），随仓库一并分发。
>
> 本项目自身源码采用 **PolyForm Noncommercial License 1.0.0（非商业许可）**，见仓库根目录 [`LICENSE`](./LICENSE)。本项目为**源码公开、仅限非商业使用**，**不属于**符合通常「开源」定义的项目；该非商业限制**仅约束本项目自有内容**，**不改变**下列第三方组件各自的授权。

## 运行时依赖（前端）

| 组件 | 版本 | 许可证 |
| --- | --- | --- |
| @radix-ui/react-dialog | 1.2.0 | MIT |
| @radix-ui/react-dropdown-menu | 2.1.25 | MIT |
| @radix-ui/react-tabs | 1.1.22 | MIT |
| @radix-ui/react-tooltip | 1.3.0 | MIT |
| @tauri-apps/api | 2.12.1 | Apache-2.0 OR MIT |
| @tauri-apps/plugin-dialog | 2.8.1 | MIT OR Apache-2.0 |
| @xyflow/react | 12.12.0 | MIT |
| lucide-react | 1.54.0 | ISC |
| react | 19.3.0 | MIT |
| react-dom | 19.3.0 | MIT |

## 运行时依赖（Rust / 原生）

| 组件 | 版本 | 许可证 |
| --- | --- | --- |
| tauri | 2.12.1 | Apache-2.0 OR MIT |
| tauri-plugin-dialog | 2.8.1 | Apache-2.0 OR MIT |
| dirs | 6.0.0 | MIT OR Apache-2.0 |
| serde | 1.0.229 | MIT OR Apache-2.0 |
| serde_json | 1.0.151 | MIT OR Apache-2.0 |
| keyring | 3.6.3 | MIT OR Apache-2.0 |
| ureq | 2.12.1 | MIT OR Apache-2.0 |

传递依赖以 `package-lock.json`（前端）与 `src-tauri/Cargo.lock`（Rust）为准；两个锁文件应保留在仓库中，以保证可复现构建。

## 版权声明

- **Tauri** — Copyright (c) 2013-2024 Tauri Programme within The Commons Conservancy. 双许可 Apache-2.0 / MIT。
- **Radix UI** — Copyright (c) WorkOS / Radix UI contributors。MIT。
- **React / React DOM** — Copyright (c) Meta Platforms, Inc. and affiliates。MIT。
- **React Flow (@xyflow/react)** — Copyright (c) webkid GmbH。MIT。
- **lucide-react / Lucide** — 图标库，ISC 许可证，Copyright (c) Lucide contributors。
- **dirs / serde / serde_json / keyring / ureq** — 各自作者，MIT OR Apache-2.0。

（各组件完整许可证原文以各自分发包内 `LICENSE` 文件为准。）

## 字体

界面字体使用 **系统字体**，不随应用分发、无需单独授权：

- 界面：`system-ui` → `Segoe UI Variable Text` / `Segoe UI` / `Microsoft YaHei UI`（Windows 系统字体）
- 等宽：`Cascadia Mono` / `Consolas`（Windows 系统字体）

## 图标与图片资源

- 应用图标 `src-tauri/icons/app.svg` 为本项目自绘资源，其余各尺寸栅格图标集由该源文件生成。
- 界面图标来自 **lucide-react**（ISC）。
- 本项目**不包含**任何第三方产品界面截图；设计阶段曾使用的内部参考截图**未被复制到本仓库**，不属于分发内容。

## 传递依赖

- 前端传递依赖以 `package-lock.json` 为准，Rust 传递依赖以 `src-tauri/Cargo.lock` 为准，两个锁文件均随仓库保留以保证可复现构建。
- 这些传递依赖绝大多数为 MIT 或 Apache-2.0（部分为 ISC / BSD / Zlib 等宽松许可）。
- 本仓库 `LICENSES/` 收录的是**直接依赖**的许可证全文；如需逐条列举全部传递依赖，可基于上述两个锁文件生成。

## 项目自身许可证

- **PolyForm Noncommercial License 1.0.0**（非商业），见仓库根目录 [`LICENSE`](./LICENSE)。
- 该非商业限制**仅约束本项目自有内容**，不改变上列第三方组件各自的授权。