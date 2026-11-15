#requires -Version 7.2
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:SourceRoot = Split-Path $PSScriptRoot -Parent
$script:RoleNames = @('project-manager','planner','executor','reviewer','version-controller')

function Invoke-Tool {
    param([string]$File, [string[]]$Arguments = @(), [string]$Directory = $script:SourceRoot, [int]$TimeoutSeconds = 30, [switch]$AllowFailure, [hashtable]$Environment = @{})
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $File
    $info.WorkingDirectory = $Directory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $info.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    foreach ($key in $Environment.Keys) { $info.Environment[$key] = $Environment[$key] }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (!$process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill($true)
            [void]$process.WaitForExit(5000)
            throw "$File timed out after $TimeoutSeconds seconds. Inspect any hc terminal before retrying a launch."
        }
        $result = @{ code = $process.ExitCode; stdout = $stdout.GetAwaiter().GetResult(); stderr = $stderr.GetAwaiter().GetResult() }
        if ($result.code -ne 0 -and !$AllowFailure) { throw "$File failed ($($result.code)): $($result.stderr) $($result.stdout)" }
        return $result
    } finally { $process.Dispose() }
}

function Invoke-GitRead {
    param([string]$Project, [string[]]$Arguments, [switch]$AllowFailure)
    Invoke-Tool git (@('--no-optional-locks','-c','core.fsmonitor=false','-c','diff.autoRefreshIndex=false') + $Arguments) $Project -AllowFailure:$AllowFailure
}

function Get-ProjectRoot {
    param([string]$Project)
    $path = (Resolve-Path -LiteralPath $Project).Path
    (Invoke-GitRead $path @('rev-parse','--show-toplevel')).stdout -replace '\r?\n$', ''
}

function Write-JsonFile {
    param([string]$Path, $Value)
    $parent = Split-Path $Path -Parent
    [void][IO.Directory]::CreateDirectory($parent)
    $temp = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
        [IO.File]::Move($temp, $Path, $true)
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp } }
}

function Get-TeamConfig {
    param([string]$Config)
    $team = Get-Content -Raw -LiteralPath "$script:SourceRoot/config/team.json" | ConvertFrom-Json -AsHashtable
    if ($Config) {
        $extra = Get-Content -Raw -LiteralPath $Config | ConvertFrom-Json -AsHashtable
        if ($extra.schemaVersion -ne 1) { throw 'Unsupported team schemaVersion.' }
        foreach ($section in @('profiles','roles')) {
            if ($extra.ContainsKey($section)) { foreach ($key in $extra[$section].Keys) { $team[$section][$key] = $extra[$section][$key] } }
        }
    }
    foreach ($role in $script:RoleNames) {
        $profileName = $team.roles[$role]
        if (!$profileName -or !$team.profiles.ContainsKey($profileName)) { throw "Missing profile for $role." }
        $command = $team.profiles[$profileName].command
        if ($command -is [string] -or !$command -or @($command).Count -lt 1) { throw "Profile $profileName requires a command argument array." }
        foreach ($part in $command) { if ($part -isnot [string] -or $part.Contains([char]0)) { throw 'Command arguments must be strings without NUL.' } }
        $program = [IO.Path]::GetFileNameWithoutExtension($command[0])
        if ($program -eq 'codex' -and '--no-daemon' -notin $command) { throw 'Codex profiles require --no-daemon for hc.' }
    }
    return $team
}

function Get-StateRoot {
    if ($env:HERDRCONFIG_STATE_HOME) {
        if (![IO.Path]::IsPathFullyQualified($env:HERDRCONFIG_STATE_HOME)) { throw 'HERDRCONFIG_STATE_HOME must be an absolute path.' }
        return [IO.Path]::GetFullPath($env:HERDRCONFIG_STATE_HOME)
    }
    if ($IsWindows) { return Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'HerdrConfig/runs' }
    $base = if ($env:XDG_STATE_HOME) { $env:XDG_STATE_HOME } else { Join-Path $HOME '.local/state' }
    Join-Path $base 'herdrconfig/runs'
}

