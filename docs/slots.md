# quality.yml — System0 槽位实现说明

槽位定义、用途、约束与阶段目标仅以 [System0 quality skill](https://github.com/nocoo/workflow/blob/main/agents/skills/system0-quality/SKILL.md)（当前 v1.3.0）为准。本文只描述 **base-ci 如何在 `quality.yml` 中接线**，不重复 skill 中的语义。

- 编排入口：[`.github/workflows/quality.yml`](../.github/workflows/quality.yml)
- Z1 校验：同一文件内 `z1-gate` 作业（内联 Python，见 `# SLOT_GATE_PYTHON_BEGIN`）
- 独立工作流：`security.yml`、`workflow-lint.yml`、`test-job.yml` 仍可直接调用，但不在 `quality.yml` 的 Z1 范围内

## 规范检查名与作业键

每个槽位是 **顶层作业**，GitHub 检查名为 `<调用方作业显示名> / <ID>: <Name>`。消费方调用作业键应为 `quality`，且不要设置与之冲突的 `name:`，以便分支保护只需 **`quality / Z1: Gate`**。

| ID | 作业键 | 检查名（规范后缀） | 主要输入（启用） |
| --- | --- | --- | --- |
| S1 | `s1-typecheck` | `S1: Types` | `typecheck` |
| S2 | `s2-lint` | `S2: Lint` | `lint` |
| S3 | `s3-workflow-lint` | `S3: Workflow` | `workflow-lint` |
| G1 | `g1-secret-scan` | `G1: Secrets` | `security`（与 G2 同开） |
| G2 | `g2-dependency-vulnerabilities` | `G2: Dependencies` | `security` |
| B1 | `b1-build` | `B1: Build` | `build` |
| L1 | `l1-unit-tests` | `L1: Unit` | `unit`（作业始终运行以校验 `disabled-check-reasons`） |
| L2 | `l2-runtime` | `L2: Runtime` | `l2-runtime` 或已弃用 `worker` |
| L3 | `l3-integration` | `L3: Integration` | `l3-integration` 或已弃用 `l2` |
| L4 | `l4-e2e` | `L4: E2E` | `l4` 或已弃用 `l3`；可选 Playwright（`l4-browsers` / `l3-browsers`） |
| P1 | `p1-package-check` | `P1: Package` | `package-check` |
| Z1 | `z1-gate` | `Z1: Gate` | 恒运行 |

G1 在 CI 中对检出内容执行 `gitleaks detect --no-git`。G2 扫描调用方传入的 lockfile 列表（默认由 `setup-js` 所在目录解析）。

## `slot-status` 格式

严格模式（非空 `slot-status`）要求 **恰好 12 个键**：`S1` … `P1` 与 `Z1`。每个值为对象：

```json
{"status": "impl|na|todo", "reason": "na/todo 时必填非空字符串"}
```

- `impl`：对应布尔输入必须打开，作业/步骤须成功并上报相同 `tested-sha`
- `na` / `todo`：对应输入必须关闭，作业须 `skipped`
- `Z1` 必须为 `impl`
- 空 `slot-status`：沿用旧版布尔推导路径（legacy）

### 已弃用 slot-status 键

| 旧键 | 处理 |
| --- | --- |
| `L1.5` | **失败**，错误信息指向 `L2`（Runtime）与 `worker` / `l2-runtime` 输入 |

`L2` / `L3` 在 v2026.13 起含义已与 skill 对齐（Runtime / Integration）；请在声明与理由中使用新语义。旧版「API E2E / Browser E2E」分别对应现在的 **L3** 与 **L4** 输入别名（`l2` / `l3`）。

## v1 槽位 → System0（v2026.13）迁移

| v2026.12 槽位 / 检查名 | v2026.13 ID | 检查名 | 启用输入 |
| --- | --- | --- | --- |
| L1.5 Worker Runtime | L2 | `L2: Runtime` | `worker` → 首选 `l2-runtime` |
| L2 API E2E | L3 | `L3: Integration` | `l2` → 首选 `l3-integration` |
| L3 Browser E2E | L4 | `L4: E2E` | `l3` → 首选 `l4`；浏览器安装可选 |
| S1 Typecheck | S1 | `S1: Types` | `typecheck` |
| S3 Workflow Lint | S3 | `S3: Workflow` | `workflow-lint` |
| G1 Secret Scan | G1 | `G1: Secrets` | `security` |
| G2 Dependency Vulnerabilities | G2 | `G2: Dependencies` | `security` |
| L1 Unit Tests & Coverage | L1 | `L1: Unit` | `unit` |
| P1 Package Check | P1 | `P1: Package` | `package-check` |

## Z1 汇总表

`Z1: Gate` 在通过校验后向 **Step summary** 写入 Markdown 表：各槽位 status、reason、result、耗时（从当前 workflow run 的 GitHub API 读取作业时间），以及 workflow 总耗时相对 **5 分钟目标 / 10 分钟参考上限**（与 skill 中 CI 阶段目标一致）。

## L4 通用命令与 Playwright

- 仅设置 `l4: true` 与 `l4-command`（或弃用别名 `l3` + `l3-command`）时 **不安装** Playwright。
- 当 `l4-browsers`、`l3-browsers`、`l4-browser` 或 `l3-browser` 非空时，安装对应浏览器后再执行 E2E 命令。
- 证据工件：`l4-artifact-*`（或弃用 `l3-artifact-*`）。

## 原生（macOS）骨架

需要非 `ubuntu-latest` runner 的仓库仍使用仓库内 `workflow_call` 工作流；作业 **显示名** 须与上表检查名后缀一致，以便 `quality / <ID>: <Name>` 对齐。详见 skill 与历史消费方范例（meowth、showtime 等）。

## 发布来源证明

`release-source` 在证明 workflow/run/SHA 之后，默认还要求同一 SHA 上存在成功的 **`quality / Z1: Gate`** 检查（可通过 `required-quality-check` / `require-quality-check` 覆盖）。缺少证据时失败，不回退到“最新绿色”。
