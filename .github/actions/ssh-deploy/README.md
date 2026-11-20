# ssh-deploy

通过 SSH 在远程服务器执行部署脚本。零第三方依赖，纯 OpenSSH + bash 实现，作为
`appleboy/ssh-action@v1` 的内部替代品，消除单点供应链风险。

## 用法

```yaml
- name: Deploy to production server
  uses: nocoo/base-ci/.github/actions/ssh-deploy@<sha>  # v2026.5
  with:
    host: ${{ secrets.VPS_HOST }}
    user: ${{ secrets.VPS_USER }}
    port: ${{ secrets.VPS_PORT }}
    key:  ${{ secrets.VPS_SSH_KEY }}
    envs: IMAGE_SHA
    script: |
      set -euo pipefail
      cd /opt/ellie
      echo "${{ secrets.GHCR_PULL_TOKEN }}" | docker login ghcr.io \
        -u "${{ secrets.GHCR_PULL_USER }}" --password-stdin
      docker compose pull web admin
      docker compose up -d --no-deps web admin
  env:
    IMAGE_SHA: ${{ steps.sha.outputs.value }}
```

## Inputs

| input         | required | default | 说明                                                                 |
| ------------- | -------- | ------- | -------------------------------------------------------------------- |
| `host`        | ✅       | —       | SSH 目标主机                                                         |
| `user`        | ✅       | —       | SSH 用户名                                                           |
| `port`        | ❌       | `22`    | SSH 端口                                                             |
| `key`         | ✅       | —       | SSH 私钥（整段 PEM，含 BEGIN/END 行）                                |
| `envs`        | ❌       | `""`    | 空格分隔的变量名列表，从 runner 环境带到远端                         |
| `script`      | ✅       | —       | 在远端执行的 bash 脚本（多行）                                       |
| `known-hosts` | ❌       | `""`    | 预置 host key 列表，留空则现场用 `ssh-keyscan` 抓                    |

## 与 `appleboy/ssh-action@v1` 兼容性对照

| 字段          | appleboy/ssh-action     | ssh-deploy            | 说明                                  |
| ------------- | ----------------------- | --------------------- | ------------------------------------- |
| `host`        | `host`                  | `host`                | 等价                                  |
| `username`    | `username`              | `user`                | **重命名**：迁移时改成 `user:`        |
| `port`        | `port` (default `22`)   | `port` (default `22`) | 等价                                  |
| `key`         | `key`                   | `key`                 | 等价                                  |
| `envs`        | `envs: "A B"`           | `envs: "A B"`         | 等价（空格分隔变量名）                |
| `script`      | `script: \|`            | `script: \|`          | 等价                                  |
| host key 校验 | 默认跳过（`-o StrictHostKeyChecking=no`） | 本次调用专属的临时 known_hosts + `StrictHostKeyChecking=yes` | 只信任本次调用提供的（或现场 keyscan 到的）host key；共享的 `~/.ssh/known_hosts` 不读不写 |
| 远端环境变量  | 通过 ssh `SendEnv`/server `AcceptEnv`     | runner 端拼 `export VAR=...` 行随脚本走 `bash -s` stdin | 不依赖 sshd 配置；登录 shell 不参与 env 值解析，字节级保真 |
| 命令注入      | input 字符串拼接到远端                    | `env:` 块隔离 + here-string 灌 stdin | 更安全，避免 GHA 表达式注入           |

## 安全细节

- 所有敏感 input（`key` / `script` / `envs`）通过 step 的 `env:` 块传递，**绝不**在
  `run:` 里直接 `${{ inputs.x }}` 字符串插值——避免 GHA expression injection。
- 远端调用串就是固定字面 `bash -s`，**没有任何用户输入参与远端命令拼接**。`envs`
  列出的变量在 runner 端用 `printf '%q'` 做 bash quote 后，以 `export VAR=...`
  形式拼到用户脚本前面，整体作为 here-string 灌给远端 `bash -s` 的 stdin——
  远端用户登录 shell（可能是 dash/sh/zsh）完全不参与 env 值解析，因此可正确
  保留 newline / tab / 引号 等任意字节。
- `BatchMode=yes` 防止远端 prompt 卡死 runner；`ServerAliveInterval=30` 防长部署被
  中间设备断 idle 连接；`ConnectTimeout=30` 让不可达的主机快速失败而不是挂住。
- host key 一律按 `StrictHostKeyChecking=yes` 校验，且只信任本次调用的材料：
  - 传了 `known-hosts:` → 只用这份材料；
  - 没传 → 现场 `ssh-keyscan -T 10` 抓到的 key；
  - 两种来源都拿不到 host key 时 action 直接失败并给出 `::error::`，不会带着空
    known_hosts 去连接。
