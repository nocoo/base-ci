# CI 槽位（Slot）标准 v1

base-ci 把每个仓库的 CI 检查切成**槽位（slot）**。槽位编号是跨仓库比较 CI 覆盖面的公共语言：一个仓库实现了哪些槽位、哪些不适用、哪些还欠着，都写在同一份声明里，由 Z1 收口校验。

- 实现位置：`quality.yml`（主战场，每个槽位一个顶层作业）
- 校验入口：`quality.yml` 的 `Z1: Gate` 作业
- 消费仓库的接入方式：在调用 `quality.yml` 时传 `slot-status`

`security.yml`、`workflow-lint.yml`、`test-job.yml` 仍然是独立可复用的工作流，供直接调用方使用；它们不在 `quality.yml` 的编排范围内，因此结果也不进入 Z1 的校验范围。

## 编号规范

1. **字母 = 类别**：`S` 静态分析、`G` 安全、`B` 构建、`L` 分层测试、`P` 发布物/包、`Z` 收口（Gate）。
2. **数字 = 类别内层级**：数字越大越重、越慢、越接近真实环境。
3. **编号一经发布永不改义、永不复用**。废弃的槽位标 `deprecated` 并保留编号，新槽位往后追加。
4. 需要插在两层之间时用小数补位（如 `L1.5`），不得重排既有编号。
5. **job 名统一为 `<编号>: <名称>`**，例如 `L2: API E2E`。跨仓库比较时只看编号部分。
6. **每个消费仓库必须为每个槽位声明状态**：`impl`（已实现）、`na`（不适用，必须写原因）、`todo`（缺失，必须写原因）。

## 槽位 v1

| 编号 | 槽位 | 目的 | quality.yml 开关 |
| --- | --- | --- | --- |
| S1 | 类型检查 | 静态类型错误 | `typecheck` |
| S2 | Lint | 代码风格与静态规则 | `lint` |
| S3 | Workflow Lint | CI/CD 配置自检、SHA pin、权限 | `workflow-lint` |
| G1 | 密钥扫描 | 仓库历史与工作区中的密钥 | `security`（与 G2 同时启用） |
| G2 | 依赖漏洞 | lockfile 中的已知漏洞 | `security`（与 G1 同时启用） |
| B1 | Build | 产物构建（原生 `xcodebuild` 也算） | `build` |
| L1 | 单测 + 覆盖率 | 单元测试与覆盖率 | `unit` |
| L1.5 | Worker 运行时测试 | workerd / vitest-pool-workers / miniflare | `worker` |
| L2 | API E2E | 起整个服务，从外部打 HTTP | `l2` |
| L3 | 浏览器 E2E | Playwright | `l3` |
| P1 | Package 检查 | `npm pack` 内容、exports/types/bin、ESM/CJS、下游冒烟 | `package-check` |
| Z1 | Gate 聚合 | 唯一必过检查：校验槽位声明与实际执行 | 恒为 impl |

## 规范检查名（canonical check names）

`quality.yml` 把每个槽位实现为一个**顶层作业**，作业名就是该槽位的规范检查名。GitHub 的检查名（check-run name）是 `<调用方作业> / <规范检查名>`（例如 `quality / G1: Secret Scan`）；调用方工作流名只是界面上的分组，不属于检查名的一部分。没有重复段、没有矩阵后缀。

| 槽位 | 规范检查名 | quality.yml 作业键 |
| --- | --- | --- |
| S1 | `S1: Typecheck` | `s1-typecheck` |
| S2 | `S2: Lint` | `s2-lint` |
| S3 | `S3: Workflow Lint` | `s3-workflow-lint` |
| G1 | `G1: Secret Scan` | `g1-secret-scan` |
| G2 | `G2: Dependency Vulnerabilities` | `g2-dependency-vulnerabilities` |
| B1 | `B1: Build` | `b1-build` |
| L1 | `L1: Unit Tests & Coverage` | `l1-unit-tests` |
| L1.5 | `L1.5: Worker Runtime Tests` | `l15-worker-runtime` |
| L2 | `L2: API E2E` | `l2-api-e2e` |
| L3 | `L3: Browser E2E` | `l3-browser-e2e` |
| P1 | `P1: Package Check` | `p1-package-check` |
| Z1 | `Z1: Gate` | `z1-gate` |

