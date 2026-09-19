<h1 align="center">base-ci</h1>
<p align="center">可复用的 GitHub Actions 检查与可追溯发布流程。</p>
<p align="center"><a href="docs/README.en.md">English</a></p>

## 这是什么

为 nocoo 项目共享 JavaScript 检查、原生测试、安全扫描和发布来源验证。消费项目保留触发条件、项目命令与部署环境，共享流程处理工具安装、检查、制品和来源校验。

## 功能

| 工作流 | 用途 |
| --- | --- |
| `quality.yml` | Bun / npm / pnpm 类型、lint、单元、安全及可选构建与测试 |
| `test-job.yml` | 单条测试命令、调用方矩阵、原生运行时和浏览器 |
| `security.yml` | 多 lockfile 依赖检查、目录或完整 Git 历史扫描 |
| `workflow-lint.yml` | actionlint、YAML 与不可变引用检查 |
| `deploy-worker.yml` | 校验 CI 来源后构建、迁移和部署 Worker |
| `deploy-docker.yml` | 同一提交的镜像摘要、Compose 发布与健康检查 |

## 使用

在消费仓库创建 `.github/workflows/ci.yml`。将 `BASE_CI_SHA` 替换为已审查版本的完整 40 位提交 SHA，不能直接使用占位符：

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  quality:
    uses: nocoo/base-ci/.github/workflows/quality.yml@BASE_CI_SHA
    with:
      runtime-version: '1.4.2'
      install-policy: blocked
      coverage-path: coverage
```

默认启用类型、lint、单元与安全检查，可选检查需显式开启。命令默认采用对应包管理器的项目脚本；先确认消费仓库存在这些脚本。`coverage-path` 必须指向真实报告。输入、原生任务、Worker 和 Docker 发布示例见[集成说明](docs/workflows.md)。

## 开发

仓库没有根 package 安装或 bundler。辅助实现位于 `.github/actions/`，工作流在 `.github/workflows/`，测试项目在 `.github/fixtures/`。本地需要 Node.js、Python 3 和 actionlint。

引用固定完整 SHA；发布保持不可变标签。生产凭据仅进入部署环境，测试只传入具名测试凭据。来源验证要求仓库、工作流、分支、成功结果与提交一致；缺失证据不回退到最新成功运行。

## 测试

```sh
actionlint -shellcheck= -pyflakes=
node --test .github/actions/docker-manifest/index.test.mjs
node --test .github/actions/release-source/resolve.test.mjs .github/actions/release-source/workflow-contract.test.mjs
python3 -m unittest discover -s .github/actions/setup-js -p 'test_*.py'
python3 -m unittest discover -s .github/actions/configure-env -p 'test_*.py'
```

GitHub 自测覆盖真实依赖安装、生命周期策略、扫描器、SSH 和发布来源。包管理器安装与 SSH runner 配置测试在一次性 CI runner 中运行，不在日常工作机执行。实际生产发布的端到端证据由消费项目提供。

## 技术栈

| 技术 | 用途 |
| --- | --- |
| GitHub Actions / YAML | 可复用工作流与 composite actions |
| Python、JavaScript、Shell | 安装、环境、来源与部署辅助 |
| Node test runner、unittest | 辅助逻辑验证 |
| actionlint、Gitleaks、OSV Scanner | 工作流、秘密与依赖检查 |

## 文档

- [完整工作流集成说明](docs/workflows.md)。
- [工作流输入定义](.github/workflows/)。
- [SSH 部署 action](.github/actions/ssh-deploy/README.md)。
- [维护说明](CLAUDE.md)。

## 许可证

仓库未提供项目级 LICENSE；外部工具保留各自许可。
