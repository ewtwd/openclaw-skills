param(
  [int]$Port = 0,

  [string]$StartUrl = 'https://weibo.com/'
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
chcp 65001 > $null

. (Join-Path $PSScriptRoot 'weibo-port-state.ps1')

if ($Port -gt 0) {
  $resolvedPort = Resolve-WeiboPort -Port $Port
} else {
  $currentPort = Get-ActiveWeiboPort
  $resolvedPort = Get-AlternateWeiboPort -CurrentPort $currentPort
}

$userDataDir = Get-WeiboUserDataDir -Port $resolvedPort

$ensureExitCode = Invoke-WeiboPowerShellFile -FilePath (Join-Path $PSScriptRoot 'ensure-debug-chrome.ps1') -ArgumentList @('-Port', $resolvedPort, '-StartUrl', $StartUrl, '-UserDataDir', $userDataDir)
if ($ensureExitCode -ne 0) {
  Write-Error "微博账号切换失败：端口 $resolvedPort 的调试版 Chrome 未能正常就绪。"
  Wait-WeiboIfInteractive
  exit $ensureExitCode
}

Set-ActiveWeiboPort -Port $resolvedPort | Out-Null
Write-Host "已切换默认微博浏览器到端口 $resolvedPort"
Write-Host "对应数据目录: $userDataDir"
if ($Port -le 0) {
  Write-Host '本次为无参切换：已根据本地记录的当前端口自动切到另一个端口。'
}
Write-Host '后续未显式指定 -Port 的微博登录 / 发博 / 互动 / 视频任务，都会默认使用这个端口的浏览器。'
Wait-WeiboIfInteractive
