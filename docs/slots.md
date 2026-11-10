# CI 槽位（Slot）标准 v1

base-ci 把每个仓库的 CI 检查切成**槽位（slot）**。槽位编号是跨仓库比较 CI 覆盖面的公共语言：一个仓库实现了哪些槽位、哪些不适用、哪些还欠着，都写在同一份声明里，由 Z1 收口校验。

- 实现位置：`quality.yml`（主战场）、`security.yml`、`workflow-lint.yml`、`test-job.yml`
- 校验入口：`quality.yml` 的 `Z1: Gate` 作业
- 消费仓库的接入方式：在调用 `quality.yml` 时传 `slot-status`

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

注意：strict 模式下被关闭的核心检查（`typecheck` / `lint` / `unit` / `security`）仍然需要在 `disabled-check-reasons` 里给出解释，两处原因是互补的：前者说明**槽位状态**，后者说明**为什么关掉这个检查**。

## 各槽位说明

### S1 类型检查

- **目的**：在测试之前用类型系统发现接口与数据结构的错误。
- **属于**：TypeScript `tsc --noEmit`、Swift 类型检查、Java/Kotlin 编译器类型检查。
- **不属于**：运行时断言、契约测试、依赖升级。
- **典型工具**：`tsc`、`swift build`、`javac`。
- **消费仓库插入方式**：`typecheck-command`（留空则用包管理器的 `run typecheck`），由 `typecheck: true` 启用。
- **na / todo 声明**：纯 JavaScript 仓库可写 `na` + “无类型来源”；尚未接入类型检查写 `todo` + 缺口说明。

### S2 Lint

- **目的**：统一代码风格与静态规则，阻止低级缺陷进入主干。
- **属于**：ESLint / Biome / Ruff / SwiftLint / golangci-lint，含格式检查。
- **不属于**：类型检查（S1）、自动修复提交、依赖漏洞扫描。
- **典型工具**：`eslint`、`biome check`、`ruff`、`swiftlint`。
- **消费仓库插入方式**：`lint-command`（留空则用 `run lint`），由 `lint: true` 启用。
- **na / todo 声明**：没有 lint 规则集写 `na` + 原因；规则已存在但未接入 CI 写 `todo` + 原因。

### S3 Workflow Lint

- **目的**：自检 CI/CD 配置本身：语法、不可变引用、权限、可选风格检查。
- **属于**：actionlint、YAML 解析、`nocoo/base-ci/*` 引用必须是完整 40 位 SHA、必需工作流存在性。
- **不属于**：应用代码 lint、业务测试、依赖漏洞扫描。
- **典型工具**：actionlint 1.7.12、yamllint（可选）。
- **消费仓库插入方式**：`workflow-lint: true` 启用；`workflow-lint-files`（留空检查全部工作流）、`workflow-lint-required-workflow`（要求出现某个可复用工作流）、`workflow-lint-yamllint`（额外跑 yamllint）。
- **na / todo 声明**：仓库没有自己的 workflow 时写 `na` + 原因；还没把 workflow 自检接进 CI 写 `todo` + 原因。
- **scope**：只有当它在 `quality.yml` 内部被调用时，S3 的结果才进入 Z1 校验；独立调用 `workflow-lint.yml` 的结果不在 Z1 的 scope 内。

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
- **不属于**：端到端测试（S2/S3 层级）、浏览器测试、性能基准。
- **典型工具**：Node test runner、bun test、Vitest、Swift XCTest、Go test。
- **消费仓库插入方式**：`unit: true` 启用，`test-command` 指定命令（留空用 `run test:coverage`），`coverage-path` 指向真实报告目录。
- **na / todo 声明**：没有可单测的代码写 `na` + 原因；只有集成测试写 `todo` + 原因。

### L1.5 Worker 运行时测试

- **目的**：在真正的 Worker 运行时里验证绑定、D1、KV、DO 等边缘能力。
- **属于**：workerd / vitest-pool-workers / miniflare、绑定模拟、迁移脚本在本地运行。
- **不属于**：普通 Node 单元测试（L1）、生产部署、真实生产数据。
- **典型工具**：`@cloudflare/vitest-pool-workers`、miniflare、wrangler dev。
- **消费仓库插入方式**：`worker: true` 启用，`worker-directory` 指定目录（默认 `worker`），`worker-command` 指定命令（留空用 `run test`），`worker-prepare-command` 指定准备步骤。
- **na / todo 声明**：不是 Worker 项目写 `na` + 原因；有 Worker 但没接运行时测试写 `todo` + 原因。

### L2 API E2E

- **目的**：起整个服务，从外部打 HTTP，验证跨模块集成。
- **属于**：真实进程启动、真实路由、鉴权与错误码、数据库集成。
- **不属于**：浏览器 UI（L3）、纯函数断言（L1）、性能压测。
- **典型工具**：Vitest + supertest、Playwright API、curl 冒烟脚本。
- **消费仓库插入方式**：`l2: true` 启用，`l2-command` 指定命令（留空用 `run test:api`）。
- **na / todo 声明**：没有对外 HTTP 接口写 `na` + 原因；接口存在但没接 CI 写 `todo` + 原因。

