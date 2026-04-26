$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
chcp 65001 > $null

. (Join-Path $PSScriptRoot 'weibo-port-state.ps1')

$ports = @(9333, 9334)
foreach ($port in $ports) {
  $userDataDir = Get-WeiboUserDataDir -Port $port
  $ensureExitCode = Invoke-WeiboPowerShellFile -FilePath (Join-Path $PSScriptRoot 'ensure-debug-chrome.ps1') -ArgumentList @('-Port', $port, '-StartUrl', 'https://weibo.com/', '-UserDataDir', $userDataDir)
  if ($ensureExitCode -ne 0) {
    Write-Error "端口 $port 的调试版 Chrome 启动失败。"
    Wait-WeiboIfInteractive
    exit $ensureExitCode
  }
}

Write-Host '已显式打开两个微博浏览器：'
Write-Host ' - 9333 -> %TEMP%\social-publisher-chrome-9333'
Write-Host ' - 9334 -> %TEMP%\social-publisher-chrome-9334'
Write-Host '现在你可以分别在两个浏览器里登录不同微博账号。'
Wait-WeiboIfInteractive