**分支保护只要求 `Z1: Gate`。** Z1 会校验声明与实际执行的一致性、每个启用槽位的成功状态与 SHA 一致性；把 S1/S2/G1/G2 等单槽位也设为必过项只会把一次失败变成多次失败。升级时先跑一次真实 CI，读出实际显示名，再改规则——**不要猜名字**。

### v2026.11 → v2026.12 检查名映射

v2026.11 里 `quality.yml` 调用 `security.yml`、`workflow-lint.yml` 和 `test-job.yml`，GitHub 会把调用方作业名和被调用作业名叠在一起。v2026.12 把它们全部内联为顶层作业：

| v2026.11 显示名 | v2026.12 显示名 |
| --- | --- |
| `quality / G1: Secret Scan / G1: Secret Scan` | `quality / G1: Secret Scan` |
| `quality / G2: Dependency Vulnerabilities / G2: Dependency Vulnerabilities` | `quality / G2: Dependency Vulnerabilities` |
| `quality / S3: Workflow Lint / S3: Workflow Lint` | `quality / S3: Workflow Lint` |
| `quality / L2: API E2E / L2: API E2E (bun on ubuntu-latest)` | `quality / L2: API E2E` |
| `quality / L3: Browser E2E / L3: Browser E2E (bun on ubuntu-latest)` | `quality / L3: Browser E2E` |
| `quality / L1.5: Worker Runtime Tests / L1.5: Worker Runtime Tests (...)` | `quality / L1.5: Worker Runtime Tests` |
| `quality / P1: Package Check / P1: Package Check (...)` | `quality / P1: Package Check` |
| `quality / L1: Unit Tests & Coverage`（S1/S2 只是 step） | `quality / S1: Typecheck` + `quality / S2: Lint` + `quality / L1: Unit Tests & Coverage` |


## 状态声明

### 格式

`slot-status` 是一个 JSON 对象，键是槽位编号，值是 `{"status": ..., "reason": ...}`：

```json
{
  "S1": {"status": "impl"},
  "S2": {"status": "impl"},
  "S3": {"status": "impl"},
  "G1": {"status": "impl"},
  "G2": {"status": "impl"},
  "B1": {"status": "todo", "reason": "产物构建尚未从应用代码里拆出来"},
  "L1": {"status": "impl"},
  "L1.5": {"status": "na", "reason": "本仓库不是 Worker 项目"},
  "L2": {"status": "impl"},
  "L3": {"status": "na", "reason": "没有浏览器界面"},
  "P1": {"status": "impl"},
  "Z1": {"status": "impl"}
}
```

- `impl`：已实现。`reason` 可选。
- `na`：不适用。**必须**写非空 `reason`，说明为什么这个槽位与本仓库无关。
- `todo`：尚未实现。**必须**写非空 `reason`，说明缺什么。`todo` 不阻塞 Z1，但原因必须如实写。

### 两种模式

| 模式 | 触发条件 | 行为 |
| --- | --- | --- |
| legacy | `slot-status` 为空字符串（默认） | 状态由现有布尔开关推导，行为与 v2026.10 完全一致；`disabled-check-reasons` 的既有约束不变 |
| strict | `slot-status` 非空 | 必须声明全部 v1 槽位并逐条校验 |

`{}` 是 strict 模式的空声明，会因为缺少槽位声明而失败，**不会**退化成 legacy 模式。

strict 模式的调用示例：