function Get-CoreHome {
    if ($env:HERDRCONFIG_CORE_HOME) { return [IO.Path]::GetFullPath($env:HERDRCONFIG_CORE_HOME) }
    $base = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } elseif ($IsWindows) { [Environment]::GetFolderPath('ApplicationData') } else { Join-Path $HOME '.config' }
    Join-Path $base 'herdr-core'
}

function Get-TextHash {
    param([string]$Text)
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Text))).ToLowerInvariant()
}

function Read-CheckedFileBytes {
    param([string]$Path, [AllowNull()]$ExpectedHash)
    $bytes = $null
    if ([IO.File]::Exists($Path)) { $bytes = [IO.File]::ReadAllBytes($Path) }
    $actual = if ($null -ne $bytes) { [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([byte[]]$bytes)) } else { $null }
    if ($actual -ne $ExpectedHash) { throw "File changed after ownership check: $Path" }
    return ,$bytes
}

function Get-ReviewSnapshot {
    param([string]$Project)
    $head = Invoke-GitRead $Project @('rev-parse','--verify','HEAD') -AllowFailure
    $status = (Invoke-GitRead $Project @('status','--porcelain=v1','-z','--no-renames','--untracked-files=all','--ignore-submodules=none')).stdout
    $submodules = (Invoke-GitRead $Project @('ls-files','--stage','-z')).stdout.Split([char]0) | Where-Object { $_.StartsWith('160000 ') }
    foreach ($entry in $submodules) {
        $path = ($entry -split "`t", 2)[1]
        if (@($status.Split([char]0) | Where-Object { $_.Length -ge 3 -and $_.Substring(3) -eq $path }).Count) { throw 'Dirty submodules require separate review before this task can pass.' }
    }
    $parts = [Collections.Generic.List[string]]::new()
    $parts.Add($head.stdout.Trim()); $parts.Add($status)
    foreach ($argsList in @(@('diff','--cached','--binary','--no-ext-diff','--no-textconv','--no-color','--no-renames'), @('diff','--binary','--no-ext-diff','--no-textconv','--no-color','--no-renames'))) {
        $parts.Add((Invoke-GitRead $Project $argsList).stdout)
    }
    $untracked = (Invoke-GitRead $Project @('ls-files','--others','--exclude-standard','-z')).stdout.Split([char]0) | Where-Object { $_ }
    foreach ($path in $untracked) {
        $full = Join-Path $Project $path
        $item = Get-Item -Force -LiteralPath $full
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $hash = Get-TextHash ([string]$item.LinkTarget) }
        elseif ($item.PSIsContainer) { throw "Untracked nested repository/directory requires separate review: $path" }
        else { $hash = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash }
        $parts.Add("$path`0$hash")
    }
    @{ head = $head.stdout.Trim(); digest = Get-TextHash ($parts | ConvertTo-Json -Compress); status = $status; capturedAt = [DateTime]::UtcNow.ToString('o') }
}

function Get-Task {
    param([string]$Task)
    if ($Task -notmatch '^\d{8}-\d{6}-[a-f0-9]{8}$') { throw 'Invalid task ID.' }
    $directory = Join-Path (Get-StateRoot) $Task
    $state = Get-Content -Raw -LiteralPath (Join-Path $directory 'state.json') | ConvertFrom-Json -AsHashtable
    @{ directory = $directory; state = $state }
}

function Save-Task {
    param($TaskData)
    Write-JsonFile (Join-Path $TaskData.directory 'state.json') $TaskData.state
}

