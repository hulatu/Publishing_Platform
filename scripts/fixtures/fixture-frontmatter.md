---
title: "回归样本：完整的 front matter"
date: 2026-02-09
lastmod: 2026-02-10
slug: "fixture-frontmatter"
categories: ["测试", "工程"]
tags: ["回归", "front matter", "解析"]
summary: "带 slug、lastmod、多分类与多标签的完整 front matter，正文里还有 Hugo 的锚点语法。"
draft: false
---

front matter 的每个字段都会影响产物：slug 决定台账与草稿的 key，title 决定文件名与卡片文字，
tags 会进小红书的话题。这里把它们都写满。

## 带锚点残留的标题 {#with-anchor}

Hugo 与 Goldmark 允许在标题末尾追加花括号锚点，用来固定 id；markdown-it 不认这个语法，
原样漏进产物的话，公众号的标题里会多出一串花括号和井号组成的标记。

## 带 class 的标题 {.lead}

同样的道理，`.lead` 这种类名标记也不该出现在正文里。

结尾段落：确认上面两行花括号标记在产物里已经被去掉。
