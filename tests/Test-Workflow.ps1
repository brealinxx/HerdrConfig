#requires -Version 7.2
$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot/../scripts/HerdrConfig.psm1" -Force
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('herdrconfig-tests-' + [guid]::NewGuid().ToString('N'))
$oldState = $env:HERDRCONFIG_STATE_HOME
$count = 0
function Assert($Condition, $Message) { if (!$Condition) { throw $Message }; $script:count++ }
function MustFail([scriptblock]$Action, [string]$Pattern) {
    try { & $Action; throw 'Expected failure was not raised.' } catch { if ($_.Exception.Message -notmatch $Pattern) { throw }; $script:count++ }
}
try {
    [void][IO.Directory]::CreateDirectory($scratch)
    $env:HERDRCONFIG_STATE_HOME = Join-Path $scratch 'state'
    $repo = Join-Path $scratch "项目 space 'quoted'"
    [void][IO.Directory]::CreateDirectory($repo)
    [void](Invoke-Tool git @('init','-b','dev',$repo))
    [void](Invoke-Tool git @('config','user.name','HerdrConfig Tests') $repo)
    [void](Invoke-Tool git @('config','user.email','test@example.invalid') $repo)
    $request = Join-Path $scratch 'request.md'
    [IO.File]::WriteAllText($request, 'Implement a fixture change; preserve baseline.')
    $report = Join-Path $scratch 'report.md'
    [IO.File]::WriteAllText($report, 'Inspected fixture diff and verified expected content.')
    $data = New-Task $repo $request
    Assert ($data.state.stage -eq 'planning') 'Initial stage wrong.'
    Assert (!$data.state.reviewSnapshot) 'Unexpected initial review.'
    MustFail { Assert-Gate $data } 'not passed'
    MustFail { Get-RoleLaunch $data reviewer } 'cannot launch'
    [void](Add-TaskReport $data planner $report)
    Assert ($data.state.stage -eq 'ready') 'Planner transition failed.'
    $file = Join-Path $repo '中文 空格.txt'
    [IO.File]::WriteAllText($file, 'v1')
    [void](Add-TaskReport $data executor $report)
    Assert ($data.state.stage -eq 'review-pending') 'Executor transition failed.'
    [IO.File]::WriteAllText($file, 'v2')
    MustFail { Add-TaskReport $data reviewer $report passed } 'snapshot changed'
    [void](Add-TaskReport $data executor $report)
    [void](Add-TaskReport $data reviewer $report 'changes-requested')
    Assert ($data.state.stage -eq 'changes-requested') 'Review rejection failed.'
    [void](Add-TaskReport $data executor $report)
    [void](Add-TaskReport $data reviewer $report passed)
    Assert ((Assert-Gate $data).passed) 'Approved gate failed.'
    MustFail { Add-TaskReport $data 'version-controller' $report } 'Run Version Controller'
    [IO.File]::WriteAllText($file, 'v3')
    MustFail { Assert-Gate $data } 'stale'
    [void](Invoke-Tool git @('add','--','中文 空格.txt') $repo)
    [void](Invoke-Tool git @('commit','-m','fixture') $repo)
    [void](Add-TaskReport $data executor $report)
    [void](Add-TaskReport $data reviewer $report passed)
    Assert ((Assert-Gate $data).passed) 'Tracked gate failed.'
    [IO.File]::WriteAllText($file, 'staged')
    [void](Invoke-Tool git @('add','--','中文 空格.txt') $repo)
    [IO.File]::WriteAllText($file, 'v3')
    MustFail { Assert-Gate $data } 'stale'
    [void](Add-TaskReport $data executor $report)
    [void](Add-TaskReport $data reviewer $report passed)
    $preview = Start-Role $data 'version-controller' -Preview
    Assert ($preview.command[1] -eq '--no-daemon') 'Codex flag absent.'
    Assert ($preview.task.Contains($data.state.id)) 'Task not included.'
    Assert ($preview.instructions.Contains('Version Controller')) 'Role not included.'
    Assert (!(Test-Path -LiteralPath (Join-Path $repo '.herdr'))) 'Project was modified by state storage.'
    $stored = Get-Task $data.state.id
    Assert ($stored.state.stage -eq 'approved') 'Persisted stage wrong.'
    $mixed = Get-TeamConfig "$PSScriptRoot/../projects/mixed.example.json"
    Assert ($mixed.roles.planner -eq 'claude-planner') 'Role override failed.'
    Assert ($mixed.roles.executor -eq 'codex') 'Default inheritance failed.'
    $invalid = Join-Path $scratch 'bad.json'
    [IO.File]::WriteAllText($invalid, '{"schemaVersion":1,"profiles":{"codex":{"command":["codex"]}}}')
    MustFail { Get-TeamConfig $invalid } 'no-daemon'
    MustFail { Get-Task '../escape' } 'Invalid task'
    # A missing executable must fail before any hc session or UI change.
    $storedTeam = Join-Path $data.directory 'team.json'
    $team = Get-Content -Raw $storedTeam | ConvertFrom-Json -AsHashtable
    $team.profiles.codex.command = @('herdrconfig-intentionally-missing-123')
    Write-JsonFile $storedTeam $team
    MustFail { Start-Role $data 'version-controller' } 'executable missing'
    $output = Invoke-Tool git @('status','--porcelain') $repo
    Assert ($output.stdout.Contains('MM')) 'Existing staged/working changes were not preserved.'
    # A new review round revokes an old delivery gate even if content is unchanged.
    $data.state.deliveryGate = Assert-Gate $data
    [void](Add-TaskReport $data executor $report)
    [void](Add-TaskReport $data reviewer $report passed)
    Assert (!$data.state.ContainsKey('deliveryGate')) 'Old delivery gate survived a new review round.'
    $team.profiles.codex.command = @('pwsh')
    Write-JsonFile $storedTeam $team
    $data.state.ui = @{ space = 'fixture-space'; tab = 'fixture-tab' }
    # Simulate hc responses in memory; never create real terminals in regression tests.
    $module = Get-Module HerdrConfig
    & $module {
        $script:RealInvokeTool = (Get-Command Invoke-Tool).ScriptBlock
        $script:MockDelivered = $false
        function script:Invoke-Tool {
            param([string]$File,[string[]]$Arguments=@(),[string]$Directory=$script:SourceRoot,[int]$TimeoutSeconds=30,[switch]$AllowFailure,[hashtable]$Environment=@{})
            if ($File -ne 'hc') { return & $script:RealInvokeTool @PSBoundParameters }
            if ($Arguments[0] -eq 'ls') { return @{code=0;stdout='{"terminals":[]}';stderr=''} }
            if ($Arguments[0] -eq 'run') {
                return @{code=0;stdout=(@{address='fixture-terminal';first_message=@{sent=$script:MockDelivered}} | ConvertTo-Json -Compress);stderr=''}
            }
            throw 'Unexpected mock hc command.'
        }
    }
    try {
        MustFail { Start-Role $data 'version-controller' } 'First message was not sent'
        Assert (!$data.state.ContainsKey('deliveryGate')) 'Failed first-message delivery granted a gate.'
        Assert (!(Get-Task $data.state.id).state.ContainsKey('deliveryGate')) 'Failed delivery persisted a gate.'
        & $module { $script:MockDelivered = $true }
        [void](Start-Role $data 'version-controller')
        Assert ($data.state.deliveryGate.passed) 'Successful simulated delivery did not capture gate.'
        [void](Add-TaskReport $data 'version-controller' $report)
        Assert ($data.state.stage -eq 'complete') 'Delivery did not close task.'
    } finally { & $module { Set-Item Function:script:Invoke-Tool $script:RealInvokeTool } }
    $launchPrompt = (Get-RoleLaunch (New-Task $repo $request) 'project-manager').task
    Assert ($launchPrompt.Contains('-StateHome')) 'Custom state root not propagated to child instructions.'
    Assert ($launchPrompt.Contains('Implement a fixture change')) 'User request was not included in initial prompt.'
    Write-Output "PASS: $count workflow assertions (isolated real Git repositories; no agent launch)."
} finally {
    $env:HERDRCONFIG_STATE_HOME = $oldState
    $resolvedScratch = [IO.Path]::GetFullPath($scratch)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedScratch.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolvedScratch).StartsWith('herdrconfig-tests-')) {
        Remove-Item -LiteralPath $resolvedScratch -Recurse -Force
    }
}