```yaml
jobs:
  quality:
    uses: nocoo/base-ci/.github/workflows/quality.yml@BASE_CI_SHA
    with:
      runtime-version: '1.4.2'
      # 每个 impl 槽位对应的开关仍然必须打开
      typecheck: true
      lint: true
      unit: true
      security: true
      workflow-lint: true
      l2: true
      package-check: true
      slot-status: >-
        {"S1": {"status": "impl"},
        "S2": {"status": "impl"},
        "S3": {"status": "impl"},
        "G1": {"status": "impl"},
        "G2": {"status": "impl"},
        "B1": {"status": "todo", "reason": "产物构建尚未拆分"},
        "L1": {"status": "impl"},
        "L1.5": {"status": "na", "reason": "本仓库不是 Worker 项目"},
        "L2": {"status": "impl"},
        "L3": {"status": "na", "reason": "没有浏览器界面"},
        "P1": {"status": "impl"},
        "Z1": {"status": "impl"}}
```

`slot-status` 只是**声明**，不会替你打开任何开关：每个 `impl` 槽位对应的布尔输入（`typecheck`、`lint`、`unit`、`security`、`workflow-lint`、`build`、`worker`、`l2`、`l3`、`package-check`）仍然要显式打开，否则 Z1 会以 “declared impl but its job or step is not enabled” 失败；反过来，声明为 `na` / `todo` 的槽位对应开关必须保持关闭。

注意：strict 模式下被关闭的核心检查（`typecheck` / `lint` / `unit` / `security`）仍然需要在 `disabled-check-reasons` 里给出解释，两处原因是互补的：前者说明**槽位状态**，后者说明**为什么关掉这个检查**。

## 各槽位说明

### S1 类型检查

- **目的**：在测试之前用类型系统发现接口与数据结构的错误。
- **属于**：TypeScript `tsc --noEmit`、Swift 类型检查、Java/Kotlin 编译器类型检查。
- **不属于**：运行时断言、契约测试、依赖升级。
- **典型工具**：`tsc`、`swift build`、`javac`。
- **消费仓库插入方式**：`typecheck-command`（留空则用包管理器的 `run typecheck`），由 `typecheck: true` 启用。
- **作业**：`S1: Typecheck` 是独立顶层作业，有自己的 checkout、安装、准备、命令与 SHA 输出；Z1 校验它的作业结果与 SHA。
- **na / todo 声明**：纯 JavaScript 仓库可写 `na` + “无类型来源”；尚未接入类型检查写 `todo` + 缺口说明。

### S2 Lint

- **目的**：统一代码风格与静态规则，阻止低级缺陷进入主干。
- **属于**：ESLint / Biome / Ruff / SwiftLint / golangci-lint，含格式检查。
- **不属于**：类型检查（S1）、自动修复提交、依赖漏洞扫描。
- **典型工具**：`eslint`、`biome check`、`ruff`、`swiftlint`。
- **消费仓库插入方式**：`lint-command`（留空则用 `run lint`），由 `lint: true` 启用。
- **作业**：`S2: Lint` 是独立顶层作业，与 S1 平行执行，有自己的 SHA 输出。
- **na / todo 声明**：没有 lint 规则集写 `na` + 原因；规则已存在但未接入 CI 写 `todo` + 原因。

### S3 Workflow Lint

- **目的**：自检 CI/CD 配置本身：语法、不可变引用、权限、可选风格检查。
- **属于**：actionlint、YAML 解析、`nocoo/base-ci/*` 引用必须是完整 40 位 SHA、必需工作流存在性。
- **不属于**：应用代码 lint、业务测试、依赖漏洞扫描。
- **典型工具**：actionlint 1.7.12、yamllint（可选）。
- **消费仓库插入方式**：`workflow-lint: true` 启用；`workflow-lint-files`（留空检查全部工作流）、`workflow-lint-required-workflow`（要求出现某个可复用工作流）、`workflow-lint-yamllint`（额外跑 yamllint）。
- **na / todo 声明**：仓库没有自己的 workflow 时写 `na` + 原因；还没把 workflow 自检接进 CI 写 `todo` + 原因。
- **scope**：S3 的逻辑内联在 `quality.yml` 的 `S3: Workflow Lint` 作业里，其结果与 `tested-sha` 进入 Z1 校验。独立调用 `workflow-lint.yml` 的结果不在 Z1 的 scope 内。Z1 读取的是 S3 作业的 `result` 与 `tested-sha`，不读取 S3 内部 step 的 `outcome`。

