param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('inspect', 'like', 'repost', 'comment', 'repost-comment', 'like-repost', 'like-comment', 'like-repost-comment')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$Url,

  [string]$Text,

  [string]$ContextPath,

  [string]$ContextJson,

  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
chcp 65001 > $null

. (Join-Path $PSScriptRoot 'weibo-port-state.ps1')

$resolvedPort = Resolve-WeiboPort -Port $Port
$cdpp = Get-WeiboCdpp -Port $resolvedPort
$userDataDir = Get-WeiboUserDataDir -Port $resolvedPort

Set-Location $PSScriptRoot
$ensureExitCode = Invoke-WeiboPowerShellFile -FilePath (Join-Path $PSScriptRoot 'ensure-debug-chrome.ps1') -ArgumentList @('-Port', $resolvedPort, '-StartUrl', 'https://weibo.com/', '-UserDataDir', $userDataDir)
if ($ensureExitCode -ne 0) {
  Write-Error 'debug chrome start failed.'
  Wait-WeiboIfInteractive
  exit $ensureExitCode
}

$args = @('.\weibo-interactor.mjs', '--action', $Action, '--url', $Url, '--host', '--cdpp', $cdpp, '--port', $resolvedPort)
if ($Text) {
  $args += @('--text', $Text)
}
if ($ContextPath) {
  $args += @('--context-path', $ContextPath)
}
if ($ContextJson) {
  $args += @('--context-json', $ContextJson)
}

& node @args
$nodeExitCode = $LASTEXITCODE
Wait-WeiboIfInteractive
exit $nodeExitCode
