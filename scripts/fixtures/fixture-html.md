---
title: "回归样本：脏 HTML 与代码"
date: 2026-01-02
categories: ["测试"]
tags: ["回归"]
summary: "覆盖 iframe、script、裸 HTML、分隔线与嵌套列表。"
---

导语里放一个内嵌视频，公众号里必须降级成纯文本链接。

<iframe src="https://www.youtube.com/embed/abc123" title="video"></iframe>

## 视频之后

iframe 后面紧跟一段正文，测试降级后段落有没有断。

<script>alert('这段脚本必须被剥掉')</script>

## 裸 HTML

<div class="wrap"><p>这一段是裸 HTML 段落，含 <span onclick="evil()">事件处理器</span>。</p></div>

---

## 嵌套列表

1. 第一步
   - 子项 A
   - 子项 B
2. 第二步
   - 子项 C

## 长代码块

```bash
npm install
npm run build
for f in *.md; do
  echo "processing $f"
done
```

## 收尾

最后一节，写两句正常的话，保证摘要不会为空。
