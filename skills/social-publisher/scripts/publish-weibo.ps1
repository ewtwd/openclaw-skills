param(
  [string]$Text,

  [string[]]$ImagePath,

  [int]$Port = 0,

  [switch]$Submit,

  [switch]$StripTopics,

  [string]$PayloadJson,

  [string]$PayloadBase64,

  [string]$PayloadPath,

  [switch]$KeepPayloadFile
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
chcp 65001 > $null

function ConvertTo-WeiboStringArray {
  param(
    [Parameter(ValueFromPipeline = $true)]
    $Value
  )

  $result = New-Object System.Collections.Generic.List[string]

  if ($null -eq $Value) {
    return @()
  }

  if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
    foreach ($item in $Value) {
      if ($null -eq $item) { continue }
      $text = [string]$item
      if ([string]::IsNullOrWhiteSpace($text)) { continue }
      $result.Add($text)
    }
    return $result.ToArray()
  }

  $single = [string]$Value
  if ([string]::IsNullOrWhiteSpace($single)) {
    return @()
  }

  return @($single)
}

function ConvertFrom-Utf8Base64 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $bytes = [System.Convert]::FromBase64String($Value)
  return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Get-WeiboPayloadValue {
  param(
    [Parameter(Mandatory = $true)]
    $Payload,

    [Parameter(Mandatory = $true)]
    [string[]]$Names
  )

  foreach ($name in $Names) {
    $property = $Payload.PSObject.Properties[$name]
    if ($property) {
      return $property.Value
    }
  }

  return $null
}

$payload = $null
$resolvedPayloadPath = $null
$payloadSourceCount = 0
if ($PayloadJson) { $payloadSourceCount++ }
if ($PayloadBase64) { $payloadSourceCount++ }
if ($PayloadPath) { $payloadSourceCount++ }

if ($payloadSourceCount -gt 1) {
  throw '不能同时传 -PayloadJson、-PayloadBase64 和 -PayloadPath。'
}

if ($PayloadBase64) {
  try {
    $payload = ConvertFrom-Utf8Base64 -Value $PayloadBase64 | ConvertFrom-Json
  } catch {
    throw "-PayloadBase64 解析失败：$($_.Exception.Message)"
  }
} elseif ($PayloadJson) {
  try {
    $payload = $PayloadJson | ConvertFrom-Json
  } catch {
    throw "-PayloadJson 解析失败：$($_.Exception.Message)"
  }
} elseif ($PayloadPath) {
  try {
    $resolvedPayloadPath = (Resolve-Path -LiteralPath $PayloadPath -ErrorAction Stop).Path
  } catch {
    throw "-PayloadPath 无效：$PayloadPath"
  }

  try {
    $payloadContent = [System.IO.File]::ReadAllText($resolvedPayloadPath, [System.Text.UTF8Encoding]::new($false))
    $payload = $payloadContent | ConvertFrom-Json
  } catch {
    throw "-PayloadPath 解析失败：$($_.Exception.Message)"
  }
}

$publishText = $Text
$publishAssets = ConvertTo-WeiboStringArray $ImagePath
$resolvedPortInput = $Port
$shouldSubmit = $Submit.IsPresent
$shouldStripTopics = $StripTopics.IsPresent

if ($payload) {
  if (-not $PSBoundParameters.ContainsKey('Text')) {
    $publishText = [string](Get-WeiboPayloadValue -Payload $payload -Names @('text', 'caption', 'content'))
  }

  if (-not $PSBoundParameters.ContainsKey('ImagePath')) {
    $publishAssets = ConvertTo-WeiboStringArray (Get-WeiboPayloadValue -Payload $payload -Names @('assets', 'media', 'imagePath', 'imagePaths'))
  }

  if (-not $PSBoundParameters.ContainsKey('Port')) {
    $payloadPort = Get-WeiboPayloadValue -Payload $payload -Names @('port')
    if ($null -ne $payloadPort -and "$payloadPort" -ne '') {
      $resolvedPortInput = [int]$payloadPort
    }
  }

  if (-not $PSBoundParameters.ContainsKey('Submit')) {
    $payloadSubmit = Get-WeiboPayloadValue -Payload $payload -Names @('submit')
    if ($null -ne $payloadSubmit) {
      $shouldSubmit = [bool]$payloadSubmit
    }
  }

  if (-not $PSBoundParameters.ContainsKey('StripTopics')) {
    $payloadStripTopics = Get-WeiboPayloadValue -Payload $payload -Names @('stripTopics')
    if ($null -ne $payloadStripTopics) {
      $shouldStripTopics = [bool]$payloadStripTopics
    }
  }
}

if ([string]::IsNullOrWhiteSpace($publishText)) {
  throw '缺少微博文案：请传 -Text，或在 payload 中提供 text。'
}

if ($shouldStripTopics) {
  $publishText = $publishText -replace '#[^#\r\n]{1,80}#', ' '
  $publishText = $publishText -replace '(?<!\S)#[^\s#]{1,80}', ' '
  $publishText = ($publishText -replace '\s+', ' ').Trim()
}

. (Join-Path $PSScriptRoot 'weibo-port-state.ps1')

$exitCode = 1

try {
  $resolvedPort = Resolve-WeiboPort -Port $resolvedPortInput
  $cdpp = Get-WeiboCdpp -Port $resolvedPort
  $userDataDir = Get-WeiboUserDataDir -Port $resolvedPort

  Set-Location $PSScriptRoot
  $ensureExitCode = Invoke-WeiboPowerShellFile -FilePath (Join-Path $PSScriptRoot 'ensure-debug-chrome.ps1') -ArgumentList @('-Port', $resolvedPort, '-StartUrl', 'https://weibo.com/', '-UserDataDir', $userDataDir)
  if ($ensureExitCode -ne 0) {
    Write-Error 'debug chrome start failed.'
    $exitCode = $ensureExitCode
  } else {
    $args = @('.\social-publisher.mjs', '--weibo', $publishText, '--host', '--cdpp', $cdpp)
    foreach ($img in ($publishAssets | Where-Object { $_ })) {
      $args += @('--image', $img)
    }
    if ($shouldSubmit) {
      $args += '--submit'
    }

    & node @args
    $exitCode = $LASTEXITCODE
  }
}
finally {
  if ($resolvedPayloadPath -and -not $KeepPayloadFile.IsPresent -and (Test-Path -LiteralPath $resolvedPayloadPath)) {
    try {
      Remove-Item -LiteralPath $resolvedPayloadPath -Force -ErrorAction Stop
      Write-Host "已删除 payload 文件: $resolvedPayloadPath"
    } catch {
      Write-Warning "payload 文件删除失败：$($_.Exception.Message)"
    }
  }

  if (Get-Command Wait-WeiboIfInteractive -ErrorAction SilentlyContinue) {
    Wait-WeiboIfInteractive
  }
}

exit $exitCode
