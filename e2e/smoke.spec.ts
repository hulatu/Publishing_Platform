import { expect, test } from '@playwright/test'

/**
 * 核心链路冒烟：导入 → 复制富文本 → 文末加 6 条 → 导出 zip。
 *
 * 这四步分别覆盖最容易只在浏览器里坏掉的东西：
 * 文件导入、剪贴板顺序、无上限的往期条目、jszip 下载。
 * 不追求页面全覆盖，只把「粘贴坏了」这类最贵的回归挡在 CI 里。
 */
test('导入示例 → 复制富文本 → 文末 6 条 → 导出 zip', async ({ page }) => {
  // 测试里不打开公众号后台，避免弹窗干扰
  await page.addInitScript(() => {
    localStorage.setItem('ad.openPublishOnCopy.v1', '0')
  })

  await page.goto('/')
  await page.getByRole('button', { name: '载入示例文章' }).first().click()
  await expect(page.getByRole('heading', { name: '公众号' })).toBeVisible()

  // 发布检查 → 编辑文末 → 打开往期推荐
  await page.getByRole('button', { name: /发布检查/ }).click()
  await page.getByRole('button', { name: '编辑文末' }).click()
  const tail = page.getByRole('dialog', { name: '公众号文末' })
  await tail.getByLabel('往期推荐').check()

  // 默认 2 条，再加 4 条，验证不限制 4 条
  for (let i = 0; i < 4; i++) {
    await tail.getByRole('button', { name: '+ 加一条' }).click()
  }
  await expect(tail.locator('.tail-item-row')).toHaveCount(6)

  await tail.getByRole('button', { name: '关闭' }).click()
  // 打开文末会替换掉发布检查弹层；这里不再关第二次。

  // 复制富文本：剪贴板是双通道里更容易坏的那条
  await page.getByRole('button', { name: '复制富文本' }).click()
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  expect(clip).toContain('为什么需要分发')

  // 导出全平台：jszip 懒加载 + 下载事件
  const downloadPromise = page.waitForEvent('download')
  await page.locator('summary', { hasText: '更多' }).click()
  await page.getByRole('button', { name: '导出全平台' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/全平台\.zip$/)
})

/**
 * 多标签页冲突：两个标签页打开同一篇，第一个保存后第二个应暂停保存并提示。
 * 这条只在真实浏览器里有意义 —— storage 事件是浏览器行为，Node 测试模拟不出来。
 */
test('多标签页修改同一草稿时提示冲突', async ({ context, page }) => {
  const second = await context.newPage()
  for (const p of [page, second]) {
    await p.addInitScript(() => {
      localStorage.setItem('ad.openPublishOnCopy.v1', '0')
    })
    await p.goto('/')
    // 第二个标签页可能已经自动接回了第一篇的草稿；有入口才点
    const sample = p.getByRole('button', { name: '载入示例文章' }).first()
    if (await sample.count()) await sample.click()
    await expect(p.locator('.editor-file')).toContainText('示例文章.md')
  }

  // 让两页各自完成第一次自动保存，避免把「初始保存」误判成冲突
  await page.waitForTimeout(1200)

  const editor = page.locator('textarea').first()
  await editor.fill(`${await editor.inputValue()}\n\n## 冲突测试\n\n这一行只改第一个标签页。`)
  // 第一个标签页 800ms 后自动保存，第二个标签页应收到 storage 事件并暂停保存
  await expect(second.getByRole('button', { name: '多标签冲突' })).toBeVisible({ timeout: 6000 })
  await expect(
    second.getByText('另一个标签页修改了这篇草稿。请刷新页面后再继续，避免覆盖。'),
  ).toBeVisible()

  await second.close()
})

/**
 * 刷新后自动接回上次草稿，不用再进草稿箱手动恢复。
 */
test('刷新后自动接回上次草稿', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ad.openPublishOnCopy.v1', '0')
  })
  await page.goto('/')
  await page.getByRole('button', { name: '载入示例文章' }).first().click()
  await expect(page.locator('.editor-file')).toContainText('示例文章.md')

  // 等自动保存（800ms 防抖）落盘
  await page.waitForTimeout(1400)
  await page.reload()

  await expect(page.getByRole('heading', { name: '公众号' })).toBeVisible()
  await expect(page.getByText('已恢复草稿')).toBeVisible()
  await expect(page.locator('.file-row-title')).toContainText('示例文章')
})

/**
 * 点左上角品牌回到首页：当前文章留在草稿箱，空态给出继续入口。
 */
test('点品牌回到首页，草稿留在草稿箱', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ad.openPublishOnCopy.v1', '0')
  })
  await page.goto('/')
  await page.getByRole('button', { name: '载入示例文章' }).first().click()
  // 标题在空态也有，不能拿它判断「文章已载入」
  await expect(page.locator('.editor-file')).toContainText('示例文章.md')

  await page.getByRole('button', { name: /回到首页/ }).click()

  await expect(page.getByText('先导入一篇博客文章')).toBeVisible()
  await expect(page.getByRole('button', { name: /继续上次编辑/ })).toBeVisible()
})
