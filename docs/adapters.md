# 采集与通知适配器

这份开源包包含独立可运行的解码、训练、回测及网页模块。真实抖音查新、浏览器播放截图与视觉核实由外部适配器提供；不把本聊天中的浏览器工具冒充成项目自带服务。

## 输入约定

1. 查新适配器在用户已有登录态中读取可见主页，按作品ID去重、核实本人原链接和页面发布时间。只检查配置的北京时间时段；早上首轮仍核对夜间是否有漏记作品。
2. 通过可见播放器播放并暂停，采样开头、中段、尾部及物件变化，保存真实JPEG。播放时点与渲染画面必须一致，不能只读currentTime就截图。不要下载原视频或规避访问限制。
3. 视觉适配器保存具体名称、颜色、数量、位置、朝向、动作、同帧关系和文字。输出先设verified=false，人工核实后设为true。未知种类和数量保留未知，不用后续指数走势补标。
4. 以examples/observation.json提交原观察、语义候选及明确模型资格。以examples/evidence-manifest.json提交截图和裁切；每张图的frameIndex、time、capturedAt分别对应真实帧索引、播放秒数和实际采集时间。
5. 先导入观察、证据并运行report，锁定同版本首次判断；之后才更新行情并再次生成报告。历史补录必须imported=true、baseline=true。

第三方视觉服务返回的置信度仅表示辨认把握，不是作者本意或涨跌预测效果。parseVisionObservations会把待核实视觉输出标为未确认。

## 运行次序

```sh
npm run import -- path/to/observation.json
npm run evidence -- path/to/evidence-manifest.json
npm run report
npm run market
npm run report
```

发布日15:00前的交易日作品增加当天收盘窗口；15:00整及之后不使用发布前的当天走势验证。行情文件updatedAt必须是实际获取报价的时间，不是当前导入时间。示例点位是虚构占位数据。

## 通知约定

通知适配器读取生成的outputs/可视化报告数据.json，发送尚未通知的新作品与真正完成的验证窗口，保存送达ID防重复。内容包含原链接、发布时间、证据、语义候选、替代解释、模型版本和未校准概率。QQ邮件发送模块尚未实现，后续发信凭据应只来自环境变量或系统凭据管理器。

不要将普通抓取时间更新、盘中缓存变化、历史补录或已通知作品当新通知。运行档案、第三方截图和登录态只存本机忽略目录。

当前通知读取item.displayPrediction：configuration为scaled-001，modelVersion为strong-background-2026-10-15-v1，pUp/pDown为未校准估计，firstEstimate为独立首次或null。excluded/insufficient状态不推送数字；不要从旧currentModelView取数后标成强增权实验。送达ID去重由通知适配器负责。
