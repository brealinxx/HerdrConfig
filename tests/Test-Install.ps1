#requires -Version 7.2
# Requires herdr-app; uses an isolated app home and a deliberately broken fixture mod.
$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot/../scripts/HerdrConfig.psm1" -Force
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('herdrconfig-install-tests-' + [guid]::NewGuid().ToString('N'))
$count = 0
function Assert($Condition, $Message) { if (!$Condition) { throw $Message }; $script:count++ }
try {
    $source = Join-Path $scratch 'source'
    $target = Join-Path $scratch 'app'
    foreach ($folder in @('scripts','herdr/layouts','herdr/mods/hcconfig-team','herdr/mods/hcconfig-git')) { [void][IO.Directory]::CreateDirectory((Join-Path $source $folder)) }
    [void][IO.Directory]::CreateDirectory((Join-Path $target 'layouts'))
    Copy-Item -LiteralPath "$PSScriptRoot/../scripts/Install.ps1","$PSScriptRoot/../scripts/HerdrConfig.psm1" -Destination "$source/scripts"
    Copy-Item -LiteralPath "$PSScriptRoot/../herdr/layouts/hcconfig.json","$PSScriptRoot/../herdr/layouts/hcconfig.svg" -Destination "$source/herdr/layouts"
    foreach ($mod in @('hcconfig-team','hcconfig-git')) { [IO.File]::WriteAllText("$source/herdr/mods/$mod/mod.json", '{"place":"none"}') }
    [IO.File]::WriteAllText("$source/herdr/mods/hcconfig-team/main.js", 'import {View,div} from "gpui-kit"; export default class Test extends View {render(){return div().child("fixture");}}')
    [IO.File]::WriteAllText("$source/herdr/mods/hcconfig-git/main.js", 'This is deliberately invalid JavaScript !!!')
    $layoutPath = Join-Path $target 'layouts/hcconfig.json'
    [IO.File]::WriteAllText($layoutPath, 'Original layout fixture')
    [IO.File]::WriteAllText((Join-Path $target 'user-file.txt'), 'Preserve user data')
    $manifestPath = Join-Path $target '.hcconfig-install.json'
    Write-JsonFile $manifestPath @{previousLayout='main';files=@{'layouts/hcconfig.json'=(Get-FileHash $layoutPath).Hash}}
    $manifestBefore = [IO.File]::ReadAllText($manifestPath)
    $argsList = @('-NoProfile','-File',"$source/scripts/Install.ps1",'-AppHome',$target)
    $preview = Invoke-Tool pwsh ($argsList + @('-Preview'))
    Assert ($preview.code -eq 0) 'Preview failed.'
    Assert ([IO.File]::ReadAllText($layoutPath) -eq 'Original layout fixture') 'Preview changed a file.'
    Assert (!(Test-Path "$target/.hcconfig-install.lock")) 'Preview created an installation lock.'
    $failed = Invoke-Tool pwsh $argsList -AllowFailure
    Assert ($failed.code -ne 0) 'Broken mod should reject installation.'
    Assert (($failed.stderr + $failed.stdout).Contains('herdr-app failed')) 'Failure did not reach the real native mod check.'
    Assert ([IO.File]::ReadAllText($layoutPath) -eq 'Original layout fixture') 'Existing layout was not rolled back.'
    Assert ([IO.File]::ReadAllText($manifestPath) -eq $manifestBefore) 'Manifest was not preserved.'
    Assert (!(Test-Path "$target/mods/hcconfig-team/main.js")) 'Created team mod was not rolled back.'
    Assert (!(Test-Path "$target/mods/hcconfig-git/main.js")) 'Created Git mod was not rolled back.'
    Assert ([IO.File]::ReadAllText("$target/user-file.txt") -eq 'Preserve user data') 'User file was changed.'
    [IO.File]::WriteAllText($layoutPath, 'User edit after installation')
    $conflict = Invoke-Tool pwsh $argsList -AllowFailure
    Assert ($conflict.code -ne 0 -and ($conflict.stderr + $conflict.stdout).Contains('Locally edited')) 'Locally edited files were not rejected.'
    Assert ([IO.File]::ReadAllText($layoutPath) -eq 'User edit after installation') 'User edit was overwritten.'
    [IO.File]::WriteAllText($layoutPath, 'Original layout fixture')
    (Get-Item $layoutPath).IsReadOnly = $true
    try {
        $locked = Invoke-Tool pwsh $argsList -AllowFailure
        Assert ($locked.code -ne 0 -and ($locked.stderr + $locked.stdout).Contains('Read-only')) 'Read-only file was not rejected before mutation.'
        Assert (!(Test-Path "$target/layouts/hcconfig.svg")) 'Read-only rejection left partial installation.'
    } finally { (Get-Item $layoutPath).IsReadOnly = $false }
    # Inject an edit/create after ownership was observed but before backup reads.
    $expectedHash = (Get-FileHash -LiteralPath $layoutPath).Hash
    [IO.File]::WriteAllText($layoutPath, 'Concurrent editor content')
    $refused = $false
    try { [void](Read-CheckedFileBytes $layoutPath $expectedHash) } catch { $refused = $_.Exception.Message.Contains('ownership check') }
    Assert $refused 'Concurrent edit between ownership check and backup was accepted.'
    Assert ([IO.File]::ReadAllText($layoutPath) -eq 'Concurrent editor content') 'Concurrent edit was modified.'
    $newPath = Join-Path $target 'appeared.txt'
    [IO.File]::WriteAllText($newPath, 'Unexpected new file')
    $refused = $false
    try { [void](Read-CheckedFileBytes $newPath $null) } catch { $refused = $_.Exception.Message.Contains('ownership check') }
    Assert $refused 'New unknown file appearing before backup was accepted.'
    $missing = Read-CheckedFileBytes (Join-Path $target 'not-created.txt') $null
    Assert ($null -eq $missing) 'An absent file was rejected or returned bytes.'
    $empty = Join-Path $target 'empty.txt'
    [IO.File]::WriteAllBytes($empty, [byte[]]@())
    $emptyBytes = Read-CheckedFileBytes $empty (Get-FileHash $empty).Hash
    Assert ($null -ne $emptyBytes -and $emptyBytes.Length -eq 0) 'An existing empty file was confused with a missing file.'
    Write-Output "PASS: $count installer assertions (isolated app home; real failing mod validation)."
} finally {
    $resolved = [IO.Path]::GetFullPath($scratch)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved).StartsWith('herdrconfig-install-tests-')) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