### G1 密钥扫描

- **目的**：阻止密钥、令牌、证书私钥进入仓库与历史。
- **属于**：工作区扫描、`scan-history: true` 的完整 Git 历史扫描、项目自有 `.gitleaks.toml` 规则。
- **不属于**：依赖漏洞（G2）、依赖更新、密钥轮换。
- **典型工具**：Gitleaks 8.30.1。
- **消费仓库插入方式**：`security: true` 同时启用 G1 与 G2；`gitleaks-config`、`gitleaks-ignore-path` 提供项目配置；`security-command` 在 G1 作业里执行一次项目自定义安全命令。
- **na / todo 声明**：无密钥面（纯公开文档仓库）写 `na` + 原因；还没接扫描器写 `todo` + 原因。

### G2 依赖漏洞

- **目的**：用 lockfile 找出已知漏洞的依赖版本。
- **属于**：多 lockfile 扫描、`.osv-scanner.toml` 配置、锁文件存在性校验。
- **不属于**：密钥扫描（G1）、自动升级依赖、许可证审计。
- **典型工具**：OSV Scanner 2.5.1。
- **消费仓库插入方式**：`security: true` 同时启用 G1 与 G2；`lockfiles` 指定扫描目标（留空按包管理器推断），`osv-config` 指定配置文件。
- **na / todo 声明**：仓库不依赖第三方包写 `na` + 原因；未接入扫描写 `todo` + 原因。

### B1 Build

- **目的**：产出可交付的构建物，验证构建链本身可用。
- **属于**：`npm run build`、打包、原生 `xcodebuild`、镜像构建前置步骤。
- **不属于**：单元测试、发布、部署。
- **典型工具**：打包器、esbuild、Rust/Swift 构建系统。
- **消费仓库插入方式**：`build: true` 启用，`build-command` 指定命令（留空用 `run build`）；产物用 `artifact-name` / `artifact-paths` 上传。
- **na / todo 声明**：没有需要构建的产物写 `na` + 原因；构建只在本地做写 `todo` + 原因。

### L1 单测 + 覆盖率

- **目的**：用最小粒度验证逻辑，并给出覆盖率证据。
- **属于**：单元测试、覆盖率报告、覆盖率路径校验。
- **不属于**：端到端测试（L2/L3 层级）、性能基准；共享 workflow 不统一规定覆盖率数值门槛，消费仓库在 `test-command` 内执行自己的覆盖率门槛。
- **典型工具**：Node test runner、bun test、Vitest、Swift XCTest、Go test。
- **消费仓库插入方式**：`unit: true` 启用，`test-command` 指定命令（留空用 `run test:coverage`），`coverage-path` 指向真实报告目录。
- **作业**：`L1: Unit Tests & Coverage` 是独立顶层作业。它**始终运行**（安装依赖并校验 `disabled-check-reasons`），单测 step 由 `unit` 开关控制：关闭时 step 被跳过，作业本身仍可成功。Z1 同时读取单测 step 的 outcome 和作业自身的状态。
- **na / todo 声明**：没有可单测的代码写 `na` + 原因；只有集成测试写 `todo` + 原因。

### L1.5 Worker 运行时测试

