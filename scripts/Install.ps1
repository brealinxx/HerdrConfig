#requires -Version 7.2
[CmdletBinding()]
param(
    [string]$AppHome = $(if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME '.config/herdr-app' }),
    [switch]$Preview,
    [switch]$Activate,
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot/HerdrConfig.psm1" -Force
$source = Split-Path $PSScriptRoot -Parent
$AppHome = [IO.Path]::GetFullPath($AppHome)
$manifestPath = Join-Path $AppHome '.hcconfig-install.json'
$oldManifest = $null
$installLock = $null
function Invoke-App([string[]]$Arguments) { Invoke-Tool herdr-app $Arguments -Environment @{ HERDR_APP_HOME = $AppHome } }
function Safe-Target([string]$Relative) {
    if ($Relative -notmatch '^(mods/hcconfig-(team|git)/[a-zA-Z0-9_./-]+|layouts/hcconfig\.(json|svg))$' -or $Relative.Contains('..')) { throw "Invalid managed path: $Relative" }
    $target = [IO.Path]::GetFullPath((Join-Path $AppHome $Relative))
    if (!$target.StartsWith($AppHome.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Target escapes app home.' }
    $cursor = Split-Path $target -Parent
    while ($cursor.Length -ge $AppHome.Length) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -Force -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Refusing linked deployment directory: $cursor" }
        if ($cursor -eq $AppHome) { break }; $cursor = Split-Path $cursor -Parent
    }
    if ((Test-Path -LiteralPath $target) -and ((Get-Item -Force -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Refusing linked deployment file: $target" }
    return $target
}
function Assert-Owned([string]$Relative) {
    $target = Safe-Target $Relative
    if (Test-Path -LiteralPath $target) {
        if (!$oldManifest -or !$oldManifest.files.ContainsKey($Relative)) { throw "Existing unmanaged file preserved: $target" }
        $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
        if ($hash -ne $oldManifest.files[$Relative]) { throw "Locally edited file preserved: $target. Save/reconcile it before reinstalling." }
        if ((Get-Item -Force -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReadOnly) { throw "Read-only managed file preserved: $target" }
        return $hash
    }
    return $null
}
function Get-BytesHash($Bytes) { if ($null -eq $Bytes) { return $null }; [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([byte[]]$Bytes)) }
function Get-CurrentHash([string]$Path) { if (Test-Path -LiteralPath $Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }; return $null }
function Write-Managed([string]$Path, [byte[]]$Bytes) {
    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    try { [IO.File]::WriteAllBytes($temporary, $Bytes); [IO.File]::Move($temporary, $Path, $true) }
    finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
}
try {
    if (!$Preview) {
        [void][IO.Directory]::CreateDirectory($AppHome)
        try { $installLock = [IO.File]::Open((Join-Path $AppHome '.hcconfig-install.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch { throw 'Another HerdrConfig installation/removal is running.' }
    }
    $oldManifest = if (Test-Path -LiteralPath $manifestPath) { Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json -AsHashtable } else { $null }
    if ($Remove) {
        if (!$oldManifest) { throw 'No installation manifest found.' }
        foreach ($relative in $oldManifest.files.Keys) { [void](Assert-Owned $relative) }
        if ($Preview) { $oldManifest.files.Keys | Sort-Object; return }
        # Switch away before removing an active personal layout.
        $currentLayout = ((Invoke-App @('status')).stdout | ConvertFrom-Json).layout
        if ($currentLayout -eq 'hcconfig') { [void](Invoke-App @('do','layout.switch','--name',$oldManifest.previousLayout)) }
        foreach ($relative in $oldManifest.files.Keys) {
            $expectedHash = Assert-Owned $relative
            $target = Safe-Target $relative
            [void](Read-CheckedFileBytes $target $expectedHash)
            if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
        }
        Remove-Item -LiteralPath $manifestPath
        Write-Output 'Removed managed files; user files and settings preserved.'
        return
    }
    $payload = @{}
    foreach ($file in Get-ChildItem -LiteralPath "$source/herdr/mods" -Recurse -File | Where-Object { $_.Name -notin @('gpui-kit.d.ts','herdr.d.ts','jsconfig.json') -and $_.Extension -ne '.error' }) {
        $relative = [IO.Path]::GetRelativePath("$source/herdr", $file.FullName).Replace('\','/')
        $payload[$relative] = [IO.File]::ReadAllBytes($file.FullName)
    }
    $layout = Get-Content -Raw -LiteralPath "$source/herdr/layouts/hcconfig.json" | ConvertFrom-Json -AsHashtable
    function Set-Launcher($Node) {
        if ($Node.ContainsKey('content') -and $Node.content.mod -eq 'hcconfig-team') {
            $Node.content.props.launcher = (Join-Path $source 'scripts/Herdr.ps1').Replace('\','/')
        }
        if ($Node.ContainsKey('children')) { foreach ($child in $Node.children) { Set-Launcher $child } }
    }
    Set-Launcher $layout
    $payload['layouts/hcconfig.json'] = [Text.Encoding]::UTF8.GetBytes(($layout | ConvertTo-Json -Depth 30))
    $payload['layouts/hcconfig.svg'] = [IO.File]::ReadAllBytes("$source/herdr/layouts/hcconfig.svg")
    foreach ($relative in $payload.Keys) { [void](Assert-Owned $relative) }
    if ($oldManifest) {
        foreach ($relative in $oldManifest.files.Keys) {
            if (!$payload.ContainsKey($relative)) { throw "Previously installed file removed from source: $relative. Use -Remove before installing this version." }
        }
    }
    if ($Preview) {
        [ordered]@{ appHome = $AppHome; files = @($payload.Keys | Sort-Object); activate = [bool]$Activate; note = 'No files changed. Mods run local Git and launch explicitly requested agent tasks; no network calls of their own.' } | ConvertTo-Json -Depth 5
        return
    }
    $previousLayout = if ($oldManifest) { $oldManifest.previousLayout } else { ((Invoke-App @('status')).stdout | ConvertFrom-Json).layout }
    $saved = @{}; $installed = @{}
    $oldManifestBytes = if (Test-Path -LiteralPath $manifestPath) { [IO.File]::ReadAllBytes($manifestPath) } else { $null }
    $writtenManifestHash = $null
    try {
        foreach ($relative in $payload.Keys) {
            $expectedHash = Assert-Owned $relative
            $target = Safe-Target $relative
            $saved[$relative] = Read-CheckedFileBytes $target $expectedHash
            [void][IO.Directory]::CreateDirectory((Split-Path $target -Parent))
            if ((Get-CurrentHash $target) -ne (Get-BytesHash $saved[$relative])) { throw "File changed during installation: $target" }
            Write-Managed $target $payload[$relative]
            $installed[$relative] = Get-BytesHash $payload[$relative]
        }
        foreach ($mod in @('hcconfig-team','hcconfig-git')) { [void](Invoke-App @('check',(Join-Path $AppHome "mods/$mod"))) }
        foreach ($relative in $installed.Keys) { if ((Get-CurrentHash (Safe-Target $relative)) -ne $installed[$relative]) { throw "File changed during validation: $relative" } }
        if ((Get-CurrentHash $manifestPath) -ne (Get-BytesHash $oldManifestBytes)) { throw 'Installation manifest changed concurrently.' }
        Write-JsonFile $manifestPath @{ schemaVersion = 1; source = $source; previousLayout = $previousLayout; files = $installed }
        $writtenManifestHash = Get-CurrentHash $manifestPath
        if ($Activate) { [void](Invoke-App @('do','layout.switch','--name','hcconfig')) }
        Write-Output "Installed $($installed.Count) files. Layout: hcconfig. Activation: $Activate"
    } catch {
        $installError = $_
        $recoveryErrors = [Collections.Generic.List[string]]::new()
        foreach ($relative in $saved.Keys) {
            try {
                $target = Safe-Target $relative
                $current = Get-CurrentHash $target
                if ($current -eq (Get-BytesHash $saved[$relative])) { continue }
                if (!$installed.ContainsKey($relative) -or $current -ne $installed[$relative]) { throw "Concurrent edit preserved during rollback: $target" }
                if ($null -eq $saved[$relative]) { Remove-Item -LiteralPath $target }
                else { Write-Managed $target $saved[$relative] }
            } catch { $recoveryErrors.Add($_.Exception.Message) }
        }
        try {
            $current = Get-CurrentHash $manifestPath
            if ($current -ne (Get-BytesHash $oldManifestBytes)) {
                if (!$writtenManifestHash -or $current -ne $writtenManifestHash) { throw 'Concurrent manifest edit preserved.' }
                if ($null -eq $oldManifestBytes) { Remove-Item -LiteralPath $manifestPath }
                else { Write-Managed $manifestPath $oldManifestBytes }
            }
        } catch { $recoveryErrors.Add($_.Exception.Message) }
        if ($recoveryErrors.Count) { throw "$($installError.Exception.Message) Rollback diagnostics: $($recoveryErrors -join '; ')" }
        throw $installError
    }
} catch { Write-Error $_ -ErrorAction Continue; exit 1 }
finally { if ($installLock) { $installLock.Dispose() } }
