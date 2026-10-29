# 部署成 HTTPS 网址（比赛版）

目标：评委用手机流量、国内普通网络打开一个 HTTPS 网址，文字、照片、语音都能用（浏览器只在 HTTPS 下给麦克风权限）。

## 为什么选香港轻量服务器

- 内地服务器绑定域名对外开放 80/443 需要 ICP 备案，通常一到三周，比赛前来不及。
- 香港节点不需要备案，内地访问一般可用；服务器再去调用百炼北京接口。
- 不买域名：用 `sslip.io`，`47-1-2-3.sslip.io` 会自动解析到 `47.1.2.3`，Caddy 自动申请 HTTPS 证书。
- 访问速度和稳定性要用真实手机流量、校园网实际验证，不预先承诺。

## 架构

```text
手机浏览器 ──HTTPS/WSS──> Caddy（443，自动证书）──> node scripts/serve.mjs（127.0.0.1:3000）
                                                       ├─ dist/ 页面
                                                       ├─ /api/chat、/api/sculpture、/api/title
                                                       └─ /api/voice（WebSocket）──> 百炼北京
```

密钥只在服务器的 `.env` 里，浏览器拿不到。

## 一、购买服务器（本人在控制台操作）

1. 阿里云或腾讯云「轻量应用服务器」，地域选**中国香港**，系统镜像选 **Ubuntu 24.04**，最低一档配置即可，按月购买。
2. 在该服务器的「防火墙」里放行 TCP **80** 和 **443**（22 一般默认已开）。
3. 记下公网 IP，下文写作 `47.1.2.3`，网址就是 `47-1-2-3.sslip.io`（点换成横线）。
4. 登录方式：本机生成一把部署专用密钥 `ssh-keygen -t ed25519 -f ~/.ssh/xianying_deploy`，在控制台「远程连接」打开网页终端，把公钥追加进 `~/.ssh/authorized_keys`。阿里云轻量 Ubuntu 的默认用户是 `admin`（免密 sudo），下文的服务器命令以 root 身份写，用 `admin` 时在前面加 `sudo`。1 GiB 内存的档位建议再加 1 GB swap（`fallocate -l 1G /swapfile` 等）。

## 二、服务器上装 Node 24 和 Caddy（只做一次）

在本机 PowerShell 登录：`ssh root@47.1.2.3`，然后逐段执行：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
node -v   # 应为 v24.x

apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
mkdir -p /opt/xianying
```

## 三、上传代码和密钥（本机 PowerShell）

```powershell
Set-Location -LiteralPath 'D:\显影'
npm.cmd run build
tar -czf $env:TEMP\xianying.tgz dist server scripts src/visual.ts src/imagery.ts package.json package-lock.json
scp $env:TEMP\xianying.tgz root@47.1.2.3:/opt/
scp .env root@47.1.2.3:/opt/xianying/.env
```

`.env` 通过 SSH 加密传输，不进 Git、不进压缩包。服务器上：

```bash
cd /opt/xianying && tar -xzf /opt/xianying.tgz && npm ci --omit=dev
chmod 600 .env
```

## 四、让服务常驻（服务器）

`nano /etc/systemd/system/xianying.service`，写入：

```ini
[Unit]
Description=Xianying
After=network-online.target

[Service]
WorkingDirectory=/opt/xianying
EnvironmentFile=/opt/xianying/.env
Environment=PORT=3000
ExecStart=/usr/bin/node scripts/serve.mjs
Restart=always
DynamicUser=yes

[Install]
WantedBy=multi-user.target
```

systemd 以 root 读取 `.env`，再用临时低权限用户运行 Node。启动并查看：

```bash
systemctl daemon-reload && systemctl enable --now xianying
journalctl -u xianying -n 20   # 应看到「显影已启动」「已读取 API Key」
```

## 五、配置 HTTPS（服务器）

`nano /etc/caddy/Caddyfile`，整个替换为（换成自己的 IP）：

```text
47-1-2-3.sslip.io {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

`encode` 让主程序 JS 压缩后传输（约 860 KB → 250 KB）。

```bash
systemctl reload caddy
journalctl -u caddy -n 30   # 看到 certificate obtained 即证书到位
```

## 六、验收

- 手机关闭 Wi-Fi、用流量打开 `https://47-1-2-3.sslip.io`：首屏雕塑、打字回复、投照片、麦克风权限与语音、凝结命名、回廊保存。
- 线上地址的回廊与本机 `127.0.0.1` 的回廊互不相通（浏览器按网址分开存）。

## 更新代码

本机重新执行第三步的 `build`、`tar`、`scp xianying.tgz`（`.env` 不用再传），服务器上：

```bash
cd /opt/xianying && tar -xzf /opt/xianying.tgz && npm ci --omit=dev && systemctl restart xianying
```

## 公开网址的额度保护

- 百炼控制台保持「免费额度用完即停」，比赛期间留意用量。
- 后端有全站限制，保护密钥额度。本机默认：文字同时 2 个请求、每分钟 20 次；语音同时 2 路。超过时用户看到「稍后再试」。
- 公开演示时在服务器上调高（当前线上为 6 / 60 / 4），写在单独的配置里，改完重启即可：

```bash
sudo mkdir -p /etc/systemd/system/xianying.service.d
printf "[Service]
Environment=XIANYING_TEXT_CONCURRENT=6
Environment=XIANYING_TEXT_PER_MINUTE=60
Environment=XIANYING_VOICE_CONCURRENT=4
" | sudo tee /etc/systemd/system/xianying.service.d/limits.conf
sudo systemctl daemon-reload && sudo systemctl restart xianying
```

- 数值是全站共用的，不是每个人各自的；调高前先在百炼控制台确认余额与「用完即停」。
- 赛后可在百炼控制台作废这把密钥，换一把新的。

## 备用方案

- 现场网络不稳：用自己的电脑 `npm.cmd run dev` 演示，并提前录一段完整流程视频。
- Cloudflare 临时隧道等境外服务在内地常常很慢或打不开，不作为主方案。
