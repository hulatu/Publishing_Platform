/**
 * 拖进来的文件
 *
 * 只判断类型：哪个是 .md、哪个是图片。
 *
 * 这里**不收集图片**。图片归作者自己的图床管 —— 这个工具只读 md 里的链接，
 * 不上传、不改写、也不猜「这张本地图对应正文哪一处」。少一层猜测，
 * 就少一种「传错图还是静默的」事故。
 *
 * 拖文件夹进来曾经支持过（走 webkitGetAsEntry 递归展开），导入区收敛成
 * 「选文件 / 粘正文」两个入口后这条路径就没有调用方了，一并删掉。
 * dataTransfer.files 拖文件夹时为空，调用方按「没找到 .md」处理即可。
 */

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|avif|bmp)$/i

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return IMAGE_EXT.test(file.name)
}

export function isMarkdownFile(file: File): boolean {
  return /\.(md|markdown|txt)$/i.test(file.name)
}
