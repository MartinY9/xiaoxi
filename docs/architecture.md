# 结构与不可变边界

原观察record只追加；语义解释另存work/interpretations；资格是独立metadata，不因行情好坏改资格。work/models、work/background-models保存参数及同版本首次估计，冲突时失败，不覆盖。当前模型重算与首次估计分开展示。

价格导入携带updatedAt。withCloseConfirmation为派生标记，只有数据实际抓取时间达到当日15:05才训练/验证，不依赖当前时钟补确认。不同窗口及目标日独立定位，历史分钟不以日线替代。

公开仓库只含源代码与合成样例；运行目录和真实截图均被忽略。服务仅绑定127.0.0.1，只提供outputs网页与样例，不提供work档案或任意文件读写。

当前网页只显示固定标准化L2=0.01强增权实验。work/strong-models与work/strong-predictions.json保存参数和切换后新观察的首次判断；旧作品不补造首次。displayPrediction为下游应用当前显示输出，currentModelView为原v4档案，两者不能混称。CLI面向串行单写入进程。损坏JSON失败，不当作空档案；合成目录拒绝真实输入和行情抓取；静态服务拒绝指向outputs以外的链接。

可选发布器从public/report.html和证据索引建立显式清单，仅复制首页与JPEG到独立站点。work/site-releases保存本机发布快照；服务端incoming、releases与site分开。sync-site以哈希去重，调用发布器后验证公开页面，连接配置和同步状态都留在work，不属于公开文件。图片本身的隐私需要人工审核。
