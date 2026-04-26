param(
  [int]$Top = 10,
  [int]$Port = 0,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
chcp 65001 > $null

$skillsDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$publisherScripts = Join-Path $skillsDir 'social-publisher\scripts'
. (Join-Path $publisherScripts 'weibo-port-state.ps1')

$resolvedPort = Resolve-WeiboPort -Port $Port
$cdpp = Get-WeiboCdpp -Port $resolvedPort
$userDataDir = Get-WeiboUserDataDir -Port $resolvedPort

Set-Location $PSScriptRoot
$ensureExitCode = Invoke-WeiboPowerShellFile -FilePath (Join-Path $publisherScripts 'ensure-debug-chrome.ps1') -ArgumentList @('-Port', $resolvedPort, '-StartUrl', 'https://weibo.com/hot/entertainment', '-UserDataDir', $userDataDir)
if ($ensureExitCode -ne 0) {
  Write-Error 'debug chrome start failed.'
  Wait-WeiboIfInteractive
  exit $ensureExitCode
}

$args = @('.\discover-ent-hot-topic.mjs', '--host', '--cdpp', $cdpp, '--top', "$Top")
if ($Json) { $args += '--json' }

& node @args
$nodeExitCode = $LASTEXITCODE
Wait-WeiboIfInteractive
exit $nodeExitCode
