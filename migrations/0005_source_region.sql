-- 源级地区：'hk' | 'tw' | 'jp' | 'sg' | 'us' | 'eu'；NULL = 按节点名自动识别。
-- 指定后该源全部节点归入对应 Clash 地区组（自建节点名常不含地区关键字）。
ALTER TABLE sources ADD COLUMN region TEXT;
