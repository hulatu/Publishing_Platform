---
title: "回归样本：代码块"
date: 2026-02-07
categories: ["测试"]
tags: ["回归", "代码"]
summary: "覆盖带语言标注的代码块、不带语言的代码块、超长行与行内代码。"
---

代码块三家的处理方式都不一样：公众号退化成等宽段落，头条会把格式整个洗掉，
B 站只保证不丢字。所以这里放了长短两种。

## 带语言的代码块

```ts
export function add(a: number, b: number): number {
  return a + b
}
```

## 没有语言的代码块

```
plain text block
without any language hint
```

## 超长行

```bash
curl -sS "https://api.example.com/v1/very/long/path?with=many&query=params&that=should&not=break&the=layout&in=preview" | jq '.data.items[] | select(.active) | {id, name}'
```

## 行内代码

配置项叫 `WECHAT_WORD_LIMIT`，默认值是 `20000`；调用 `charCount(text)` 来数字数。

结尾段落：确认代码块之间的空行不会生成多余的空段落。
