$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$script:SupportedWeiboPorts = @(9333, 9334)
$script:DefaultWeiboPort = 9333

function Get-WeiboStateDir {
  $dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'state'
  if (!(Test-Path $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  return $dir
}

function Get-WeiboActivePortFile {
  return Join-Path (Get-WeiboStateDir) 'active-weibo-port.txt'
}

function Test-WeiboPortSupported {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  return $script:SupportedWeiboPorts -contains $Port
}

function Assert-WeiboPortSupported {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  if (!(Test-WeiboPortSupported -Port $Port)) {
    throw "不支持的微博端口：$Port。当前仅支持：$($script:SupportedWeiboPorts -join ', ')"
  }
}

function Get-DefaultWeiboPort {
  return $script:DefaultWeiboPort
}

function Get-ActiveWeiboPort {
  $file = Get-WeiboActivePortFile
  if (Test-Path $file) {
    $raw = (Get-Content -Path $file -Raw -ErrorAction SilentlyContinue).Trim()
    $port = 0
    if ([int]::TryParse($raw, [ref]$port) -and (Test-WeiboPortSupported -Port $port)) {
      return $port
    }
  }

  $defaultPort = Get-DefaultWeiboPort
  Set-Content -Path $file -Value $defaultPort -Encoding UTF8
  return $defaultPort
}

function Set-ActiveWeiboPort {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  Assert-WeiboPortSupported -Port $Port
  $file = Get-WeiboActivePortFile
  Set-Content -Path $file -Value $Port -Encoding UTF8
  return $Port
}

function Resolve-WeiboPort {
  param(
    [int]$Port = 0
  )

  if ($Port -gt 0) {
    Assert-WeiboPortSupported -Port $Port
    return $Port
  }

  return Get-ActiveWeiboPort
}

function Get-WeiboUserDataDir {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  Assert-WeiboPortSupported -Port $Port
  return (Join-Path $env:TEMP ("social-publisher-chrome-{0}" -f $Port))
}

function Get-WeiboCdpp {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  Assert-WeiboPortSupported -Port $Port
  return "http://127.0.0.1:$Port"
}

function Get-WeiboShellExecutable {
  try {
    $currentProcess = Get-Process -Id $PID -ErrorAction Stop
    if ($currentProcess.Path -and (Test-Path $currentProcess.Path)) {
      return $currentProcess.Path
    }
  } catch {
  }

  $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($pwsh) {
    return $pwsh.Source
  }

  $powershell = Get-Command powershell -ErrorAction SilentlyContinue
  if ($powershell) {
    return $powershell.Source
  }

  return 'powershell'
}

function Invoke-WeiboPowerShellFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [object[]]$ArgumentList = @()
  )

  $shellExe = Get-WeiboShellExecutable
  & $shellExe -ExecutionPolicy Bypass -File $FilePath @ArgumentList 2>&1 | Out-Host
  return [int]$LASTEXITCODE
}

function Wait-WeiboIfInteractive {
  try {
    if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
      pause
    }
  } catch {
  }
}

function Get-AlternateWeiboPort {
  param(
    [Parameter(Mandatory = $true)]
    [int]$CurrentPort
  )

  Assert-WeiboPortSupported -Port $CurrentPort

  foreach ($port in $script:SupportedWeiboPorts) {
    if ($port -ne $CurrentPort) {
      return $port
    }
  }

  throw "未找到端口 $CurrentPort 对应的备用微博端口。"
}
