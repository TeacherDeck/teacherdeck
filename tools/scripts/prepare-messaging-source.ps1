# SPDX-License-Identifier: GPL-3.0-only
# Additional terms: see LICENSE-ADDITIONAL-TERMS
# Extract only the fixed upstream source artifact, validating every original file.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$sourceLock = Get-Content -LiteralPath (Join-Path $repoRoot 'tools/checks/coolreserve-source.allow.json') -Raw | ConvertFrom-Json
$archivePath = [IO.Path]::GetFullPath((Join-Path $repoRoot $sourceLock.archive.path))
$sourceRoot = Join-Path $repoRoot 'apps/desktop/src-tauri/resources/native/coolreserve/source'
if (-not $archivePath.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source artifact escapes repository' }
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sourceLock.archive.sha256) { throw 'Source archive mismatch' }
New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    if ($archive.Entries.Count -ne $sourceLock.files.Count) { throw 'Unexpected archive entries' }
    $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $sourceLock.files) {
        if ([IO.Path]::IsPathRooted($file.path) -or $file.path -match '(^|[/\\])\.\.([/\\]|$)' -or $file.path.Contains(':') -or -not $expected.Add($file.path)) { throw 'Invalid source member' }
        $destination = [IO.Path]::GetFullPath((Join-Path $sourceRoot $file.path))
        if (-not $destination.StartsWith($sourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source member escapes output' }
        $ancestor = $destination
        while ($ancestor -and $ancestor.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
            if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Reparse source path is not allowed' }
            $ancestor = [IO.Path]::GetDirectoryName($ancestor)
        }
        $entry = $archive.GetEntry($file.path)
        if ($null -eq $entry -or $entry.Length -ne $file.size) { throw 'Source member is missing' }
        $stream = $entry.Open()
        $buffer = [IO.MemoryStream]::new()
        try { $stream.CopyTo($buffer); $bytes = $buffer.ToArray() } finally { $stream.Dispose(); $buffer.Dispose() }
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $digest = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
        if ($digest -ne $file.sha256) { throw 'Source member hash mismatch' }
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
        [IO.File]::WriteAllBytes($destination, $bytes)
    }
    foreach ($present in Get-ChildItem -LiteralPath $sourceRoot -Recurse -Force -File) {
        $relative = $present.FullName.Substring($sourceRoot.Length + 1).Replace('\', '/')
        if (-not $expected.Contains($relative)) { throw 'Unexpected source file; preserve it and inspect the build output' }
    }
    Write-Output ('Verified CoolReserve source: ' + $expected.Count + ' files')
} finally { $archive.Dispose() }