### L3 浏览器 E2E

- **目的**：在真实浏览器里验证页面行为与关键路径。
- **属于**：Playwright 场景、截图/trace 制品、多浏览器矩阵。
- **不属于**：HTTP 层断言（L2）、单元测试、视觉回归基线管理。
- **典型工具**：Playwright。
- **消费仓库插入方式**：`l3: true` 启用，`l3-command`（留空用 `run test:e2e:pw`）、`l3-browser`（默认 `chromium`）、`l3-browser-directory` 指定 Playwright 所在包。
- **na / todo 声明**：没有浏览器界面写 `na` + 原因；有界面但没接 E2E 写 `todo` + 原因。

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
- **scope**：Z1 只覆盖 `quality.yml` 内部调用的槽位作业。独立调用的 `workflow-lint.yml`、`security.yml`、`test-job.yml` 不在 Z1 的 scope 内，其结果由各自的调用方负责。

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
10. 所有 `impl` 槽位的 `tested-sha` 必须完全一致；不一致失败。
11. strict 模式至少要有一个 Z1 之外的 `impl` 槽位，否则 `tested-sha` 无从验证，失败。
12. `todo` 不阻塞 Z1 通过，但原因必须如实写出。

legacy 模式（`slot-status` 为空）下：

1. 每个槽位的状态由现有布尔输入推导：`typecheck`→S1、`lint`→S2、`workflow-lint`→S3、`security`→G1+G2、`build`→B1、`unit`→L1、`worker`→L1.5、`l2`→L2、`l3`→L3、`package-check`→P1。
2. 已启用的槽位必须成功并产出 `tested-sha`；未启用的槽位必须确实被跳过。
3. 承载 S1/S2/L1 的安装作业永远存在，必须成功。
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

`bun-quality.yml` 是旧版不可变接口，job 名保持原样，不受本次改名影响。

## 迁移步骤

1. **先升级引用**：把 `BASE_CI_SHA` 换成发布后的完整 40 位 SHA。行为不变——不传 `slot-status` 就是 legacy 模式。
2. **更新分支保护**：把 required check `Quality Gate Aggregate` 改成 `Z1: Gate`；`G2: Security` 需要拆成 `G1: Secret Scan` 和 `G2: Dependency Vulnerabilities` 两条（或只保留 Z1 为唯一必过项）。
3. **确认发布链路**：`deploy-worker.yml` / `deploy-docker.yml` 的来源证明校验仓库、工作流、分支、事件与精确 SHA，不依赖 job 名，因此无需改动。
4. **进入 strict 模式**：为每个 v1 槽位写 `slot-status` 声明。`na` 与 `todo` 都要写原因，`impl` 必须真的启用对应开关。
5. **逐步补齐**：`todo` 槽位落地后把对应开关打开，状态改成 `impl`。

## 取舍说明

### S1 / S2 / L1 合并为一个安装作业

S1、S2、L1 仍然共享 `L1: Unit Tests & Coverage` 这一个作业，原因是拆成三个作业会让每个仓库在一次 CI 里安装三遍依赖，显著增加 runner 占用与总时长，而三个检查本身都在同一个工作目录、同一次安装之后执行。

代价是槽位粒度落在 **step** 而不是 job。base-ci 用三个带编号的 step 补回来：

- step 名分别是 `S1: Typecheck`、`S2: Lint`、`L1: Unit Tests & Coverage`；
- 三个 step 都有 id（`s1-typecheck`、`s2-lint`、`l1-unit`），作业通过 job outputs 把每个 step 的 `outcome` 暴露给 Z1；
- Z1 因此能区分“S1 跑过且成功”“S2 被跳过”“L1 根本没执行”，而不是只看到一个笼统的作业结果。

也就是说：**槽位可辨识性与 Z1 精确校验不依赖拆 job**。

### S3 与 Z1 的 scope

- S3 通过 `quality.yml` 的 `workflow-lint: true` 启用时，其作业结果、step 结果与 `tested-sha` 都进入 Z1 的校验范围，声明 `impl` 就必须真的跑过。
- 直接调用 `workflow-lint.yml`（例如独立成一个 CI 作业）依然可用，但它不在 Z1 的 scope 内：Z1 只认识 `quality.yml` 内部编排的槽位。
- 同理，独立调用 `security.yml` 或 `test-job.yml` 的结果也不进入 Z1。

## 自测

槽位逻辑的本地测试位于 `.github/slots/`：

- `test_slot_gate.py` 从 `quality.yml` 中提取内联的 Z1 校验 Python 并执行，覆盖合法 strict、未知编号、非法状态、缺原因、impl 被跳过、na 却启用、意外跳过、缺声明、非法 JSON、SHA 不一致与 legacy 路径。
- `quality.workflow-contract.test.mjs` 断言各 workflow 的 job 名、input、output 契约。

两者都在 `self-test.yml` 中执行；`self-test-quality.yml` 同时保留一条 legacy 路径和一条 strict 路径的端到端调用。
