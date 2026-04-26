param(
  [string]$SourcePath = "$env:USERPROFILE\.openclaw\workspace\skills",
  [string]$RepoUrl = "git@github.com:ewtwd/openclaw-skills.git",
  [string]$Branch = "master",
  [string]$CommitMessage = "",
  [string]$GitUserName = "",
  [string]$GitUserEmail = "",
  [switch]$DryRun,
  [switch]$KeepTempDir
)

$ErrorActionPreference = "Stop"

function Assert-CommandExists {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Name"
  }
}

function New-TempDir {
  $dir = Join-Path $env:TEMP ("openclaw-skills-publish-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return $dir
}

function Get-GitConfigValue {
  param(
    [Parameter(Mandatory = $true)][string]$Key,
    [string]$WorkingDirectory = (Get-Location).Path
  )

  Push-Location $WorkingDirectory
  try {
    return ((& git config --get $Key | Out-String).Trim())
  }
  finally {
    Pop-Location
  }
}

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)][string[]]$Args,
    [string]$WorkingDirectory = (Get-Location).Path,
    [switch]$AllowFailure
  )

  Push-Location $WorkingDirectory
  try {
    & git @Args
    $code = $LASTEXITCODE
    if ((-not $AllowFailure) -and $code -ne 0) {
      throw ("git failed: git " + ($Args -join " ") + " (exit=" + $code + ")")
    }
    return $code
  }
  finally {
    Pop-Location
  }
}

function Remove-FilteredChildren {
  param([Parameter(Mandatory = $true)][string]$Path)

  $excludeDirNames = @("node_modules", ".git", "state", "__pycache__", "dist")
  Get-ChildItem -Path $Path -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.PSIsContainer -and ($excludeDirNames -contains $_.Name)) {
      Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
      return
    }

    if ($_.Name -like "tmp-*" -or $_.Name -like "debug-*") {
      Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Copy-SkillsTree {
  param(
    [Parameter(Mandatory = $true)][string]$From,
    [Parameter(Mandatory = $true)][string]$To
  )

  if (Test-Path -LiteralPath $To) {
    Remove-Item -LiteralPath $To -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $To | Out-Null
  Copy-Item -LiteralPath $From -Destination $To -Recurse -Force

  $nestedSkills = Join-Path $To (Split-Path $From -Leaf)
  if (Test-Path -LiteralPath $nestedSkills) {
    Get-ChildItem -LiteralPath $nestedSkills -Force | ForEach-Object {
      Move-Item -LiteralPath $_.FullName -Destination $To -Force
    }
    Remove-Item -LiteralPath $nestedSkills -Recurse -Force
  }

  Remove-FilteredChildren -Path $To
}

function Get-RemoteHeadInfo {
  param(
    [Parameter(Mandatory = $true)][string]$RemoteUrl,
    [Parameter(Mandatory = $true)][string]$TargetBranch
  )

  $heads = (& git ls-remote --heads $RemoteUrl | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($heads)) {
    return @{ IsEmpty = $true; BranchExists = $false }
  }

  $branchExists = $false
  foreach ($line in ($heads -split "`r?`n")) {
    if ($line -match ("refs/heads/" + [regex]::Escape($TargetBranch) + "$")) {
      $branchExists = $true
      break
    }
  }

  return @{ IsEmpty = $false; BranchExists = $branchExists }
}

Assert-CommandExists -Name "git"

if (-not (Test-Path -LiteralPath $SourcePath)) {
  throw ("Source path not found: " + $SourcePath)
}

$resolvedSource = (Resolve-Path -LiteralPath $SourcePath).Path
$tempDir = New-TempDir
$repoDir = Join-Path $tempDir "repo"
$skillsTarget = Join-Path $repoDir "skills"
$remoteInfo = Get-RemoteHeadInfo -RemoteUrl $RepoUrl -TargetBranch $Branch

if ([string]::IsNullOrWhiteSpace($GitUserName)) {
  $GitUserName = Get-GitConfigValue -Key "user.name"
}
if ([string]::IsNullOrWhiteSpace($GitUserName)) {
  throw "git user.name is required. Pass -GitUserName or configure git user.name first."
}
if ([string]::IsNullOrWhiteSpace($GitUserEmail)) {
  $GitUserEmail = Get-GitConfigValue -Key "user.email"
}
if ([string]::IsNullOrWhiteSpace($GitUserEmail)) {
  $GitUserEmail = ($GitUserName + "@users.noreply.github.com")
}

Write-Host ("Source: " + $resolvedSource)
Write-Host ("Repo: " + $RepoUrl)
Write-Host ("Branch: " + $Branch)
Write-Host ("Temp dir: " + $tempDir)
Write-Host ("Remote empty: " + $remoteInfo.IsEmpty)
Write-Host ("Remote branch exists: " + $remoteInfo.BranchExists)
Write-Host ("Git user.name: " + $GitUserName)
Write-Host ("Git user.email: " + $GitUserEmail)

if ($DryRun) {
  Write-Host "DRY RUN"
  Write-Host "1. detect remote state"
  Write-Host "2. clone remote repo or init temp repo if remote is empty"
  Write-Host "3. replace repo skills with local skills"
  Write-Host "4. git add / commit / push"
  exit 0
}

try {
  if ($remoteInfo.IsEmpty) {
    New-Item -ItemType Directory -Force -Path $repoDir | Out-Null
    Invoke-Git -Args @("init", "-b", $Branch) -WorkingDirectory $repoDir
    Invoke-Git -Args @("remote", "add", "origin", $RepoUrl) -WorkingDirectory $repoDir
  }
  elseif ($remoteInfo.BranchExists) {
    Invoke-Git -Args @("clone", "--depth", "1", "--branch", $Branch, $RepoUrl, $repoDir)
  }
  else {
    Invoke-Git -Args @("clone", "--depth", "1", $RepoUrl, $repoDir)
    Invoke-Git -Args @("checkout", "-b", $Branch) -WorkingDirectory $repoDir
  }

  Copy-SkillsTree -From $resolvedSource -To $skillsTarget
  Invoke-Git -Args @("config", "user.name", $GitUserName) -WorkingDirectory $repoDir
  Invoke-Git -Args @("config", "user.email", $GitUserEmail) -WorkingDirectory $repoDir

  $status = (& git -C $repoDir status --porcelain | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Host "No changes detected under skills/. Nothing to publish."
    exit 0
  }

  Invoke-Git -Args @("add", "--all") -WorkingDirectory $repoDir

  if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
    $CommitMessage = "update workspace skills"
  }

  Invoke-Git -Args @("commit", "-m", $CommitMessage) -WorkingDirectory $repoDir
  Invoke-Git -Args @("push", "-u", "origin", $Branch) -WorkingDirectory $repoDir

  $commitHash = (& git -C $repoDir rev-parse HEAD | Out-String).Trim()
  Write-Host ("Publish complete. Commit: " + $commitHash)
}
finally {
  if (-not $KeepTempDir) {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  else {
    Write-Host ("Temp dir kept: " + $tempDir)
  }
}
