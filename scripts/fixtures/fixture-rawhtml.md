---
title: "回归样本：正文里的裸 HTML"
date: 2026-02-05
categories: ["测试"]
tags: ["回归", "HTML"]
summary: "覆盖 script、style、iframe、svg、form 与带内联样式的 div —— 都被清洗，但不该让正文崩掉。"
---

博客正文里混进 HTML 是常态（视频嵌入、关注按钮、旧文章样式）。这一段专门测试
解析器和清洗器遇到它们时的行为。

## 视频嵌入

<iframe src="https://v.qq.com/txp/iframe/player.html?vid=abc123" allowfullscreen></iframe>

## 一段旧样式

<style>.legacy-note { color: #c0392b; }</style>

<div style="border-left:3px solid #c0392b;padding-left:12px;color:#666">
  这段是作者手写的 HTML 块，带内联样式。
</div>

## 危险但常见的写法

<script>console.log('这段应该被删掉')</script>

<svg/onload=alert(1)>

<form action="https://example.com/collect"><input name="email"></form>

## 正常链接

<a href="https://example.com/raw">一个手写的链接</a> 后面接普通正文。

结尾段落：确认上面的东西被清掉之后，正文其它部分仍然完整。
