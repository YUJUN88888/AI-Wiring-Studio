# 版本说明 — AI Wiring Studio v0.1.1

- 发布日期：2026-10-10
- 版本：`0.1.1`
- 平台：Windows x64（NSIS 安装包）
- 说明：**首个公开预览版**。此前发布的 `v0.1.0` 是同一预览版的早期构建，现已标记为 **Pre-release**，请下载下方的 `v0.1.1`。

## 下载与校验

| 文件 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| `AI-Wiring-Studio_0.1.1_x64-setup.exe` | 2939922 | `C2EC094341AC81BD5F3FD4D9860B55BCDCAF5051C3FB5FF4E99C1EA4AB0D7FC9` |

校验方法（PowerShell）：先进入你保存安装包的目录（浏览器默认在「下载」文件夹），再对**实际下载的文件**计算哈希：

```powershell
cd "$env:USERPROFILE\Downloads"
Get-FileHash -Algorithm SHA256 ".\AI-Wiring-Studio_0.1.1_x64-setup.exe"
```

把输出的 `Hash` 与上表比对；若不一致，说明文件在下载过程中损坏，请重新下载。若你保存到了别的目录，请把上面的路径替换为实际文件路径。

> 历史版本：`v0.1.0` 的安装包文件名为 `AI.Wiring.Studio_0.1.0_x64-setup.exe`（GitHub 会把上传文件名中的空格转成点号），其哈希与本文无关，请以 v0.1.0 Release 页面标注为准。

## 本版内容

v0.1.1 为**首个公开预览版**，包含：

- 画布式接线设计（元件摆放、引脚级连线、途经点、自动走线、缩放/网格）。
- 用户元件库与元件编辑器（引脚、电气参数、封装尺寸、元件图片），库独立于项目文件。
- 线路组织：用途分类、筛选、聚焦高亮、显示态持久化。
- 电气规则检查（ERC）：连接检查 + 电气规则检查（短路/电源冲突/过压/输出冲突/极性错误/电平不匹配等），结果四级分类，并如实声明检查范围。
- 接线代码（Wiring Code v1）导入/导出与缺失元件补查。
- `.aiws` 项目保存/打开（原子写入 + 自动备份）。
- 可选 AI 元件资料导入（文字/型号/网页/图片/接线代码补查）。
- 外观设置（强调色、画布/连线/元件/界面底色）与撤销/重做、成组、功能分区。

相对于 `v0.1.0`，本版主要修正了发布内容，并让安装包自带项目许可证：

- **安装包补充项目许可证**：NSIS 安装包现在会同时写入本项目 `LICENSE`（PolyForm Noncommercial License 1.0.0，含 `Required Notice:` 行）与 `THIRD_PARTY_NOTICES.md`、`LICENSES/`，确保许可原文随安装包分发（第三方组件授权保持不变）。
- 修正 README / 文档中与实现不符的表述（接线方案入口为文本接线代码，而非任意 JSON；密钥流向说明改为与实际实现一致）。
- 补充项目定位与开发背景、快速开始、示例接线代码、给 AI 的提示词、源码构建与测试说明、软件截图。

## 安装 / 卸载

- 安装：运行 `AI-Wiring-Studio_0.1.1_x64-setup.exe`，默认安装到当前用户目录，无需管理员权限。
- 卸载：使用系统「添加或删除程序」，或安装目录下的 `uninstall.exe`。
- 安装后可在安装目录看到随包的 `LICENSE`、`THIRD_PARTY_NOTICES.md` 与 `LICENSES/` 目录。

## 已知问题

1. **无边框窗口的贴靠布局浮层**：鼠标悬停在自绘的最大化按钮上不会弹出 Windows「贴靠布局」浮层。Win+方向键、拖拽贴边、双击标题栏最大化/还原、边缘缩放仍然可用。
2. **高 DPI 缩放观感**：125% / 150% 缩放下控件高度与图标尺寸尚未在真机全面确认，可能在个别档位偏大或偏小。
3. **AI 图片导入的坐标一致性**：若模型内部对图片降采样，返回的像素坐标可能与原图像素不一致；EXIF 方向尚未处理。建议使用真实 API Key 做一次人工验证，确认引脚落点。
4. **能力边界（非缺陷）**：软件不做电路仿真，也不做电流/供电容量预算；缺少已确认参数的量一律显示「未知」，不会给出猜测结论。
5. **原生文件对话框的自动化测试缺口**：文件选择器依赖 Windows 桌面自动化，未纳入自动化测试；相关流程以人工冒烟为准。

