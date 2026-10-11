# SPDX-License-Identifier: GPL-3.0-only
# Additional terms: see LICENSE-ADDITIONAL-TERMS
# Consume one clean upstream commit. The app never downloads or executes mutable upstream code.
param([Parameter(Mandatory=$true)][string]$SourceCheckout)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$sourceRoot = (Resolve-Path -LiteralPath $SourceCheckout).Path
$revision = (& git -C $sourceRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[0-9a-f]{40}$') { throw 'A committed upstream checkout is required' }
$dirty = & git -C $sourceRoot status --porcelain
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit the reviewed upstream changes before syncing' }
$moduleRoot = Join-Path $sourceRoot 'teacherdeck/module'
if (-not (Test-Path -LiteralPath (Join-Path $moduleRoot 'module.json'))) { throw 'Upstream TeacherDeck module is missing' }
function Read-CommittedBytes([string]$name) {
    if ($name -notmatch '^[A-Za-z0-9_./-]+$') { throw 'Only reviewed source paths may be read' }
    $record = & git -C $sourceRoot ls-tree $revision -- $name
    if ($LASTEXITCODE -ne 0 -or $record -notmatch '^100644 blob ') { throw 'Only regular committed files may be read' }
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = 'git'
    $start.WorkingDirectory = $sourceRoot
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.Arguments = 'show ' + $revision + ':' + $name
    $process = [Diagnostics.Process]::Start($start)
    $bytes = [IO.MemoryStream]::new()
    try {
        $process.StandardOutput.BaseStream.CopyTo($bytes)
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw 'Committed source file is unavailable' }
        return ,$bytes.ToArray()
    } finally { $bytes.Dispose(); $process.Dispose() }
}
function Get-BytesHash([byte[]]$bytes) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
}
$names = @('__init__','core','engine','windows','gentoo','gentoo_tree','recipients','verification','draft_recovery','waiting','privacy','teacherdeck_worker')
$members = @('LICENSE','teacherdeck_worker.py') + @($names | ForEach-Object { 'app/' + $_ + '.py' })
$artifactRoot = Join-Path $repoRoot 'vendor/coolreserve'
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
$relativeArchive = 'vendor/coolreserve/' + $revision + '.zip'
$archivePath = Join-Path $repoRoot $relativeArchive
if (Test-Path -LiteralPath $archivePath) { throw 'This revision is already present; retain the existing artifact' }
$temporaryArchive = Join-Path $artifactRoot ($revision + '.' + [Guid]::NewGuid().ToString('N') + '.pending')
$archive = [IO.Compression.ZipFile]::Open($temporaryArchive, [IO.Compression.ZipArchiveMode]::Create)
$files = @()
try {
    foreach ($name in $members) {
        $inputFile = Join-Path $sourceRoot $name
        if ((Get-Item -LiteralPath $inputFile -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Source links are not allowed' }
        $bytes = Read-CommittedBytes $name
        $entry = $archive.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = [DateTimeOffset]::new(2000,1,1,0,0,0,[TimeSpan]::Zero)
        $stream = $entry.Open()
        try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
        $files += @{path=$name;size=$bytes.Length;sha256=(Get-BytesHash $bytes)}
    }
} finally { $archive.Dispose() }
[IO.File]::Move($temporaryArchive, $archivePath)
$moduleFiles = @()
foreach ($name in (& git -C $sourceRoot ls-tree -r --name-only $revision -- 'teacherdeck/module/')) {
    $relative = $name.Substring('teacherdeck/module/'.Length)
    if ($relative -match '(^|/)(\.|\.\.)(/|$)' -or $relative.Contains(':') -or $relative.Contains('\')) { throw 'Invalid committed module path' }
    if ($relative -match '(^|/)(node_modules|dist|\.git)(/|$)') { throw 'Only source module files may be synced' }
    $destination = Join-Path $repoRoot ('modules/coolreserve/' + $relative)
    $current = [IO.FileInfo]::new($destination)
    while ($null -ne $current -and $current.FullName -ne $repoRoot) {
        if ((Test-Path -LiteralPath $current.FullName) -and ((Get-Item -LiteralPath $current.FullName -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Destination links are not allowed' }
        $current = if ($current -is [IO.FileInfo]) { $current.Directory } else { $current.Parent }
    }
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
    $bytes = Read-CommittedBytes $name
    # A diff viewer may keep a read-only mapping open. Never truncate that file:
    # retain identical bytes, or replace it with a complete sibling file.
    $unchanged = (Test-Path -LiteralPath $destination) -and ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -eq (Get-BytesHash $bytes))
    if (-not $unchanged) {
        $pendingDestination = $destination + '.' + [Guid]::NewGuid().ToString('N') + '.pending'
        try {
            [IO.File]::WriteAllBytes($pendingDestination, $bytes)
            if (Test-Path -LiteralPath $destination) {
                [IO.File]::Replace($pendingDestination, $destination, [System.Management.Automation.Language.NullString]::Value)
            } else {
                [IO.File]::Move($pendingDestination, $destination)
            }
        } finally {
            if (Test-Path -LiteralPath $pendingDestination) { Remove-Item -LiteralPath $pendingDestination }
        }
    }
    $moduleFiles += @{path=$relative;size=$bytes.Length;sha256=(Get-BytesHash $bytes)}
}
$lock = [ordered]@{
    '$comment'='SPDX-License-Identifier: GPL-3.0-only; reviewed MIT upstream artifact; ADR-0023'
    repository='https://github.com/rochelobeJYJ/CoolReserve'
    revision=$revision
    version=([Text.Encoding]::UTF8.GetString((Read-CommittedBytes 'teacherdeck/module/module.json')) | ConvertFrom-Json).version
    archive=@{path=$relativeArchive;sha256=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()}
    files=$files
    moduleFiles=$moduleFiles
    licenseText=[Text.Encoding]::UTF8.GetString((Read-CommittedBytes 'LICENSE'))
}
$lockJson = $lock | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $repoRoot 'tools/checks/coolreserve-source.allow.json'), $lockJson + "`n", [Text.UTF8Encoding]::new($false))
Write-Output ('Pinned CoolReserve ' + $revision + ': ' + $files.Count + ' helper files, ' + $moduleFiles.Count + ' module files')
