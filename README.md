# Perp DEX 数据看板（Vercel 版）

- index.html：页面，打开后读取 /api/data，再单独请求 /api/txflow，并在浏览器里补 Entropy 的 7D
- api/data.js：服务器端函数，汇总 DefiLlama、perpsmania、CoinGecko，以及 PopDEX 官方公开行情。Vercel CDN 缓存 10 分钟（s-maxage=600），过期后的 1 小时内先返回旧数据，同时在后台更新（stale-while-revalidate=3600）
- api/txflow.js：只算 TxFlow。最多 3 个并发。成功时 CDN 缓存 1 小时；失败时缓存 5 分钟（s-maxage=300），避免每个访客都把约 468 次请求打到同一出口 IP
- config.json：交易所列表、DefiLlama slug、CoinGecko id、手工填写的 OI/用户存款
- vercel.json：api/data.js 最长 60 秒，api/txflow.js 最长 300 秒

## 交易量口径

- 多数交易所：perpsmania，没有则用 CoinGecko。
- PopDEX：官方公开 API，服务器端取（浏览器没有 CORS）。24H 是全部期货 `turnover24h` 之和，7D 是滚动 168 小时 1H K 线的报价成交额。金额是 USDT。文档没写清单边还是双边，未核实。任何一条无效，或任何一张 K 线取失败，对应的 24H 或 7D 就是缺失（页面显示“缺失”），不会公布少算的合计。
- TxFlow：24H 是各永续 `dayNtlVlm` 之和。7D 是滚动 168 小时 K 线的基础币成交量乘 OHLC 均价，页面标“近似”。悬停会显示这一次算出的 24H K 线对官方 dayNtlVlm 的覆盖比例；K 线基础币成交量低于 dayNtlVlm，偏差大约在低 2–8%，而且会波动。失败时该行显示“缺失”，这个失败结果缓存 5 分钟。
- Entropy：24H 用 Hyperliquid `dayNtlVlm`。7D 在浏览器里用 `candleSnapshot` 估算（未下架合约，滚动 168 小时），也标“近似”。
- 不要把 Hyperliquid 和 Entropy 的交易量相加。Hyperliquid 一行的 24H 来自 perpsmania，很可能已经包含 HIP-3 子所（包括 Entropy）。

## 用 GitHub 网页上传（仓库 hblicy/perp-dashboard）
1. 打开仓库首页，点 Add file → Upload files，把 index.html、config.json、vercel.json、README.md 拖进去（同名的 index.html 会被覆盖），点 Commit changes。
2. 创建 api 文件夹：点 Add file → Create new file，文件名一栏输入 `api/data.js`（输入 `/` 后会自动变成文件夹），把 api/data.js 的全部内容粘贴进去，点 Commit changes。同样再提交 `api/txflow.js`。
3. Vercel 会自动重新部署，大约 1 分钟。完成后打开 https://perp-dashboard-eight.vercel.app/api/data，能看到 JSON 就说明成功了。第一次请求约需 20 秒，之后都是秒开。
4. Vercel 项目设置里 Framework Preset 选 Other，Build Command 和 Output Directory 留空。

## 修改交易所或数据
直接在 GitHub 上编辑 config.json：exchanges 里每项是 {"name","slug"(DefiLlama),"coingecko"(可选)}；manual 里按 slug 填 userDeposits 和 snapshotAt。提交后自动重新部署。