## 隐私要点

- API Key 在你输入时会**短暂经过前端输入框与内存**，随即通过 Tauri 调用交给 Rust 后端，保存成功后输入框被清空；密钥**持久化存储在 Windows 凭据管理器**，后续请求由 Rust 后端读取并直接发起。
- 密钥**不会**写入项目文件（`.aiws`）、用户元件库、日志，也不写入前端持久化存储，也不随安装包分发。
- 仅在主动使用 AI 导入时，才会向你配置的接口地址发送你提供的材料；其余功能完全离线可用。
- 详见仓库中的 [README.md](https://github.com/YUJUN88888/AI-Wiring-Studio/blob/v0.1.1/README.md) 与 [THIRD_PARTY_NOTICES.md](https://github.com/YUJUN88888/AI-Wiring-Studio/blob/v0.1.1/THIRD_PARTY_NOTICES.md)。

---

以下正文用于 GitHub Release 页面（已把相对链接改为指向 `v0.1.1` 标签的完整链接）：

> ## AI Wiring Studio v0.1.1（首个公开预览版）
>
> **AI Wiring Studio** 是一个面向**电子 DIY 初学者**的 Windows 可视化接线工具：把 AI 给出的接线方案转成直观的接线图，并按你实际购买的元件建立、调整自己的元件库。在画布上摆放元件并引脚对引脚连线，配合确定性的电气规则检查（ERC）。可选地用你自己的 AI 接口把文字、型号、网页或图片转成**候选**元件资料（需人工确认）。
>
> 🖥 **下载（Windows x64）**：`AI-Wiring-Studio_0.1.1_x64-setup.exe`
>
> **本版亮点**
> - 画布式接线设计与用户元件库（含元件图片、自定义引脚）
> - 确定性 ERC 检查 + 四级问题分类 + 明确的检查范围声明
> - 接线代码（Wiring Code v1）导入/导出
> - 可选的 AI 元件资料导入
> - 完全离线可用（AI 导入除外）
> - 安装包内随附项目 `LICENSE` 与第三方许可声明
>
> **安装**：下载 `AI-Wiring-Studio_0.1.1_x64-setup.exe` 并运行；默认装入当前用户目录，无需管理员权限。
>
> **校验值**
> - 文件：`AI-Wiring-Studio_0.1.1_x64-setup.exe`
> - 大小：2939922 字节
> - `SHA-256: C2EC094341AC81BD5F3FD4D9860B55BCDCAF5051C3FB5FF4E99C1EA4AB0D7FC9`
>
> **快速开始与示例接线代码**：见 [README](https://github.com/YUJUN88888/AI-Wiring-Studio/blob/v0.1.1/README.md#快速开始5-分钟生成一张接线图)。
>
> **已知问题**：见 [RELEASE_NOTES.md 的「已知问题」一节](https://github.com/YUJUN88888/AI-Wiring-Studio/blob/v0.1.1/RELEASE_NOTES.md)。
>
> **许可证**：**源码公开、仅限非商业使用** —— [PolyForm Noncommercial License 1.0.0](https://github.com/YUJUN88888/AI-Wiring-Studio/blob/v0.1.1/LICENSE)。第三方组件许可见 [THIRD_PARTY_NOTICES.md](https://github.com/YUJUN88888/AI-Wiring-Studio/blob/v0.1.1/THIRD_PARTY_NOTICES.md) 与 [`LICENSES/`](https://github.com/YUJUN88888/AI-Wiring-Studio/tree/v0.1.1/LICENSES)。
>
> > 注：本项目源码公开但**限制非商业使用**，不属于符合通常「开源」定义的项目；此限制不改变第三方组件各自的许可证。