param(
  [string]$TargetPath = "$env:USERPROFILE\.openclaw\workspace\skills",
  [string]$BackupRoot = "$env:USERPROFILE\.openclaw\workspace\skills-backups",
  [string]$ZipUrl = "https://github.com/ewtwd/openclaw-skills/archive/refs/heads/master.zip",
  [switch]$DryRun,
  [switch]$KeepTempDir,
  [switch]$SkipInstallDeps
)

$ErrorActionPreference = "Stop"

function Assert-CommandExists {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Name"
  }
}

function New-TempDir {
  $dir = Join-Path $env:TEMP ("openclaw-skills-install-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return $dir
}

function Get-TimestampString {
  return (Get-Date).ToString("yyyy-MM-dd-HHmmss")
}

function Backup-Directory {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$BackupBase
  )

  if (-not (Test-Path -LiteralPath $Source)) {
    return $null
  }

  New-Item -ItemType Directory -Force -Path $BackupBase | Out-Null
  $backupDir = Join-Path $BackupBase (Get-TimestampString)
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  $backupTarget = Join-Path $backupDir "skills"
  Copy-Item -LiteralPath $Source -Destination $backupTarget -Recurse -Force
  return $backupTarget
}

function Expand-ZipFile {
  param(
    [Parameter(Mandatory = $true)][string]$ZipPath,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  Expand-Archive -LiteralPath $ZipPath -DestinationPath $Destination -Force
}

function Get-ExtractedSkillsPath {
  param([Parameter(Mandatory = $true)][string]$ExtractRoot)

  $candidates = Get-ChildItem -Path $ExtractRoot -Directory -ErrorAction SilentlyContinue
  foreach ($candidate in $candidates) {
    $skillsPath = Join-Path $candidate.FullName "skills"
    if (Test-Path -LiteralPath $skillsPath) {
      return $skillsPath
    }
  }

  throw "skills directory not found inside extracted archive"
}

function Get-RepoUrlFromZipUrl {
  param([Parameter(Mandatory = $true)][string]$Value)

  $match = [regex]::Match($Value, '^https://github\.com/([^/]+/[^/]+)/archive/refs/heads/.+$')
  if (-not $match.Success) {
    throw "Cannot infer repo URL from ZipUrl: $Value"
  }

  return ("https://github.com/" + $match.Groups[1].Value + ".git")
}

function Download-Or-Clone-Skills {
  param(
    [Parameter(Mandatory = $true)][string]$ArchiveUrl,
    [Parameter(Mandatory = $true)][string]$ZipFile,
    [Parameter(Mandatory = $true)][string]$ExtractRoot
  )

  try {
    Invoke-WebRequest -Uri $ArchiveUrl -OutFile $ZipFile -UseBasicParsing
    Expand-ZipFile -ZipPath $ZipFile -Destination $ExtractRoot
    $skillsPath = Get-ExtractedSkillsPath -ExtractRoot $ExtractRoot
    return @{ Mode = 'zip'; SkillsPath = $skillsPath }
  }
  catch {
    Write-Host ("Zip download failed, falling back to git clone: " + $_.Exception.Message)
    Assert-CommandExists -Name "git"

    $repoUrl = Get-RepoUrlFromZipUrl -Value $ArchiveUrl
    $cloneDir = Join-Path $ExtractRoot "repo-clone"
    & git clone --depth 1 --branch master $repoUrl $cloneDir
    if ($LASTEXITCODE -ne 0) {
      throw "git clone fallback failed"
    }

    $skillsPath = Join-Path $cloneDir "skills"
    if (-not (Test-Path -LiteralPath $skillsPath)) {
      throw "skills directory not found in cloned repo"
    }

    return @{ Mode = 'git'; SkillsPath = $skillsPath }
  }
}

function Install-SkillDependencies {
  param([Parameter(Mandatory = $true)][string]$SkillsRoot)

  $skillDirs = Get-ChildItem -Path $SkillsRoot -Directory -ErrorAction SilentlyContinue
  foreach ($skillDir in $skillDirs) {
    $lockFile = Join-Path $skillDir.FullName "package-lock.json"
    $packageFile = Join-Path $skillDir.FullName "package.json"

    if (Test-Path -LiteralPath $lockFile) {
      Write-Host ("Installing deps with npm ci: " + $skillDir.Name)
      Push-Location $skillDir.FullName
      try {
        & npm ci
        if ($LASTEXITCODE -ne 0) {
          throw ("npm ci failed: " + $skillDir.Name)
        }
      }
      finally {
        Pop-Location
      }
    }
    elseif (Test-Path -LiteralPath $packageFile) {
      Write-Host ("Installing deps with npm install: " + $skillDir.Name)
      Push-Location $skillDir.FullName
      try {
        & npm install
        if ($LASTEXITCODE -ne 0) {
          throw ("npm install failed: " + $skillDir.Name)
        }
      }
      finally {
        Pop-Location
      }
    }
  }
}

$resolvedTarget = [System.IO.Path]::GetFullPath($TargetPath)
$resolvedBackupRoot = [System.IO.Path]::GetFullPath($BackupRoot)
$tempDir = New-TempDir
$zipPath = Join-Path $tempDir "skills.zip"
$extractDir = Join-Path $tempDir "extract"

Write-Host ("Target: " + $resolvedTarget)
Write-Host ("Backup root: " + $resolvedBackupRoot)
Write-Host ("Zip URL: " + $ZipUrl)
Write-Host ("Temp dir: " + $tempDir)

if ($DryRun) {
  Write-Host "DRY RUN"
  Write-Host "1. backup local skills"
  Write-Host "2. download GitHub zip"
  Write-Host "3. extract archive and find skills/"
  Write-Host "4. replace local workspace/skills"
  Write-Host "5. install dependencies"
  exit 0
}

try {
  $backupPath = Backup-Directory -Source $resolvedTarget -BackupBase $resolvedBackupRoot
  if ($backupPath) {
    Write-Host ("Backup created at: " + $backupPath)
  }
  else {
    Write-Host "No local skills found. Backup skipped."
  }

  $downloadResult = Download-Or-Clone-Skills -ArchiveUrl $ZipUrl -ZipFile $zipPath -ExtractRoot $extractDir
  $downloadedSkillsPath = $downloadResult.SkillsPath
  Write-Host ("Fetch mode: " + $downloadResult.Mode)

  if (Test-Path -LiteralPath $resolvedTarget) {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $resolvedTarget -Parent) | Out-Null
  Copy-Item -LiteralPath $downloadedSkillsPath -Destination $resolvedTarget -Recurse -Force

  Write-Host "skills directory replaced."

  if (-not $SkipInstallDeps) {
    Assert-CommandExists -Name "npm"
    Install-SkillDependencies -SkillsRoot $resolvedTarget
  }
  else {
    Write-Host "Dependency installation skipped."
  }

  Write-Host "Install complete."
}
finally {
  if (-not $KeepTempDir) {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  else {
    Write-Host ("Temp dir kept: " + $tempDir)
  }
}
