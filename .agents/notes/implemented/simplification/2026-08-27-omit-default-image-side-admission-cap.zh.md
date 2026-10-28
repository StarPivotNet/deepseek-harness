# Agent Note: 默认不再按边长拒绝源图

Status: implemented

[English](2026-08-27-omit-default-image-side-admission-cap.md) | 中文

## Problem

源图准入会拒绝宽或高超过默认单边像素上限的图片。普通截图和照片因此在 composer 里失败，并弹出点名该上限的文案；即便后续规范化已经限制存储长边，每条模型路由也会派生自己的请求版本。更早的 2000px 默认是为了让持久历史落在多图提供方边长限制内；独立规范化之后，这种拒绝不再保护后续请求，反而挡住普通大图。

## Decision

本地附件后端默认省略 `maxImageDimension`，除非部署显式设置。源图准入仍在配置的字节和解码像素上限内完整解码，再规范化存储长边。`IMAGE_DIMENSION_TOO_LARGE` 仍是配置上限失败：`read_image` 和 Web 文案在上限存在时点名单边像素，否则回退到通用发送失败或缩小后重试。`imageLimits` 投影和协议 schema 把该字段视为可选，客户端不得自行发明默认值。

本决策与 [统一规范化附件、请求版本与提供方文件](../../archived/feature/2026-08-20-unified-image-request-pipeline.md) 并列，后者仍拥有双版本图片路径。该笔记中的源图准入事实现已与本次省略对齐。

## Alternatives considered

**保留 8192px 默认值。** 这仍会在规范化之前拒绝全景和高分辨率源图，重新制造用户要求去掉的 composer 提示。

**删除可配置上限和错误码。** 仍需硬性边长拒绝的部署，以及行使该路径的 `read_image` 测试，会失去可命名的恢复路径。

**设置上限时在准入阶段缩小而不是拒绝。** 配置上限是显式拒绝。规范化已经缩小存储图像；把静默缩放混进拒绝路径会掩盖部署选择。

## Consequences

普通大图会进入规范化和后续请求投影，而不是在 composer 失败。仍需边长拒绝的部署必须显式设置 `maxImageDimension`。按旧默认准入的历史对象仍然有效；只有新的准入会改变。
