[CmdletBinding()]
param(
    [string]$Node = 'node',
    [string]$Herdr = 'herdr-app'
)
$ErrorActionPreference = 'Stop'
$nodeCommand = (Get-Command $Node -ErrorAction Stop).Source
$herdrCommand = (Get-Command $Herdr -ErrorAction Stop).Source
$mod = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../herdr/mods/hcconfig-git'))

& $nodeCommand (Join-Path $PSScriptRoot 'test-git-panel.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Git panel regression failed.' }

$checkRoot = Join-Path $PSScriptRoot ('.check-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $checkRoot)
try {
    $targets = @($mod)
    # Check eager native controls in populated states too. This is a hidden
    # checker, not a deployment, layout change, or actual UI acceptance.
    foreach ($mode in @('history', 'worktree', 'compare')) {
        $folder = Join-Path $checkRoot $mode
        [void](New-Item -ItemType Directory -Path $folder)
        Copy-Item -LiteralPath (Join-Path $mod 'main.js') -Destination (Join-Path $folder 'panel.js')
        Copy-Item -LiteralPath (Join-Path $mod 'git.js') -Destination (Join-Path $folder 'git.js')
        $source = @'
import GitPanel from "./panel.js";
export default class CheckState extends GitPanel {
  init(props, cx) {
    super.init(props, cx);
    this.mode = "MODE";
    this.repo = { root: "C:/fixture/中文 repo", branch: "main", head: "a".repeat(40) };
    this.commits = [{ oid: "a".repeat(40), subject: "A populated history row", author: "Fixture author", time: "2026-01-01T00:00:00+00:00" }];
    this.selected = this.commits[0];
    this.files = [{ path: "中文 file.txt", group: this.mode === "worktree" ? "staged" : "diff", status: "M" }];
    this.fileCount = 1; this.open = this.files[0];
    this.spec = { base: "b".repeat(40), tip: "a".repeat(40) };
    this.message = "Commit description\nSecond line";
    this.rows = ["@@ -1 +1 @@", "-before", "+after"];
    this.note = "First-parent diff"; this.previewNote = "Preview truncated (fixture)";
  }
  syncProject() { return false; }
}
'@
        Set-Content -LiteralPath (Join-Path $folder 'main.js') -Value $source.Replace('MODE', $mode) -Encoding utf8NoBOM
        $targets += $folder
    }
    foreach ($target in $targets) {
        $out = Join-Path $checkRoot 'stdout.log'
        $err = Join-Path $checkRoot 'stderr.log'
        # Windows GUI executables must be explicitly awaited to get their exit code.
        $process = Start-Process -FilePath $herdrCommand -ArgumentList @('check', ('"' + $target + '"')) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
        Get-Content -LiteralPath $out
        Get-Content -LiteralPath $err
        if ($process.ExitCode -ne 0) { throw "Native check failed ($($process.ExitCode)): $target" }
    }
} finally {
    $resolved = [System.IO.Path]::GetFullPath($checkRoot)
    if ((Split-Path -Parent $resolved) -ne [System.IO.Path]::GetFullPath($PSScriptRoot) -or !(Split-Path -Leaf $resolved).StartsWith('.check-')) {
        throw "Refusing cleanup outside the test directory: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
