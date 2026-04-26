param(
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
chcp 65001 > $null

. (Join-Path $PSScriptRoot 'weibo-port-state.ps1')

$resolvedPort = Resolve-WeiboPort -Port $Port
$userDataDir = Get-WeiboUserDataDir -Port $resolvedPort

Set-Location $PSScriptRoot
$ensureExitCode = Invoke-WeiboPowerShellFile -FilePath (Join-Path $PSScriptRoot 'ensure-debug-chrome.ps1') -ArgumentList @('-Port', $resolvedPort, '-StartUrl', 'https://weibo.com/', '-UserDataDir', $userDataDir)
if ($ensureExitCode -ne 0) {
  Write-Error 'debug chrome start failed.'
  Wait-WeiboIfInteractive
  exit $ensureExitCode
}

Write-Host "Chrome 已打开到微博首页，请在浏览器中完成登录。当前端口: $resolvedPort"
Write-Host "当前账号数据目录: $userDataDir"
Wait-WeiboIfInteractive
