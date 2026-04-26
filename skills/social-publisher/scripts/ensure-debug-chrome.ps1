param(
  [int]$Port = 9333,
  [string]$StartUrl = 'https://weibo.com/',
  [string]$UserDataDir = ''
)

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
chcp 65001 > $null

if ([string]::IsNullOrWhiteSpace($UserDataDir)) {
  $UserDataDir = Join-Path $env:TEMP ("social-publisher-chrome-{0}" -f $Port)
}

function Normalize-Dir([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return ''
  }

  $trimmed = $PathValue.Trim().Trim('"')
  try {
    if (Test-Path $trimmed) {
      return (Get-Item -LiteralPath $trimmed).FullName
    }
    return [System.IO.Path]::GetFullPath($trimmed)
  } catch {
    return $trimmed
  }
}

function Get-ChromeProcessForPort([int]$PortToCheck) {
  $portEq = "--remote-debugging-port=$PortToCheck"
  $portSp = "--remote-debugging-port $PortToCheck"

  $procs = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue
  foreach ($proc in ($procs | Where-Object { $_.CommandLine })) {
    $cmd = [string]$proc.CommandLine
    if ($cmd.Contains($portEq) -or $cmd.Contains($portSp)) {
      $userDataDir = ''
      $m = [regex]::Match($cmd, '--user-data-dir=(?:"([^"]+)"|([^\s]+))')
      if ($m.Success) {
        if ($m.Groups[1].Success) {
          $userDataDir = $m.Groups[1].Value
        } else {
          $userDataDir = $m.Groups[2].Value
        }
      }

      return [pscustomobject]@{
        ProcessId   = $proc.ProcessId
        CommandLine = $cmd
        UserDataDir = $userDataDir
      }
    }
  }

  return $null
}

function Get-DevToolsInfo([int]$PortToCheck) {
  $result = [ordered]@{
    Ok                   = $false
    VersionUrl           = "http://127.0.0.1:$PortToCheck/json/version"
    ListUrl              = "http://127.0.0.1:$PortToCheck/json/list"
    WebSocketDebuggerUrl = $null
    Browser              = $null
    PageCount            = 0
  }

  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $result.VersionUrl -TimeoutSec 2
    if ($r.StatusCode -eq 200) {
      $json = $r.Content | ConvertFrom-Json
      $result.Browser = $json.Browser
      $result.WebSocketDebuggerUrl = $json.webSocketDebuggerUrl
      if ($json.webSocketDebuggerUrl) {
        $result.Ok = $true
      }
    }
  } catch {
  }

  try {
    $r2 = Invoke-WebRequest -UseBasicParsing -Uri $result.ListUrl -TimeoutSec 2
    if ($r2.StatusCode -eq 200) {
      $json2 = $r2.Content | ConvertFrom-Json
      if ($json2) {
        $result.PageCount = @($json2).Count
      }
    }
  } catch {
  }

  return [pscustomobject]$result
}

function Get-ChromeExecutablePath {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  foreach ($command in @('chrome', 'msedge')) {
    $cmd = Get-Command $command -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -and (Test-Path $cmd.Source)) {
      return $cmd.Source
    }
  }

  return $null
}

$chromePath = Get-ChromeExecutablePath
if (!(Test-Path $chromePath)) {
  Write-Error 'No Chrome or Edge executable was found. Checked Program Files, Program Files (x86), LocalAppData, and PATH.'
  exit 1
}

$expectedUserDataDir = Normalize-Dir $UserDataDir
$existingChrome = Get-ChromeProcessForPort -PortToCheck $Port
if ($existingChrome) {
  $existingUserDataDir = Normalize-Dir $existingChrome.UserDataDir
  if ($existingUserDataDir -and $existingUserDataDir -ne $expectedUserDataDir) {
    Write-Error "Port $Port is already used by another Chrome process with a different user-data-dir. Current: $existingUserDataDir ; Expected: $expectedUserDataDir"
    exit 3
  }
}

$info = Get-DevToolsInfo -PortToCheck $Port
if ($info.Ok) {
  Write-Output "Debug Chrome is ready: http://127.0.0.1:$Port"
  Write-Output "   Browser: $($info.Browser)"
  Write-Output "   WebSocketDebuggerUrl: $($info.WebSocketDebuggerUrl)"
  Write-Output "   PageCount: $($info.PageCount)"
  Write-Output "   UserDataDir: $expectedUserDataDir"
  exit 0
}

Write-Output 'Starting debug Chrome...'
Write-Output "   Port: $Port"
Write-Output "   UserDataDir: $expectedUserDataDir"

New-Item -ItemType Directory -Force -Path $expectedUserDataDir | Out-Null

$arguments = @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$expectedUserDataDir",
  '--no-first-run',
  '--no-default-browser-check',
  $StartUrl
)

Start-Process -FilePath $chromePath -ArgumentList $arguments | Out-Null

$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  $info = Get-DevToolsInfo -PortToCheck $Port
  if ($info.Ok) {
    Write-Output "Debug Chrome started: http://127.0.0.1:$Port"
    Write-Output "   Browser: $($info.Browser)"
    Write-Output "   WebSocketDebuggerUrl: $($info.WebSocketDebuggerUrl)"
    Write-Output "   PageCount: $($info.PageCount)"
    Write-Output "   UserDataDir: $expectedUserDataDir"
    exit 0
  }
}

Write-Error 'Debug Chrome failed to start: no DevTools endpoint became available within 20 seconds.'
exit 2
