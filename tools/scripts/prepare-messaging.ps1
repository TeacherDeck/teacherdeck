# SPDX-License-Identifier: GPL-3.0-only
# Additional terms: see LICENSE-ADDITIONAL-TERMS
# Materialize only the approved fixed CPython/wheel members; never install globally.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$lockPath = Join-Path $repoRoot 'tools/checks/coolreserve-runtime.allow.json'
$approval = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
if ($approval.status -ne 'approved-2026-10-11') { throw 'Runtime approval is missing' }
$cacheRoot = Join-Path $repoRoot 'target/messaging-downloads'
$outputRoot = Join-Path $repoRoot 'apps/desktop/src-tauri/resources/native/coolreserve/python'
New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

function Get-ContainedPath([string]$directory, [string]$relative) {
    if ([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[/\\])\.\.([/\\]|$)' -or $relative.Contains(':')) { throw 'Invalid asset member' }
    $assetPath = [IO.Path]::GetFullPath((Join-Path $directory $relative))
    if (-not $assetPath.StartsWith($directory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Asset member escapes output' }
    $ancestor = $assetPath
    while ($ancestor -and $ancestor.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
        if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Reparse asset path is not allowed' }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor)
    }
    return $assetPath
}
function Get-Digest([byte[]]$bytes) {
    $digest = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($digest.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $digest.Dispose() }
}
$artifacts = @($approval.runtime)
foreach ($package in $approval.packages) { $artifacts += @($package.artifacts) }
$archives = [Collections.Generic.List[IDisposable]]::new()
$members = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::OrdinalIgnoreCase)
try {
    foreach ($artifact in $artifacts) {
        $archivePath = Get-ContainedPath $cacheRoot $artifact.filename
        if (-not (Test-Path -LiteralPath $archivePath)) {
            $reviewPath = Join-Path $repoRoot ('target/next-tools/coolreserve-runtime-review/' + $artifact.filename)
            if (Test-Path -LiteralPath $reviewPath) { Copy-Item -LiteralPath $reviewPath -Destination $archivePath }
            else {
                $uri = [Uri]$artifact.url
                if ($uri.Scheme -ne 'https' -or $uri.Host -notin @('www.python.org', 'files.pythonhosted.org')) { throw 'Unapproved download origin' }
                Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $archivePath
            }
        }
        if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $artifact.sha256) { throw 'Runtime archive hash mismatch' }
        $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
        $archives.Add($archive)
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName.EndsWith('/')) { continue }
            $memberName = if ($artifact.filename -like '*.whl') { 'Lib/site-packages/' + $entry.FullName } else { $entry.FullName }
            if ($members.ContainsKey($memberName)) { throw 'Duplicate runtime member' }
            $members.Add($memberName, $entry)
        }
    }
    $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $approval.files) {
        if (-not $expected.Add($file.path)) { throw 'Duplicate approved path' }
        $destination = Get-ContainedPath $outputRoot $file.path
        if ($file.path -eq 'python314._pth') {
            $bytes = [Convert]::FromBase64String('cHl0aG9uMzE0LnppcA0KLg0KTGliL3NpdGUtcGFja2FnZXMNCkxpYi9zaXRlLXBhY2thZ2VzL3dpbjMyDQpMaWIvc2l0ZS1wYWNrYWdlcy93aW4zMi9saWINCkxpYi9zaXRlLXBhY2thZ2VzL3B5dGhvbndpbg0K')
        } elseif ($file.path -eq 'Lib/site-packages/comtypes/gen/__init__.py') {
            $bytes = [Convert]::FromBase64String('IyBjb210eXBlcy5nZW4gcGFja2FnZSwgZGlyZWN0b3J5IGZvciBnZW5lcmF0ZWQgZmlsZXMuDQo=')
        } else {
            if (-not $members.ContainsKey($file.path)) { throw 'Approved runtime member is missing' }
            $entry = $members[$file.path]
            if ($entry.Length -ne $file.size) { throw 'Runtime member length mismatch' }
            $stream = $entry.Open()
            $buffer = [IO.MemoryStream]::new()
            try { $stream.CopyTo($buffer); $bytes = $buffer.ToArray() }
            finally { $stream.Dispose(); $buffer.Dispose() }
        }
        if ($bytes.Length -ne $file.size -or (Get-Digest $bytes) -ne $file.sha256) { throw 'Runtime member hash mismatch' }
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
        [IO.File]::WriteAllBytes($destination, $bytes)
    }
    foreach ($present in Get-ChildItem -LiteralPath $outputRoot -Recurse -Force -File) {
        $relative = $present.FullName.Substring($outputRoot.Length + 1).Replace('\', '/')
        if (-not $expected.Contains($relative)) { throw 'Unexpected file in managed runtime; preserve it and inspect the build output' }
    }
    Write-Output ('Verified managed runtime: ' + $expected.Count + ' files')
} finally { foreach ($archive in $archives) { $archive.Dispose() } }
