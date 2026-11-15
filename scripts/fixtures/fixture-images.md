---
title: "回归样本：图片与图注"
date: 2026-02-04
categories: ["测试"]
tags: ["回归", "图片"]
summary: "覆盖有 alt、无 alt、行内图片、连续图片与带标题的图片。"
---

图片的 alt 决定了图注。markdown-it 把 alt 放在 token.content 而不是 attrs 里，
这里四种情形各放一张。

## 有 alt

![一张带说明的配图](https://img.example.com/posts/with-alt.jpg)

## 没有 alt

![](https://img.example.com/posts/no-alt-2026-02-04.png)

## 连续两张

![第一张](https://img.example.com/posts/first.jpg)

![第二张](https://img.example.com/posts/second.jpg)

## 段落里的行内图

文字和 ![行内小图](https://img.example.com/posts/inline.png) 在同一段里，不该被包成 figure。

结尾段落：确认图片块之间的空行不会产生空段落。
