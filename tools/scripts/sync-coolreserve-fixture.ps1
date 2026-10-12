# SPDX-License-Identifier: GPL-3.0-only
# Additional terms: see LICENSE-ADDITIONAL-TERMS
param([Parameter(Mandatory=$true)][string]$FixtureRoot, [Parameter(Mandatory=$true)][string]$SyncScript)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Assert([bool]$condition, [string]$message) { if (-not $condition) { throw $message } }
$source = Join-Path $FixtureRoot 'upstream'
$consumer = Join-Path $FixtureRoot 'consumer'
foreach ($directory in @('upstream/app','upstream/teacherdeck/module/src','consumer/tools/scripts','consumer/tools/checks')) {
    New-Item -ItemType Directory -Path (Join-Path $FixtureRoot $directory) -Force | Out-Null
}
$script = Join-Path $consumer 'tools/scripts/sync-coolreserve.ps1'
Copy-Item -LiteralPath $SyncScript -Destination $script
$names = @('__init__','core','engine','windows','gentoo','gentoo_tree','recipients','verification','draft_recovery','waiting','privacy','teacherdeck_worker')
foreach ($name in $names) { [IO.File]::WriteAllText((Join-Path $source ('app/' + $name + '.py')), '# synthetic module') }
[IO.File]::WriteAllText((Join-Path $source 'teacherdeck_worker.py'), '# synthetic worker')
[IO.File]::WriteAllText((Join-Path $source 'LICENSE'), 'MIT License - Synthetic fixture')
[IO.File]::WriteAllText((Join-Path $source 'teacherdeck/module/module.json'), '{"version":"0.1.0"}')
[IO.File]::WriteAllText((Join-Path $source 'teacherdeck/module/src/App.tsx'), 'export const value = "old synthetic";')
[IO.File]::WriteAllText((Join-Path $source 'teacherdeck/module/src/obsolete.ts'), 'export const obsolete = true;')
[IO.File]::WriteAllText((Join-Path $source 'teacherdeck/module/src/delete-late.ts'), 'export const removedLater = true;')
& git -C $source init --quiet
& git -C $source config user.name 'Synthetic Reviewer'
& git -C $source config user.email 'review@example.invalid'
& git -C $source config core.autocrlf false
function Commit-Source {
    & git -C $source add -A
    & git -C $source -c core.hooksPath=NUL commit --quiet -m 'test: update synthetic upstream'
    Assert ($LASTEXITCODE -eq 0) 'Synthetic commit failed'
}
function Invoke-Sync {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = (Get-Process -Id $PID).Path
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in @('-NoProfile','-File',$script,'-SourceCheckout',$source)) { $start.ArgumentList.Add($argument) }
    Write-Host 'Running synthetic sync in a new process'
    $process = [Diagnostics.Process]::Start($start)
    try {
        $outputTask = $process.StandardOutput.ReadToEndAsync()
        $errorTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(60000)) { $process.Kill($true); $process.WaitForExit(); throw 'Synthetic sync child timed out' }
        $output = $outputTask.GetAwaiter().GetResult()
        $errors = $errorTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw $errors }
        return $output
    } finally { $process.Dispose() }
}
function Expect-Failure([string]$reason) {
    $failed = $false
    try { Invoke-Sync | Out-Null } catch { $failed = $true; if ($reason) { Assert ($_.Exception.Message.Contains($reason)) 'Unexpected sync failure' } }
    Assert $failed 'Sync unexpectedly succeeded'
}
Commit-Source
Invoke-Sync | Out-Null
$receiptPath = Join-Path $consumer 'tools/checks/coolreserve-source.allow.json'
$destination = Join-Path $consumer 'modules/coolreserve/src/App.tsx'
$journalPath = Join-Path $consumer 'vendor/coolreserve/.sync-state.json'
$oldReceipt = [IO.File]::ReadAllText($receiptPath)
[IO.File]::WriteAllText((Join-Path $source 'teacherdeck/module/module.json'), '{"version":"0.1.1"}')
[IO.File]::WriteAllText((Join-Path $source 'teacherdeck/module/src/App.tsx'), 'export const value = "new synthetic";')
Commit-Source
$revision = (& git -C $source rev-parse HEAD).Trim()
# FileShare.Read permits hash validation but Windows rejects replacement.
$held = [IO.File]::Open($destination, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try { Expect-Failure '' } finally { $held.Dispose() }
Assert (Test-Path -LiteralPath $journalPath) 'Failure lost the recovery journal'
Assert ([IO.File]::ReadAllText($receiptPath) -eq $oldReceipt) 'Failure published the new receipt'
Assert ([IO.File]::ReadAllText($destination).Contains('old synthetic')) 'Failure damaged the locked file'
# A damaged journal cannot expand the previously managed deletion set.
$originalJournal = [IO.File]::ReadAllBytes($journalPath)
$damagedJournal = [Text.Encoding]::UTF8.GetString($originalJournal) | ConvertFrom-Json
$damagedJournal.previous[0].sha256 = '0' * 64
[IO.File]::WriteAllText($journalPath, ($damagedJournal | ConvertTo-Json -Depth 8))
Expect-Failure 'previous file receipt differs'
[IO.File]::WriteAllBytes($journalPath, $originalJournal)
# Local edits during interrupted sync cannot be silently overwritten.
[IO.File]::WriteAllText($destination, 'local synthetic edit')
Expect-Failure 'locally modified'
[IO.File]::WriteAllText($destination, 'export const value = "old synthetic";')
Invoke-Sync | Out-Null
Assert ([IO.File]::ReadAllText($destination).Contains('new synthetic')) 'Same revision retry did not finish'
Assert (-not (Test-Path -LiteralPath $journalPath)) 'Successful retry retained its journal'
Assert ((Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json).revision -eq $revision) 'Retry did not publish its receipt'
# Idempotent same-revision sync must verify and reuse the core archive.
Invoke-Sync | Out-Null
# An obsolete modified file is never removed, and no new receipt is published.
$obsolete = Join-Path $consumer 'modules/coolreserve/src/obsolete.ts'
[IO.File]::WriteAllText($obsolete, 'local obsolete edit')
Remove-Item -LiteralPath (Join-Path $source 'teacherdeck/module/src/obsolete.ts')
Commit-Source
Expect-Failure 'locally modified'
Assert ([IO.File]::ReadAllText($obsolete) -eq 'local obsolete edit') 'Local obsolete edit was removed'
[IO.File]::WriteAllText($obsolete, 'export const obsolete = true;')
Invoke-Sync | Out-Null
Assert (-not (Test-Path -LiteralPath $obsolete)) 'Obsolete upstream file remained'
# Unknown module files must fail before any mutation.
$unknown = Join-Path $consumer 'modules/coolreserve/src/local.ts'
[IO.File]::WriteAllText($unknown, 'local synthetic extra')
Expect-Failure 'unknown module file'
Assert ([IO.File]::ReadAllText($unknown) -eq 'local synthetic extra') 'Unknown file was changed'
Remove-Item -LiteralPath $unknown
# Receipt replacement itself can fail; rerun must accept already updated files.
[IO.File]::WriteAllText((Join-Path $source 'teacherdeck/module/module.json'), '{"version":"0.1.2"}')
[IO.File]::WriteAllText((Join-Path $source 'teacherdeck/module/src/new.ts'), 'export const added = true;')
Remove-Item -LiteralPath (Join-Path $source 'teacherdeck/module/src/delete-late.ts')
Commit-Source
$held = [IO.File]::Open($receiptPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try { Expect-Failure '' } finally { $held.Dispose() }
Assert (Test-Path -LiteralPath $journalPath) 'Receipt failure lost its journal'
$completedJournal = [IO.File]::ReadAllBytes($journalPath)
Assert (-not (Test-Path -LiteralPath (Join-Path $consumer 'modules/coolreserve/src/delete-late.ts'))) 'Deletion did not complete before receipt failure'
Invoke-Sync | Out-Null
Assert (-not (Test-Path -LiteralPath $journalPath)) 'Receipt retry failed to finish'
# Simulate journal cleanup failing after receipt publication: the same old/new
# journal must accept the published receipt and completed file/deletion states.
[IO.File]::WriteAllBytes($journalPath, $completedJournal)
Invoke-Sync | Out-Null
Assert (-not (Test-Path -LiteralPath $journalPath)) 'Completed receipt recovery failed'
# File-to-directory and directory-to-file migrations fail in preflight, with
# the previous receipt and tree intact and no new archive or journal.
$stableReceipt = [IO.File]::ReadAllText($receiptPath)
$stableReceiptBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($receiptPath))
$stableModuleHashes = @{}
foreach ($member in (Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json).moduleFiles) {
    $stableModuleHashes[$member.path] = (Get-FileHash -LiteralPath (Join-Path $consumer ('modules/coolreserve/' + $member.path)) -Algorithm SHA256).Hash
}
$stableApp = [IO.File]::ReadAllText($destination)
$stableNew = [IO.File]::ReadAllText((Join-Path $consumer 'modules/coolreserve/src/new.ts'))
function Assert-UnpublishedRejection {
    Assert (-not (Test-Path -LiteralPath $journalPath)) 'Structural rejection published a journal'
    Assert ([IO.File]::ReadAllText($receiptPath) -eq $stableReceipt) 'Preflight rejection changed the receipt'
    Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($receiptPath)) -eq $stableReceiptBytes) 'Preflight rejection changed receipt bytes'
    foreach ($relative in $stableModuleHashes.Keys) {
        Assert ((Get-FileHash -LiteralPath (Join-Path $consumer ('modules/coolreserve/' + $relative)) -Algorithm SHA256).Hash -eq $stableModuleHashes[$relative]) 'Preflight rejection changed module bytes'
    }
    Assert ([IO.File]::ReadAllText($destination) -eq $stableApp) 'Structural rejection changed an existing source file'
    Assert ([IO.File]::ReadAllText((Join-Path $consumer 'modules/coolreserve/src/new.ts')) -eq $stableNew) 'Structural rejection changed its conflicting file'
    $rejectedRevision = (& git -C $source rev-parse HEAD).Trim()
    Assert (-not (Test-Path -LiteralPath (Join-Path $consumer ('vendor/coolreserve/' + $rejectedRevision + '.zip')))) 'Structural rejection published its archive'
}
# Generated directories are excluded by the production file-list validator;
# committed files in those directories must be rejected before any publication.
foreach ($generated in @('coverage','target','.pnpm-store')) {
    $generatedDirectory = Join-Path $source ('teacherdeck/module/' + $generated)
    New-Item -ItemType Directory -Path $generatedDirectory | Out-Null
    $generatedFile = Join-Path $generatedDirectory 'source.ts'
    [IO.File]::WriteAllText($generatedFile, 'export const syntheticGenerated = true;')
    & git -C $source add -f -- ('teacherdeck/module/' + $generated + '/source.ts')
    Assert ($LASTEXITCODE -eq 0) 'Synthetic generated file staging failed'
    Commit-Source
    Expect-Failure 'Invalid managed file receipt'
    Assert-UnpublishedRejection
    Remove-Item -LiteralPath $generatedFile
    [IO.Directory]::Delete($generatedDirectory)
    Commit-Source
}
Remove-Item -LiteralPath (Join-Path $source 'teacherdeck/module/src/new.ts')
New-Item -ItemType Directory -Path (Join-Path $source 'teacherdeck/module/src/new.ts') | Out-Null
[IO.File]::WriteAllText((Join-Path $source 'teacherdeck/module/src/new.ts/nested.ts'), 'synthetic nested file')
Commit-Source
Expect-Failure 'structure changed'
Assert-UnpublishedRejection
# Restore the committed source before testing the opposite migration.
Remove-Item -LiteralPath (Join-Path $source 'teacherdeck/module/src/new.ts/nested.ts')
[IO.Directory]::Delete((Join-Path $source 'teacherdeck/module/src/new.ts'))
[IO.File]::WriteAllText((Join-Path $source 'teacherdeck/module/src/new.ts'), 'export const added = true;')
foreach ($file in @('App.tsx','new.ts')) { Remove-Item -LiteralPath (Join-Path $source ('teacherdeck/module/src/' + $file)) }
[IO.Directory]::Delete((Join-Path $source 'teacherdeck/module/src'))
[IO.File]::WriteAllText((Join-Path $source 'teacherdeck/module/src'), 'synthetic replacement')
Commit-Source
Expect-Failure 'structure changed'
Assert-UnpublishedRejection
Write-Output $consumer
