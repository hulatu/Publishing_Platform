---
title: "回归样本：中英混排与标点"
date: 2026-02-08
categories: ["测试"]
tags: ["回归", "排版"]
summary: "覆盖中文全角标点、中英混排、超长英文单词、emoji 与数字单位。"
---

排版类的问题往往不是「错了」，而是「看着别扭」：中英之间要不要空格、标点是不是全角、
长单词会不会把行撑破。这一段用来固定这些表现。

## 全角标点

他说：「这段用全角引号、全角逗号，句末是句号。」

## 中英混排

我们用 React 19 + Vite 6 做前端，用 TypeScript 写类型，部署在 Cloudflare Pages 上。

## 超长英文单词

下面这个词没有任何断点，用来检查 `word-break` 是否生效：

Pneumonoultramicroscopicsilicovolcanoconiosis_and_then_some_more_suffix_to_make_it_longer

## 数字与单位

公众号正文上限 20,000 字；本文约 1,200 字，占了 6%。百分比 85%、99.9%、0.03%。

## emoji 与符号

发布完成 ✅ 复制成功 🎉 注意 ⚠️ 箭头 → ↑ ↓ 破折号 —— 省略号 ……

结尾段落：确认上面这些字符在任何平台的产物里都没有变成问号或方块。
