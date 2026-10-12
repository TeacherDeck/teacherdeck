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
function Assert-SafePath([string]$path, [string]$root) {
    $full = [IO.Path]::GetFullPath($path)
    $boundary = [IO.Path]::GetFullPath($root).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if ($full -ne $boundary -and -not $full.StartsWith($boundary + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Destination escapes the managed root' }
    $current = $full
    while ($current) {
        if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Destination links are not allowed' }
        if ($current -eq $repoRoot) { break }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}
function Assert-Members($items) {
    $seen = @{}
    foreach ($item in $items) {
        if ($item.path -notmatch '^[A-Za-z0-9_.\-/]+$' -or $item.path -match '(^|/)(\.|\.\.|node_modules|dist|\.git|target|coverage|\.pnpm-store)(/|$)' -or $item.path.StartsWith('/') -or $item.sha256 -notmatch '^[a-f0-9]{64}$' -or $item.size -lt 0) { throw 'Invalid managed file receipt' }
        if ($seen.ContainsKey($item.path)) { throw 'Duplicate managed file receipt' }
        $seen[$item.path] = $true
    }
}
function File-Matches([string]$path, $member) {
    return (Test-Path -LiteralPath $path -PathType Leaf) -and (Get-Item -LiteralPath $path).Length -eq $member.size -and (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -eq $member.sha256
}
function Publish-Bytes([string]$destination, [byte[]]$bytes, [string]$root) {
    Assert-SafePath $destination $root
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
    if ((Test-Path -LiteralPath $destination -PathType Leaf) -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -eq (Get-BytesHash $bytes)) { return }
    $pending = $destination + '.' + [Guid]::NewGuid().ToString('N') + '.pending'
    try {
        [IO.File]::WriteAllBytes($pending, $bytes)
        if (Test-Path -LiteralPath $destination) { [IO.File]::Replace($pending, $destination, [System.Management.Automation.Language.NullString]::Value) }
        else { [IO.File]::Move($pending, $destination) }
    } finally { if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending } }
}
$names = @('__init__','core','engine','windows','gentoo','gentoo_tree','recipients','verification','draft_recovery','waiting','privacy','teacherdeck_worker')
$members = @('LICENSE','teacherdeck_worker.py') + @($names | ForEach-Object { 'app/' + $_ + '.py' })
$artifactRoot = Join-Path $repoRoot 'vendor/coolreserve'
$targetRoot = Join-Path $repoRoot 'modules/coolreserve'
$receiptPath = Join-Path $repoRoot 'tools/checks/coolreserve-source.allow.json'
$journalPath = Join-Path $artifactRoot '.sync-state.json'
$relativeArchive = 'vendor/coolreserve/' + $revision + '.zip'
$archivePath = Join-Path $repoRoot $relativeArchive
foreach ($path in @($artifactRoot,$targetRoot,$receiptPath,$journalPath,$archivePath)) { Assert-SafePath $path $repoRoot }
# Read every committed byte and validate all paths before publishing anything.
$files = @()
$coreBytes = @{}
foreach ($name in $members) {
    $inputFile = Join-Path $sourceRoot $name
    if ((Get-Item -LiteralPath $inputFile -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Source links are not allowed' }
    $bytes = Read-CommittedBytes $name
    $coreBytes[$name] = $bytes
    $files += [ordered]@{path=$name;size=$bytes.Length;sha256=(Get-BytesHash $bytes)}
}
$moduleFiles = @()
$moduleBytes = @{}
$sourceNames = @(& git -C $sourceRoot ls-tree -r --name-only $revision -- 'teacherdeck/module/')
if ($LASTEXITCODE -ne 0) { throw 'Committed module file list is unavailable' }
foreach ($name in $sourceNames) {
    $relative = $name.Substring('teacherdeck/module/'.Length)
    $bytes = Read-CommittedBytes $name
    $moduleBytes[$relative] = $bytes
    $moduleFiles += [ordered]@{path=$relative;size=$bytes.Length;sha256=(Get-BytesHash $bytes)}
}
Assert-Members $moduleFiles
$version = ([Text.Encoding]::UTF8.GetString($moduleBytes['module.json']) | ConvertFrom-Json).version
$oldMembers = @()
$oldReceiptHash = $null
$oldReceiptText = $null
if (Test-Path -LiteralPath $receiptPath) {
    $oldReceiptText = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($receiptPath))
    $previous = $oldReceiptText | ConvertFrom-Json
    $oldMembers = @($previous.moduleFiles)
    Assert-Members $oldMembers
    $oldReceiptHash = (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash.ToLowerInvariant()
}
$journal = $null
if (Test-Path -LiteralPath $journalPath) {
    $journal = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
    if ($journal.revision -ne $revision) { throw 'Finish the interrupted revision before syncing a different revision' }
    Assert-Members $journal.previous
    Assert-Members $journal.next
    if ($null -eq $journal.previousReceiptText) {
        if ($null -ne $journal.previousReceiptHash -or @($journal.previous).Count -ne 0) { throw 'Invalid previous sync receipt' }
    } else {
        $previousBytes = [Text.UTF8Encoding]::new($false).GetBytes($journal.previousReceiptText)
        if ((Get-BytesHash $previousBytes) -ne $journal.previousReceiptHash) { throw 'Invalid previous sync receipt hash' }
        $snapshot = $journal.previousReceiptText | ConvertFrom-Json
        Assert-Members $snapshot.moduleFiles
        $snapshotMembers = @($snapshot.moduleFiles | ForEach-Object { $_.path + '|' + $_.size + '|' + $_.sha256 })
        $journalMembers = @($journal.previous | ForEach-Object { $_.path + '|' + $_.size + '|' + $_.sha256 })
        if (($snapshotMembers -join "`n") -cne ($journalMembers -join "`n")) { throw 'Interrupted previous file receipt differs from its snapshot' }
    }
    $expectedNext = @($moduleFiles | ForEach-Object { $_.path + '|' + $_.size + '|' + $_.sha256 })
    $savedNext = @($journal.next | ForEach-Object { $_.path + '|' + $_.size + '|' + $_.sha256 })
    if (($savedNext -join "`n") -cne ($expectedNext -join "`n")) { throw 'Interrupted module receipt differs from committed source' }
    $oldMembers = @($journal.previous)
    $oldReceiptHash = $journal.previousReceiptHash
}
$oldByPath = @{}
$newByPath = @{}
foreach ($item in $oldMembers) { $oldByPath[$item.path] = $item }
foreach ($item in $moduleFiles) { $newByPath[$item.path] = $item }
# Enumerate without following directory links; unknown files never become managed implicitly.
function Assert-ManagedTree([string]$directory) {
    if (-not (Test-Path -LiteralPath $directory)) { return }
    Assert-SafePath $directory $targetRoot
    foreach ($entry in Get-ChildItem -LiteralPath $directory -Force) {
        Assert-SafePath $entry.FullName $targetRoot
        if ($entry.PSIsContainer) {
            if ($entry.Name -in @('node_modules','dist','.git','target','coverage','.pnpm-store')) { continue }
            Assert-ManagedTree $entry.FullName
        } else {
            $relative = [IO.Path]::GetRelativePath($targetRoot, $entry.FullName).Replace('\','/')
            $script:observedPaths += $relative
            if (-not $oldByPath.ContainsKey($relative) -and -not ($journal -and $newByPath.ContainsKey($relative))) { throw 'An unknown module file blocks syncing; preserve it outside the managed module first' }
        }
    }
}
$script:observedPaths = @()
Assert-ManagedTree $targetRoot
# Path-kind migrations require an explicit reviewed migration, not a partial sync.
foreach ($member in $moduleFiles) {
    $path = Join-Path $targetRoot $member.path
    if (Test-Path -LiteralPath $path -PathType Container) { throw 'Module file/directory structure changed; review the migration before syncing' }
    $ancestor = [IO.Path]::GetDirectoryName($path)
    while ($ancestor -ne $targetRoot) {
        if (Test-Path -LiteralPath $ancestor -PathType Leaf) { throw 'Module file/directory structure changed; review the migration before syncing' }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor)
    }
}
foreach ($relative in @($oldByPath.Keys) + @($newByPath.Keys) | Select-Object -Unique) {
    $path = Join-Path $targetRoot $relative
    Assert-SafePath $path $targetRoot
    if (Test-Path -LiteralPath $path) {
        $isOld = $oldByPath.ContainsKey($relative) -and (File-Matches $path $oldByPath[$relative])
        $isNew = $journal -and $newByPath.ContainsKey($relative) -and (File-Matches $path $newByPath[$relative])
        if (-not $isOld -and -not $isNew) { throw 'A locally modified module file blocks syncing; preserve or restore it first' }
    } elseif ($oldByPath.ContainsKey($relative) -and (-not $journal -or $newByPath.ContainsKey($relative))) { throw 'A managed module file is missing; restore it before syncing' }
}
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
if (Test-Path -LiteralPath $archivePath) {
    # Retry only a verified immutable core archive, never merely an existing filename.
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        if ($archive.Entries.Count -ne $files.Count) { throw 'Existing upstream archive has a different file list' }
        $seen = @{}
        foreach ($entry in $archive.Entries) {
            if ($seen.ContainsKey($entry.FullName) -or -not $coreBytes.ContainsKey($entry.FullName)) { throw 'Existing upstream archive has a different file list' }
            $seen[$entry.FullName] = $true
            $expected = $files | Where-Object { $_.path -eq $entry.FullName } | Select-Object -First 1
            if ($entry.Length -ne $expected.size) { throw 'Existing upstream archive differs from committed source' }
            $stream = $entry.Open(); $memory = [IO.MemoryStream]::new()
            try { $stream.CopyTo($memory); if ((Get-BytesHash $memory.ToArray()) -ne $expected.sha256) { throw 'Existing upstream archive differs from committed source' } }
            finally { $stream.Dispose(); $memory.Dispose() }
        }
    } finally { $archive.Dispose() }
} else {
    $temporaryArchive = Join-Path $artifactRoot ($revision + '.' + [Guid]::NewGuid().ToString('N') + '.pending')
    try {
        $archive = [IO.Compression.ZipFile]::Open($temporaryArchive, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($name in $members) {
                $entry = $archive.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = [DateTimeOffset]::new(2000,1,1,0,0,0,[TimeSpan]::Zero)
                $stream = $entry.Open(); $bytes = $coreBytes[$name]
                try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
            }
        } finally { $archive.Dispose() }
        [IO.File]::Move($temporaryArchive, $archivePath)
    } finally { if (Test-Path -LiteralPath $temporaryArchive) { Remove-Item -LiteralPath $temporaryArchive } }
}
$lock = [ordered]@{
    '$comment'='SPDX-License-Identifier: GPL-3.0-only; reviewed MIT upstream artifact; ADR-0023'
    repository='https://github.com/rochelobeJYJ/CoolReserve'
    revision=$revision
    version=$version
    archive=[ordered]@{path=$relativeArchive;sha256=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()}
    files=$files
    moduleFiles=$moduleFiles
    licenseText=[Text.Encoding]::UTF8.GetString($coreBytes['LICENSE'])
}
$lockBytes = [Text.UTF8Encoding]::new($false).GetBytes(($lock | ConvertTo-Json -Depth 8) + "`n")
$nextReceiptHash = Get-BytesHash $lockBytes
if ($journal) {
    if ($journal.nextReceiptHash -ne $nextReceiptHash -or ($journal.previousReceiptHash -and $journal.previousReceiptHash -notmatch '^[a-f0-9]{64}$')) { throw 'Invalid interrupted sync receipt' }
    $currentHash = if (Test-Path -LiteralPath $receiptPath) { (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
    if ($currentHash -ne $oldReceiptHash -and $currentHash -ne $nextReceiptHash) { throw 'The sync receipt was changed locally; restore it before retrying' }
} else {
    $journal = [ordered]@{ revision=$revision;previous=$oldMembers;next=$moduleFiles;previousReceiptHash=$oldReceiptHash;previousReceiptText=$oldReceiptText;nextReceiptHash=$nextReceiptHash }
    Publish-Bytes $journalPath ([Text.UTF8Encoding]::new($false).GetBytes(($journal | ConvertTo-Json -Depth 8) + "`n")) $artifactRoot
}
# Failures leave the journal and immutable archive for the same reviewed revision to resume.
foreach ($member in $moduleFiles) {
    $path = Join-Path $targetRoot $member.path
    Assert-SafePath $path $targetRoot
    if (Test-Path -LiteralPath $path) {
        $isOld = $oldByPath.ContainsKey($member.path) -and (File-Matches $path $oldByPath[$member.path])
        if (-not $isOld -and -not (File-Matches $path $member)) { throw 'A locally modified module file blocks publishing' }
    } elseif ($oldByPath.ContainsKey($member.path)) { throw 'A managed module file disappeared before publishing' }
    Publish-Bytes $path $moduleBytes[$member.path] $targetRoot
}
foreach ($member in $oldMembers) {
    if (-not $newByPath.ContainsKey($member.path)) {
        $path = Join-Path $targetRoot $member.path
        Assert-SafePath $path $targetRoot
        if (Test-Path -LiteralPath $path) {
            if (-not (File-Matches $path $member)) { throw 'A locally modified obsolete module file cannot be removed' }
            Remove-Item -LiteralPath $path
        }
    }
}
$script:observedPaths = @()
Assert-ManagedTree $targetRoot
if ((@($script:observedPaths | Sort-Object) -join "`n") -cne (@($moduleFiles.path | Sort-Object) -join "`n")) { throw 'The published module file list differs from committed source' }
foreach ($member in $moduleFiles) {
    if (-not (File-Matches (Join-Path $targetRoot $member.path) $member)) { throw 'A module file changed before receipt publication' }
}
Assert-SafePath $receiptPath $repoRoot
$currentHash = if (Test-Path -LiteralPath $receiptPath) { (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
if ($currentHash -ne $oldReceiptHash -and $currentHash -ne $nextReceiptHash) { throw 'The sync receipt changed before publishing' }
Publish-Bytes $receiptPath $lockBytes $repoRoot
Assert-SafePath $journalPath $artifactRoot
Remove-Item -LiteralPath $journalPath
Write-Output ('Pinned CoolReserve ' + $revision + ': ' + $files.Count + ' helper files, ' + $moduleFiles.Count + ' module files')