- host key 写在**本次调用专属的临时文件**（`mktemp "$RUNNER_TEMP/ssh_deploy_known_hosts.XXXXXX"`，
  `UserKnownHostsFile`，`GlobalKnownHostsFile=/dev/null`）：共享的 `~/.ssh/known_hosts`
  既不读也不写，别的调用留下的旧条目不会带进本次部署。
- 私钥同样只落在本次调用专属的临时文件（`mktemp "$RUNNER_TEMP/ssh_deploy_key.XXXXXX"`，
  权限 600），不写 `~/.ssh`；两个文件在 cleanup step 用 `if: always()` 删除，不会泄露到
  后续 step。

## host key 校验：默认现场扫描 vs 固定 known-hosts

这两种模式的信任强度完全不同，不要混为一谈：

| 模式                        | 信任源                                          | 跨部署保持 host 身份 | 能挡住 MITM / host key 变更 |
| --------------------------- | ----------------------------------------------- | -------------------- | -------------------------- |
| 默认（不传 `known-hosts:`） | **每次部署现场** `ssh-keyscan` 抓到的 key        | ❌ 不能               | ❌ 不能                    |
| 传 `known-hosts:`（预置）  | 你事先核验并存进 secret 的那把 key                | ✅ 能                 | ✅ 能                      |

- **默认模式**：action 为这一次部署现场抓一次 host key，写进本次专属的临时文件，用完
  就删。下一次部署会重新抓一遍——所以主机换 key 了也不会被发现，中间人拿到的 key 也照样
  被当成"当前 key"接受下来。默认模式只保证"这次连的就是它自己刚看到的那台机器"。
- **固定 known-hosts 模式**：传进来的 key 是唯一的信任源，ssh 会拿它和远端当前 host key
  逐字节比对——不一致就报 `REMOTE HOST IDENTIFICATION HAS CHANGED` 并拒绝连接。
  只有这种模式才真正把 host 身份钉死（防 MITM、防 host key 变更）。
- 生产场景请把核验过的 `ssh-keyscan -H <host>` 输出存进 GitHub secret，通过
  `known-hosts:` 传入；换机或重装后记得同步更新 secret。

## 已知 pitfall

- **远端必须能调用 `bash`**：action 把 `bash -s` 作为 ssh 命令字符串发出。如果远端
  用户的登录 shell 是 dash/sh/zsh，bash 必须在 `$PATH` 里能找到——主流 Linux 发行版
  都默认装 bash，VPS 上基本不会出问题。
- **here-string 缓冲区上限**：`<<< "$REMOTE_PAYLOAD"` 把 exports 前缀 + 用户脚本整体灌
  stdin，超长（> 64KB 量级）可能撞 ssh/管道缓冲区。实测 4KB 内安全，下游目前最长的
  ellie release.yml ssh 脚本约 1.5KB，远在安全区。
- **`envs` 变量必须先在 step 的 `env:` 块设置**：`with: envs: FOO` 只是声明要传递
  `FOO`，`FOO` 本身得在调用方 step 的 `env:` 中赋值，否则 action 会跳过并打 warning。
- **不预置 `known-hosts` 时**：默认行为是现场 `ssh-keyscan -T 10` 抓 host key，
  首次连接是 TOFU——**每次部署各扫各的、扫完就删**，因此主机换 key 或遇中间人都不会
  被发现。生产建议把核验过的 `ssh-keyscan -H <host>` 输出存入 GitHub secret，通过
  `known-hosts:` 显式传入（详见上面的 host key 校验对照）。
- **`known-hosts` 写错 = 部署直接失败**：传进来的 key 与远端实际 host key 不一致时，
  ssh 以 `REMOTE HOST IDENTIFICATION HAS CHANGED` 拒绝连接，action 以非 0 退出，
  远端脚本不会执行。传之前请确认 key 是**目标主机当前**的 host key。

## 下游迁移指引（不在本 issue 范围内）

下游 `ellie` / `noheir` / `neo` / `wooly` 的 `release.yml` 替换 step 时：

```diff
 - name: Deploy to production server
-  uses: appleboy/ssh-action@v1
+  uses: nocoo/base-ci/.github/actions/ssh-deploy@<sha>  # v2026.5
   env:
     IMAGE_SHA: ${{ steps.sha.outputs.value }}
   with:
     host: ${{ secrets.VPS_HOST }}
-    username: ${{ secrets.VPS_USER }}
+    user: ${{ secrets.VPS_USER }}
     key: ${{ secrets.VPS_SSH_KEY }}
     port: ${{ secrets.VPS_PORT }}
     envs: IMAGE_SHA
     script: |
       ...
```

唯一需要改的是 `username` → `user`，其他 input 名称、`script` 内容、`env:` 用法都保持
原样。
