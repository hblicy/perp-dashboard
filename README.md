作者 X：[@conor186](https://x.com/conor186)

# Perp DEX 数据看板（Vercel 版）

- index.html：页面，打开后读取 /api/data，再单独请求 /api/txflow 和 /api/txflow7d，并在浏览器里补 Entropy 的 7D
- api/data.js：服务器端函数，汇总 DefiLlama（页面用 OI、手续费；每行仍返回 tvl，供以后做存款分母）、perpsmania、CoinGecko，以及 PopDEX 官方公开行情。正常结果 Vercel CDN 缓存 10 分钟（s-maxage=600），过期后的 1 小时内先返回旧数据，同时在后台更新（stale-while-revalidate=3600）。DefiLlama、perpsmania、CoinGecko、Hyperliquid 每个请求自己 15 秒超时，并和整次 44 秒截止绑在同一个 AbortSignal 上。PopDEX 仍是单次 8 秒。一个源挂起或失败只让它自己的字段空着，并在 errors 里写上这个源；已经成功的行和字段照常返回，不会整表变成空。截止时 errors 仍写明停在哪一路、哪些交易所还挂着，以及 PopDEX 已完成的合约数。24H 已经算完而 7D 还没有时，24H 单独保留。44 秒截止，或 DefiLlama、Hyperliquid、perpsmania、CoinGecko、PopDEX 出现超时、5xx、429 时，只缓存 60 秒，不带 stale-while-revalidate。
- api/txflow.js：只算 TxFlow 的 24H。最多 3 个并发。24H 成功时 CDN 缓存 1 小时，过期后的 1 小时内先返回旧数据（s-maxage=3600, stale-while-revalidate=3600）。24H 为空的失败缓存 5 分钟（s-maxage=300）。合约列表的 20 秒从上次 429 冷却结束才开始算，整个函数仍不超过 255 秒
- api/txflow7d.js：只算 TxFlow 的 7D K 线。成功时 CDN 缓存 6 小时，过期后的 6 小时内先返回旧数据（s-maxage=21600, stale-while-revalidate=21600）。7D 为空缓存 5 分钟（s-maxage=300），页面显示缺失，不会写成 $0
- config.json：交易所列表、DefiLlama slug、CoinGecko id、手工填写的 OI/用户存款
- vercel.json：api/data.js 最长 60 秒，api/txflow.js 和 api/txflow7d.js 最长 300 秒

## 交易量口径

- 多数交易所：perpsmania，没有则用 CoinGecko。
- PopDEX：官方公开 API，服务器端取（浏览器没有 CORS）。24H 是全部期货 `turnover24h` 之和，7D 是滚动 168 小时 1H K 线的报价成交额。金额是 USDT。文档没写清单边还是双边，未核实。任何一条无效，或任何一张 K 线取失败，对应的 24H 或 7D 就是缺失（页面显示“缺失”），不会公布少算的合计。
- TxFlow：24H 优先用一次 `webData2` 的 `assetCtxs.dayNtlVlm`，只加 `perpMeta` 里未下架合约的 `instrumentId`（现货行的 id 从 10000 起，不计入）。这个数和逐个 `activeAssetCtx.dayNtlVlm` 是同一个字段；同一次对照里 ETH、SOL、BNB、HYPE、XAU 的字符串完全一致，BTC 只差约 $146，因为两笔读取之间盘口变了。`webData2` 缺行或失败时，才退回逐个 `activeAssetCtx`，仍然全有或全无。7D 由 `/api/txflow7d` 单独取，是滚动 168 小时 K 线的基础币成交量乘 OHLC 均价，页面标“近似”。页面用 K 线里恰好 24 小时的那一段除以 24H 合计得到覆盖比例：起始那根跨过边界的小时 K 线只按落在窗口内的分钟比例计入。K 线基础币成交量低于 dayNtlVlm，偏差大约在低 2–8%，而且会波动。K 线数组是空的时，这一合约的 7D 算失败，不会把空数据记成 $0。7D 失败不影响已经取到的 24H。每小时的 `/api/txflow` 只打 24H：`webData2` 可用时是 1 次 `perpMeta` 加 1 次 `webData2`（2 次），不再打约 234 次 `activeAssetCtx` 和约 234 次 K 线。以前每次源站运行大约是 1 + N + N 次（线上曾看到约 246 次行情加约 241 次 K 线，另有约 19–22 次 429）。7D 源站最多每 6 小时一次，大约是 1 次 `perpMeta` 加 N 次 K 线。响应里的 timing：`cooldown429WallMs` 是 HTTP 429 把共享冷却截止时间向后推的墙钟毫秒，同一次冷却不按 3 个并发重复加（retry-after 2 秒大约记 2000）。`backoffMs` 是重试间隔，加上第二轮补拉前的等待。`cooldownRemainingAtStartMs` 是这个实例上一次运行留下的冷却还剩多少。日志多一个 `node`（Node 版本），响应 JSON 里没有这个字段。
- Entropy：24H 用 Hyperliquid `dayNtlVlm`。7D 在浏览器里用 `candleSnapshot` 估算（未下架合约，滚动 168 小时），也标“近似”。
- 不要把 Hyperliquid 和 Entropy 的交易量相加。Hyperliquid 一行的 24H 来自 perpsmania，很可能已经包含 HIP-3 子所（包括 Entropy）。

## 用 GitHub 网页上传（仓库 hblicy/perp-dashboard）
1. 打开仓库首页，点 Add file → Upload files，把 index.html、config.json、vercel.json、README.md 拖进去（同名的 index.html 会被覆盖），点 Commit changes。
2. 创建 api 文件夹：点 Add file → Create new file，文件名一栏输入 `api/data.js`（输入 `/` 后会自动变成文件夹），把 api/data.js 的全部内容粘贴进去，点 Commit changes。同样再提交 `api/txflow.js` 和 `api/txflow7d.js`。
3. Vercel 会自动重新部署，大约 1 分钟。完成后打开 https://perp-dashboard-eight.vercel.app/api/data，能看到 JSON 就说明成功了。第一次请求约需 20 秒，之后都是秒开。
4. Vercel 项目设置里 Framework Preset 选 Other，Build Command 和 Output Directory 留空。

## 修改交易所或数据
直接在 GitHub 上编辑 config.json：exchanges 里每项是 {"name","slug"(DefiLlama),"coingecko"(可选)}；可选 "token"（字符串），有值时在交易所名旁边显示小号灰色文字，例如 "token": "HYPE"。token 写成 null 时显示「缺失」，悬停文字写在 "tokenNote"。depositsDisplay 为 "missing" 时，OI/存款格显示缺失。verification 写在备注格子的悬停里。manual 里按 slug 填 userDeposits 和 snapshotAt。备注写在该交易所的 "note"（字符串，空着显示 —），格子里只显示这一句，不放来源链接。手续费来源只接受 https://，并带 rel="noopener noreferrer"。不要写在 fee.note 里，那是手续费悬停说明。备注不参与合计，默认排序仍是 OI。备注列不能排序。例如 "note": "一句话"。Lighter 主行的 DefiLlama 请求用 "llamaSlug": "lighter-perps"（不含 Robinhood Chain）。Lighter 存款用 protocol/lighter 的 currentChainTvls.Ethereum，不用父协议总 TVL。feesDisplay 为 "missing" 或 "na" 时，手续费格显示缺失或不适用。热度里手续费行用手续费比的中位数，改用交易量的行用全部交易所交易量比的中位数。提交后自动重新部署。