- **目的**：在真正的 Worker 运行时里验证绑定、D1、KV、DO 等边缘能力。
- **属于**：workerd / vitest-pool-workers / miniflare、绑定模拟、迁移脚本在本地运行。
- **不属于**：普通 Node 单元测试（L1）、生产部署、真实生产数据。
- **典型工具**：`@cloudflare/vitest-pool-workers`、miniflare、wrangler dev。
- **消费仓库插入方式**：`worker: true` 启用，`worker-directory` 指定目录（默认 `worker`），`worker-command` 指定命令（留空用 `run test`），`worker-prepare-command` 指定准备步骤。
- **na / todo 声明**：不是 Worker 项目写 `na` + 原因；有 Worker 但没接运行时测试写 `todo` + 原因。
- **边界**：**只部署静态资源的 Worker（无 Workers 运行时套件）写 `na`**，理由写清“没有 Workers 运行时测试套件”；用 Playwright 驱动 `wrangler dev` 跑浏览器用例属于 **L3**，不是 L1.5。

### L2 API E2E

- **目的**：起整个服务，从外部打 HTTP，验证跨模块集成。
- **属于**：真实进程启动、真实路由、鉴权与错误码、数据库集成。
- **不属于**：浏览器 UI（L3）、纯函数断言（L1）、性能压测。
- **典型工具**：Vitest + supertest、Playwright API、curl 冒烟脚本。
- **消费仓库插入方式**：`l2: true` 启用，`l2-command` 指定命令（留空用 `run test:api`）。
- **证据留存**：`l2-artifact-name`、`l2-artifact-path`（可多行）、`l2-artifact-retention-days`（默认 7）。上传使用 `if: always()`，**即使测试失败也会保留证据**；请求了缺失的证据文件会让作业失败。
- **na / todo 声明**：没有对外 HTTP 接口写 `na` + 原因；接口存在但没接 CI 写 `todo` + 原因。
- **边界**：发布后的 `verify-command` 冒烟（例如 `curl https://example.com/api/live`）属于**部署验证**，**不是 L2**；L2 是在 CI 里跑服务并从外部打 HTTP。

### L3 浏览器 E2E

- **目的**：在真实浏览器里验证页面行为与关键路径。
- **属于**：Playwright 场景、截图/trace 制品、多浏览器矩阵。
- **不属于**：HTTP 层断言（L2）、单元测试、视觉回归基线管理。
- **典型工具**：Playwright。
- **消费仓库插入方式**：`l3: true` 启用，`l3-command`（留空用 `run test:e2e:pw`）、`l3-browsers`（空格分隔的浏览器列表）、`l3-browser`（单个浏览器，默认 `chromium`）、`l3-browser-directory` 指定 Playwright 所在包。
- **准备步骤**：`l3-prepare-command` 单独指定 L3 的准备命令（例如先构建再跑 E2E）；留空时回退到共享的 `prepare-command`。
- **证据留存**：`l3-artifact-name`、`l3-artifact-path`（可多行）、`l3-artifact-retention-days`（默认 7）。上传使用 `if: always()`，失败也保留证据。
- **na / todo 声明**：没有浏览器界面写 `na` + 原因；有界面但没接 E2E 写 `todo` + 原因。
- **边界**：用 Playwright 驱动 `wrangler dev` 跑浏览器场景属于 **L3**；在 workerd / miniflare 里验证绑定与 KV 属于 **L1.5**。

多浏览器 + 准备命令 + 证据上传的调用示例：

```yaml
jobs:
  quality:
    uses: nocoo/base-ci/.github/workflows/quality.yml@BASE_CI_SHA
    with:
      l3: true
      l3-browsers: "chromium webkit"
      l3-prepare-command: "bun run build"
      l3-command: "bun run test:e2e:pw"
      l3-artifact-name: "playwright-report"
      l3-artifact-path: |
        playwright-report/
        test-results/
      l3-artifact-retention-days: 7
```

浏览器列表按空白拆成多个参数传给包管理器的 `playwright install --with-deps`，不会被当成单个带空格的浏览器名。旧的 `l3-browser` 仍然可用；`l3-browsers` 非空时优先使用 `l3-browsers`。

### P1 Package 检查

