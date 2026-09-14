-- 静态节点源：kind = 'fetch'（URL 回源，默认）| 'static'（content 存分享链接文本，不回源）
-- static 源不占用 KV 回源写额度；url 列对 static 源无意义，存空串保持 NOT NULL 约束。

ALTER TABLE sources ADD COLUMN kind TEXT NOT NULL DEFAULT 'fetch';
ALTER TABLE sources ADD COLUMN content TEXT;