function New-Task {
    param([string]$Project, [string]$Request, [string]$Config)
    if (![IO.File]::Exists($Request)) { throw 'Request must be an existing UTF-8 text file.' }
    $text = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Request).Path)
    if (!$text.Trim()) { throw 'Request is empty.' }
    $team = Get-TeamConfig $Config
    $root = Get-ProjectRoot $Project
    $id = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
    $directory = Join-Path (Get-StateRoot) $id
    [void][IO.Directory]::CreateDirectory($directory)
    [IO.File]::WriteAllText((Join-Path $directory 'request.md'), $text, [Text.UTF8Encoding]::new($false))
    $initial = Get-ReviewSnapshot $root
    $initial.branch = (Invoke-GitRead $root @('branch','--show-current')).stdout.Trim()
    Write-JsonFile (Join-Path $directory 'baseline.json') $initial
    Write-JsonFile (Join-Path $directory 'team.json') $team
    $data = @{ directory = $directory; state = @{ id = $id; project = $root; stage = 'planning'; createdAt = [DateTime]::UtcNow.ToString('o'); reports = @(); launches = @(); reviewSnapshot = $null } }
    Save-Task $data
    return $data
}

function Assert-Gate {
    param($TaskData)
    if ($TaskData.state.stage -ne 'approved') { throw 'Independent review has not passed.' }
    $now = Get-ReviewSnapshot $TaskData.state.project
    if ($now.digest -ne $TaskData.state.reviewSnapshot.digest) { throw 'Review is stale: Git content changed. Record Executor evidence and repeat review.' }
    @{ passed = $true; task = $TaskData.state.id; digest = $now.digest }
}

function Add-TaskReport {
    param($TaskData, [string]$Role, [string]$Report, [string]$Decision)
    if ($Role -notin $script:RoleNames) { throw 'Unknown role.' }
    $text = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Report).Path)
    if (!$text.Trim()) { throw 'Report must not be empty.' }
    $state = $TaskData.state
    $next = $state.stage
    switch ($Role) {
        'planner' { if ($state.stage -ne 'planning') { throw 'Planner report requires planning stage.' }; $next = 'ready' }
        'executor' {
            if ($state.stage -notin @('ready','changes-requested','review-pending','approved')) { throw 'Executor report not allowed at this stage.' }
            $state.reviewSnapshot = Get-ReviewSnapshot $state.project
            $state.Remove('deliveryGate')
            $next = 'review-pending'
        }
        'reviewer' {
            if ($state.stage -ne 'review-pending') { throw 'Reviewer report requires review-pending stage.' }
            if ($Decision -notin @('passed','changes-requested')) { throw 'Reviewer decision must be passed or changes-requested.' }
            if ($Decision -eq 'passed') {
                $now = Get-ReviewSnapshot $state.project
                if ($now.digest -ne $state.reviewSnapshot.digest) { throw 'Review snapshot changed; return to Executor and review again.' }
                $next = 'approved'
            } else { $next = 'changes-requested' }
        }
        'version-controller' {
            if ($state.stage -eq 'approved') {
                if (!$state.ContainsKey('deliveryGate') -or !$state.deliveryGate.passed -or $state.deliveryGate.digest -ne $state.reviewSnapshot.digest) { throw 'Run Version Controller through RunRole after Gate before closing delivery.' }
                $next = 'complete'
            } elseif ($state.stage -ne 'planning') { throw 'Version Controller records preflight or approved delivery only.' }
        }
        'project-manager' { if ($state.stage -eq 'complete') { throw 'Task is complete.' } }
    }
    $sequence = @($state.reports).Count + 1
    $file = ('{0:D3}-{1}.md' -f $sequence, $Role)
    [IO.File]::WriteAllText((Join-Path $TaskData.directory $file), $text, [Text.UTF8Encoding]::new($false))
    $state.reports += @{ role = $Role; file = $file; decision = $Decision; at = [DateTime]::UtcNow.ToString('o') }
    $state.stage = $next
    Save-Task $TaskData
    $state
}