- **目的**：保证发布的包能被下游正确消费。
- **属于**：`npm pack` 内容、exports/types/bin 解析、ESM/CJS 兼容、下游安装冒烟。
- **不属于**：发布动作本身、镜像构建、端到端业务测试。
- **典型工具**：publint、arethetypeswrong、attw、下游 fixture 安装。
- **消费仓库插入方式**：`package-check: true` 启用，`package-command` 指定命令（留空用 `run ci:package`）。
- **na / todo 声明**：不发布 npm 包写 `na` + 原因；要发布但还没写检查写 `todo` + 原因。

### Z1 Gate 聚合

- **目的**：唯一的必过检查。它把“声明”与“实际执行”对齐，防止假绿。
- **属于**：校验槽位声明、校验每个启用槽位真的跑过并成功、校验所有 impl 槽位 SHA 一致、输出 `tested-sha`。
- **不属于**：业务逻辑判断、覆盖率门槛数值、发布与部署。
- **典型工具**：`quality.yml` 内联的 Python 校验（不新增 composite action，避免内部 SHA 重钉）。
- **消费仓库插入方式**：不需要额外输入；它是 `quality.yml` 永远存在的作业。
- **na / todo 声明**：不允许。`Z1` 只能是 `impl`。
- **scope**：Z1 只覆盖 `quality.yml` 内部编排的槽位作业。独立调用的 `workflow-lint.yml`、`security.yml`、`test-job.yml` 不在 Z1 的 scope 内，其结果由各自的调用方负责。

## Z1 校验规则

strict 模式（`slot-status` 非空）下，Z1 按顺序执行：

1. `slot-status` 必须是合法 JSON 对象；解析失败直接失败。`{}` 视为 strict 空声明并失败。
2. 必须声明全部 v1 槽位（S1、S2、S3、G1、G2、B1、L1、L1.5、L2、L3、P1、Z1）；缺任意一个失败。
3. 出现未知编号失败。
4. `status` 只能是 `impl` / `na` / `todo`；其他值失败。
5. `na` 与 `todo` 必须有非空 `reason`；缺失或只有空白失败。
6. `Z1` 只能是 `impl`。
7. 声明 `impl` 的槽位，其对应 job / step 必须**已启用**、**成功**、并且产出 `tested-sha`；未启用、被跳过或失败都失败。
8. 声明 `na` / `todo` 的槽位，其对应 job / step 必须**未启用且确实被跳过**；实际启用或实际跑过都失败。
9. “已启用却被跳过”属于意外跳过，失败。
10. 所有 `impl` 槽位的 `tested-sha` 必须完全一致；不一致失败。`L1: Unit Tests & Coverage` 作业本身必须成功（即使单测 step 被跳过），并与其他 SHA 一致。
11. strict 模式至少要有一个 Z1 之外的 `impl` 槽位，否则 `tested-sha` 无从验证，失败。
12. `todo` 不阻塞 Z1 通过，但原因必须如实写出。

legacy 模式（`slot-status` 为空）下：

1. 每个槽位的状态由现有布尔输入推导：`typecheck`→S1、`lint`→S2、`workflow-lint`→S3、`security`→G1+G2、`build`→B1、`unit`→L1、`worker`→L1.5、`l2`→L2、`l3`→L3、`package-check`→P1。
2. 已启用的槽位必须成功并产出 `tested-sha`；未启用的槽位必须确实被跳过。
3. `L1: Unit Tests & Coverage` 作业永远运行，必须成功；它的 SHA 参与 SHA 一致性校验。
4. `disabled-check-reasons` 对被关闭的 `typecheck` / `lint` / `unit` / `security` 的解释要求不变。
5. 所有被验证的 SHA 必须一致，`tested-sha` 只在此时输出。

## 旧 input 与旧 job 名映射

旧 input（继续可用，行为不变）：

| 旧 input | 对应槽位 |
| --- | --- |
| `typecheck` | S1 |
| `lint` | S2 |
| `security` | G1 + G2 |
| `unit` | L1 |
| `build` | B1 |
| `worker` | L1.5 |
| `l2` | L2 |
| `l3` | L3 |
| `package-check` | P1 |
| `disabled-check-reasons` | legacy 模式下仍然生效 |
| `slot-status`（新增） | 全部 v1 槽位 |

