# Perp DEX 数据看板（Vercel 版）

- index.html：页面，打开后读取 /api/data
- api/data.js：服务器端函数，汇总 DefiLlama 和 CoinGecko 数据。Vercel CDN 缓存 10 分钟（s-maxage=600），过期后的 1 小时内先返回旧数据，同时在后台更新（stale-while-revalidate=3600），所以页面基本秒开
- config.json：唯一需要改的文件（交易所列表、DefiLlama slug、CoinGecko id、手工填写的 OI/用户存款）
- vercel.json：把函数的最长运行时间设为 60 秒（冷启动拉数据约需 20 秒）

## 用 GitHub 网页上传（仓库 hblicy/perp-dashboard）
1. 打开仓库首页，点 Add file → Upload files，把 index.html、config.json、vercel.json、README.md 拖进去（同名的 index.html 会被覆盖），点 Commit changes。
2. 创建 api 文件夹：点 Add file → Create new file，文件名一栏输入 `api/data.js`（输入 `/` 后会自动变成文件夹），把 api/data.js 的全部内容粘贴进去，点 Commit changes。
3. Vercel 会自动重新部署，大约 1 分钟。完成后打开 https://perp-dashboard-eight.vercel.app/api/data，能看到 JSON 就说明成功了。第一次请求约需 20 秒，之后都是秒开。
4. Vercel 项目设置里 Framework Preset 选 Other，Build Command 和 Output Directory 留空。

## 修改交易所或数据
直接在 GitHub 上编辑 config.json：exchanges 里每项是 {"name","slug"(DefiLlama),"coingecko"(可选)}；manual 里按 slug 填 userDeposits 和 snapshotAt。提交后自动重新部署。