function Get-RoleLaunch {
    param($TaskData, [string]$Role)
    if ($Role -notin $script:RoleNames) { throw 'Unknown role.' }
    $state = $TaskData.state
    $allowed = switch ($Role) {
        'planner' { @('planning') }
        'executor' { @('ready','changes-requested','review-pending','approved') }
        'reviewer' { @('review-pending') }
        'version-controller' { @('planning','approved') }
        default { @('planning','ready','changes-requested','review-pending','approved') }
    }
    if ($state.stage -notin $allowed) { throw "$Role cannot launch at stage $($state.stage)." }
    if ($Role -eq 'reviewer' -and (Get-ReviewSnapshot $state.project).digest -ne $state.reviewSnapshot.digest) { throw 'Snapshot changed before review; record Executor evidence again.' }
    if ($Role -eq 'version-controller' -and $state.stage -eq 'approved') { [void](Assert-Gate $TaskData) }
    $team = Get-Content -Raw -LiteralPath (Join-Path $TaskData.directory 'team.json') | ConvertFrom-Json -AsHashtable
    $profile = $team.roles[$Role]
    $command = @($team.profiles[$profile].command)
    $short = $state.id.Substring($state.id.Length - 8)
    $name = "hcc-$($Role.Replace('project-manager','pm').Replace('version-controller','vc'))-$short"
    $templateName = "$name-$([guid]::NewGuid().ToString('N').Substring(0,6))"
    $body = [IO.File]::ReadAllText("$script:SourceRoot/roles/$Role.md") + "`n`n" + [IO.File]::ReadAllText("$script:SourceRoot/workflows/contract.md")
    $taskText = @"
Task ID: $($state.id)
Project: $($state.project)
Stage: $($state.stage)
Task directory: $($TaskData.directory)
Read request.md, baseline.json, state.json and all recorded reports in that directory. Read applicable project AGENTS.md before acting. Those project rules and the user's authorization remain binding.
Launcher: $script:SourceRoot/scripts/Herdr.ps1 (PowerShell 7.2+).
PM dispatch example: pwsh -NoProfile -File <launcher> RunRole -Task $($state.id) -Role planner
PM record example: pwsh -NoProfile -File <launcher> Record -Task $($state.id) -Role planner -Report <absolute-report-path>
Every subsequent launcher invocation MUST include -StateHome "$((Split-Path $TaskData.directory -Parent))". The hc core may not inherit the starting shell's environment.
Reviewer record additionally uses -Decision passed or changes-requested. Gate checks the exact reviewed snapshot.
Write evidence only in the task directory when your permissions allow; otherwise return report contents to PM. Do not bypass sandbox restrictions. Only PM may dispatch agents. Report completion/blockers to the parent terminal when present, with evidence path. Do not send messages to other people.

User request (the specific scope takes precedence over generic workflow defaults):
$([IO.File]::ReadAllText((Join-Path $TaskData.directory 'request.md')))
"@
    @{ name = $name; template = $templateName; command = $command; instructions = $body; task = $taskText; profile = $profile; directory = $state.project }
}