旧 job 名 → 新 job 名（**breaking**，影响分支保护的 required check）：

| 旧 job 名 | 新 job 名 |
| --- | --- |
| `L1: Quality & Tests` | `L1: Unit Tests & Coverage` |
| `G2: Security` | `G1: Secret Scan` + `G2: Dependency Vulnerabilities` |
| `Build` | `B1: Build` |
| `Worker Tests` | `L1.5: Worker Runtime Tests` |
| `Package Check` | `P1: Package Check` |
| `Quality Gate Aggregate` | `Z1: Gate` |
| `L2: API E2E` | 不变 |
| `L3: Browser E2E` | 不变 |

v2026.11 里 `quality.yml` 还会嵌套调用 `test-job.yml`，显示名因此多了一层。v2026.12 把槽位全部内联为顶层作业，这层嵌套不再出现：

| 位置 | v2026.11 显示名 | v2026.12 显示名 |
| --- | --- | --- |
| `quality.yml` → `test-job.yml`（L2） | `L2: API E2E / L2: API E2E (bun on ubuntu-latest)` | `L2: API E2E` |
| `quality.yml` → `test-job.yml`（L3） | `L3: Browser E2E / L3: Browser E2E (bun on ubuntu-latest)` | `L3: Browser E2E` |
| `quality.yml` → `test-job.yml`（L1.5） | `L1.5: Worker Runtime Tests / L1.5: Worker Runtime Tests (...)` | `L1.5: Worker Runtime Tests` |
| `quality.yml` → `test-job.yml`（P1） | `P1: Package Check / P1: Package Check (...)` | `P1: Package Check` |
| `quality.yml` → `security.yml`（G1） | `G1: Secret Scan / G1: Secret Scan` | `G1: Secret Scan` |
| `quality.yml` → `security.yml`（G2） | `G2: Dependency Vulnerabilities / G2: Dependency Vulnerabilities` | `G2: Dependency Vulnerabilities` |
| `quality.yml` → `workflow-lint.yml`（S3） | `S3: Workflow Lint / S3: Workflow Lint` | `S3: Workflow Lint` |

独立调用方不受影响，它们的作业名保持不变：

| 位置 | 显示名 |
| --- | --- |
| 独立调用 `security.yml` | `G1 + G2: Security Scan`（只扫密钥时为 `G1: Secret Scan`，只扫依赖时为 `G2: Dependency Vulnerabilities`，只跑自定义命令时为 `G1 + G2: Security Gate (custom command)`） |
| 独立调用 `workflow-lint.yml` | `S3: Workflow Lint` |
| 独立调用 `test-job.yml` | `Test (bun on ubuntu-latest)`（不传 `slot-label` 即保持旧名） |

`bun-quality.yml` 是旧版不可变接口，job 名保持原样，不受本次改名影响。

**不要猜 required check 的名字。** GitHub 的检查名包含调用方作业前缀（形如 `quality / Z1: Gate`），真实名称取决于消费仓库的调用方式。升级后先跑一次真实 CI，从运行页面或 `gh api` 读取实际显示名，再改分支保护规则。

## 迁移步骤

1. **先升级引用**：把 `BASE_CI_SHA` 换成发布后的完整 40 位 SHA。行为不变——不传 `slot-status` 就是 legacy 模式。
2. **更新分支保护**：推荐只保留 `Z1: Gate` 一条必过项（它已经校验声明与实际执行、每个启用槽位的成功与 SHA 一致）。如果仓库习惯逐个槽位必过，则使用新的规范检查名（`S1: Typecheck`、`S2: Lint`、`S3: Workflow Lint`、`G1: Secret Scan`、`G2: Dependency Vulnerabilities`、`B1: Build`、`L1: Unit Tests & Coverage`、`L1.5: Worker Runtime Tests`、`L2: API E2E`、`L3: Browser E2E`、`P1: Package Check`）。检查名带调用方作业前缀（`quality / Z1: Gate`），**升级后先跑一次真实 CI 读取实际名称再改规则**。
3. **确认发布链路**：`deploy-worker.yml` / `deploy-docker.yml` 的来源证明校验仓库、工作流、分支、事件与精确 SHA，不依赖 job 名，因此无需改动。
4. **进入 strict 模式**：为每个 v1 槽位写 `slot-status` 声明。`na` 与 `todo` 都要写原因，`impl` 必须真的启用对应开关。
5. **逐步补齐**：`todo` 槽位落地后把对应开关打开，状态改成 `impl`。

