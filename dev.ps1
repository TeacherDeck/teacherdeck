# SPDX-License-Identifier: GPL-3.0-only
# Additional terms: see LICENSE-ADDITIONAL-TERMS
# Run the repository-pinned pnpm with project-local Corepack shims and cache.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 24 or later is required. See docs/LOCAL_SETUP.md.'
}
if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
    throw 'Corepack is required. See docs/LOCAL_SETUP.md.'
}
$nodeVersion = & node --version
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) {
    throw 'Node.js 24 or later is required. See docs/LOCAL_SETUP.md.'
}

$shimPath = Join-Path $PSScriptRoot '.pnpm-store\node_modules\.bin'
$tempPath = Join-Path $PSScriptRoot '.pnpm-store\node_modules\.tmp'
New-Item -ItemType Directory -Path $shimPath -Force | Out-Null
New-Item -ItemType Directory -Path $tempPath -Force | Out-Null
$previousEnvironment = @{
    COREPACK_HOME = $env:COREPACK_HOME
    PATH = $env:PATH
    TEMP = $env:TEMP
    TMP = $env:TMP
    PNPM_CONFIG_STORE_DIR = $env:PNPM_CONFIG_STORE_DIR
}

Push-Location $PSScriptRoot
try {
    $env:COREPACK_HOME = Join-Path $PSScriptRoot '.pnpm-store\node_modules\corepack'
    $env:TEMP = $tempPath
    $env:TMP = $tempPath
    $env:PNPM_CONFIG_STORE_DIR = Join-Path $PSScriptRoot '.pnpm-store\packages'
    & corepack enable pnpm --install-directory $shimPath
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not create project-local pnpm shims.'
    }
    $env:PATH = "$shimPath;$env:PATH"
    $cargoPath = Join-Path $env:USERPROFILE '.cargo\bin'
    if (Test-Path -LiteralPath (Join-Path $cargoPath 'cargo.exe')) {
        $env:PATH = "$cargoPath;$env:PATH"
    }
    & (Join-Path $shimPath 'pnpm.cmd') @args
    $commandExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
    $env:COREPACK_HOME = $previousEnvironment.COREPACK_HOME
    $env:PATH = $previousEnvironment.PATH
    $env:TEMP = $previousEnvironment.TEMP
    $env:TMP = $previousEnvironment.TMP
    $env:PNPM_CONFIG_STORE_DIR = $previousEnvironment.PNPM_CONFIG_STORE_DIR
}
exit $commandExitCode