function Start-Role {
    param($TaskData, [string]$Role, [switch]$Preview)
    $launch = Get-RoleLaunch $TaskData $Role
    if ($Preview) { return $launch }
    $deliveryGate = if ($Role -eq 'version-controller' -and $TaskData.state.stage -eq 'approved') { Assert-Gate $TaskData } else { $null }
    if (!(Get-Command $launch.command[0] -ErrorAction SilentlyContinue)) { throw "Agent executable missing: $($launch.command[0]). Install/authenticate it or choose another profile." }
    $list = (Invoke-Tool hc @('ls','--json')).stdout | ConvertFrom-Json -AsHashtable
    $entries = if ($list -is [array]) { $list } elseif ($list.ContainsKey('terminals')) { $list.terminals } else { @() }
    if (@($entries | Where-Object { $_.ContainsKey('name') -and $_.name -eq $launch.name -and $_.state -eq 'live' }).Count) { throw "Session $($launch.name) already exists. Inspect it with hc get/read; do not launch a duplicate." }
    $argsList = @('run','--json','--bg','--name',$launch.name,'--cwd',$launch.directory,'--label',"herdrconfig.role=$Role",'--label',"herdrconfig.task=$($TaskData.state.id)")
    if ($Role -eq 'project-manager' -and !$TaskData.state.ContainsKey('ui')) {
        $space = (Invoke-Tool herdr-app @('do','space.new','--name',"Team · $([IO.Path]::GetFileName($launch.directory))",'--folder',$launch.directory)).stdout | ConvertFrom-Json -AsHashtable
        if (!$space.ContainsKey('space') -or !$space.ContainsKey('tab')) { throw 'Herdr did not return a space/tab.' }
        $TaskData.state.ui = @{ space = $space.space; tab = $space.tab }
        Save-Task $TaskData
    }
    if ($TaskData.state.ContainsKey('ui')) {
        $argsList += @('--label',"herdr.space=$($TaskData.state.ui.space)",'--label',"herdr.tab=$($TaskData.state.ui.tab)")
    }
    elseif ($env:HC_TERMINAL_ID) {
        $parent = (Invoke-Tool hc @('get',$env:HC_TERMINAL_ID,'--json')).stdout | ConvertFrom-Json -AsHashtable
        if ($parent.ContainsKey('terminal')) { $parent = $parent.terminal }
        if ($parent.ContainsKey('labels')) {
            foreach ($key in @('herdr.space','herdr.tab')) { if ($parent.labels.ContainsKey($key)) { $argsList += @('--label',"$key=$($parent.labels[$key])") } }
        }
    }
    # Positional initial prompts are supported by the bundled Codex/Claude profiles.
    # Each word is a native argument. Do not route through a shell or hc command templates.
    $prompt = $launch.instructions + "`n`n" + $launch.task
    if ($IsWindows -and ($prompt.Length + ($launch.command -join ' ').Length) -gt 28000) { throw 'Launch prompt exceeds the Windows argument budget.' }
    $argsList += @('--') + $launch.command + @($prompt)
    $result = Invoke-Tool hc $argsList -TimeoutSeconds 30 -AllowFailure
    $output = $null
    try { $output = $result.stdout | ConvertFrom-Json -AsHashtable } catch { }
    $record = @{ role = $Role; name = $launch.name; profile = $launch.profile; result = $output; stderr = $result.stderr; delivery = 'initial-prompt-argument'; at = [DateTime]::UtcNow.ToString('o') }
    if ($Role -eq 'reviewer') { $record.reviewDigest = $TaskData.state.reviewSnapshot.digest }
    $TaskData.state.launches += $record
    $deliveryFailed = $output -and $output.ContainsKey('first_message') -and !$output.first_message.sent
    if ($deliveryGate -and $result.code -eq 0 -and $output -and $output.ContainsKey('address') -and !$deliveryFailed) { $TaskData.state.deliveryGate = $deliveryGate }
    Save-Task $TaskData
    if ($result.code -ne 0) { throw "hc launch failed: $($result.stderr) $($result.stdout). Inspect hc before retrying." }
    if (!$output -or !$output.ContainsKey('address')) { throw 'Launch result has no terminal address. Inspect hc before retrying.' }
    if ($output.ContainsKey('first_message') -and !$output.first_message.sent) { throw "First message was not sent. Inspect hc get/read $($launch.name) before retrying." }
    $output['task'] = $TaskData.state.id
    $output['delivery'] = 'Initial prompt passed as one native argument; verify hc get/read for trust, login, and actual completion.'
    return $output
}
Export-ModuleMember -Function Invoke-Tool,Invoke-GitRead,Get-ProjectRoot,Write-JsonFile,Get-TeamConfig,Get-StateRoot,Get-CoreHome,Get-TextHash,Read-CheckedFileBytes,Get-ReviewSnapshot,Get-Task,Save-Task,New-Task,Assert-Gate,Add-TaskReport,Get-RoleLaunch,Start-Role