## 取舍说明

### S1 / S2 拆成独立作业

S1、S2、L1 现在是三个平行作业（`S1: Typecheck`、`S2: Lint`、`L1: Unit Tests & Coverage`）。代价是一次 CI 里会安装三遍依赖，runner 占用与总时长上升；收益是每个槽位都有自己的检查名与耗时，Z1 也能直接校验作业结果而不是 step outcome。三个作业并行执行，总时长接近最慢的那个。

`L1: Unit Tests & Coverage` 作业**始终运行**，因为它承载了 `disabled-check-reasons` 的校验（关闭 typecheck / lint / unit / security 必须给出解释）。单测本身是作业内的一个 step，由 `unit` 开关控制：

- step id 是 `l1-unit`，作业输出 `l1-unit`（step outcome）与 `l1-job-status`（作业状态）；
- `unit: false` 时 step 被跳过（outcome 为 `skipped`），作业本身仍可成功；
- Z1 用 step outcome 判定槽位状态，用作业状态判定这一轮能不能算数：L1 作业失败（包括 `disabled-check-reasons` 校验失败）时 Z1 直接失败。

### 内联槽位逻辑，不嵌套可复用工作流

v2026.11 里 `quality.yml` 通过 `uses:` 调用 `security.yml`、`workflow-lint.yml` 和 `test-job.yml`。GitHub 会把调用方作业名与被调用作业名叠成两段显示名（`G1: Secret Scan / G1: Secret Scan`），而且多一层嵌套就多一层失败传播。v2026.12 把这三个工作流的槽位逻辑内联为 `quality.yml` 的顶层作业：

- 每个槽位只渲染一个检查名，名字就是规范检查名；
- 三个独立工作流本身保持不变，直接调用它们的消费仓库不受影响；
- 不新增 composite action，避免内部引用需要重新钉 SHA。

### S3 与 Z1 的 scope

- S3 通过 `quality.yml` 的 `workflow-lint: true` 启用时，其作业结果与 `tested-sha` 都进入 Z1 的校验范围；Z1 不读取 S3 内部 step 的 `outcome`。声明 `impl` 就必须真的跑过。
- 直接调用 `workflow-lint.yml`（例如独立成一个 CI 作业）依然可用，但它不在 Z1 的 scope 内：Z1 只认识 `quality.yml` 内部编排的槽位。
- 同理，独立调用 `security.yml` 或 `test-job.yml` 的结果也不进入 Z1。

## 自测

槽位逻辑的本地测试位于 `.github/slots/`：

- `test_slot_gate.py` 从 `quality.yml` 中提取内联的 Z1 校验 Python 并执行，覆盖合法 strict、未知编号、非法状态、缺原因、impl 被跳过、na 却启用、意外跳过、缺声明、非法 JSON、SHA 不一致、L1 作业失败与 legacy 路径。
- `quality.workflow-contract.test.mjs` 断言各 workflow 的 job 名、input、output 契约，并证明 `quality.yml` 不再嵌套调用其他可复用工作流、每个规范检查名只出现一次、S1/S2 是独立作业、L3/L2 的新输入已接线。

两者都在 `self-test.yml` 中执行；`self-test-quality.yml` 同时保留一条 legacy 路径、一条 strict 路径和一条 L3 多浏览器 + 证据上传路径的端到端调用。
