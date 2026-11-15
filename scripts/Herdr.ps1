#requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Position=0,Mandatory)][ValidateSet('Doctor','Start','RunRole','Status','Record','Gate')][string]$Action,
    [string]$Project = (Get-Location).Path,
    [string]$Request,
    [string]$Config,
    [string]$Task,
    [string]$StateHome,
    [ValidateSet('project-manager','planner','executor','reviewer','version-controller')][string]$Role = 'project-manager',
    [string]$Report,
    [ValidateSet('passed','changes-requested')][string]$Decision,
    [switch]$Preview,
    [switch]$NoLaunch
)
$ErrorActionPreference = 'Stop'
$previousStateHome = $env:HERDRCONFIG_STATE_HOME
if ($StateHome) { $env:HERDRCONFIG_STATE_HOME = $StateHome }
Import-Module "$PSScriptRoot/HerdrConfig.psm1" -Force
$taskLock = $null
try {
    if ($Action -in @('RunRole','Record','Gate','Status')) {
        $data = Get-Task $Task
        try { $taskLock = [IO.File]::Open((Join-Path $data.directory 'task.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch { throw 'Another launcher operation owns this task. Wait for it to finish; inspect hc before retrying a launch.' }
    }
    $result = switch ($Action) {
        Doctor {
            $team = Get-TeamConfig $Config
            $names = @('git','hc','herdr-app') + @($team.profiles.Values | ForEach-Object { $_.command[0] })
            $programs = @($names | Sort-Object -Unique | ForEach-Object { @{ program = $_; installed = [bool](Get-Command $_ -ErrorAction SilentlyContinue) } })
            @{ programs = $programs; coreHome = Get-CoreHome; stateHome = Get-StateRoot; roles = $team.roles; note = 'Presence does not verify login or live task execution.' }
        }
        Start {
            if ($Preview) {
                @{ project = Get-ProjectRoot $Project; team = Get-TeamConfig $Config; request = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Request).Path); stateHome = Get-StateRoot }
            } else {
                $data = New-Task $Project $Request $Config
                $taskLock = [IO.File]::Open((Join-Path $data.directory 'task.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
                Write-Host "Task: $($data.state.id) — $($data.directory)"
                if ($NoLaunch) { $data.state } else { Start-Role $data 'project-manager' }
            }
        }
        RunRole { Start-Role (Get-Task $Task) $Role -Preview:$Preview }
        Status { (Get-Task $Task).state }
        Record { Add-TaskReport (Get-Task $Task) $Role $Report $Decision }
        Gate { Assert-Gate (Get-Task $Task) }
    }
    $result | ConvertTo-Json -Depth 30
} catch { Write-Error $_ -ErrorAction Continue; exit 1 }
finally { if ($taskLock) { $taskLock.Dispose() }; $env:HERDRCONFIG_STATE_HOME = $previousStateHome }
