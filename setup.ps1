# Установка WSL-плагинов в DeepSeek Harness (Windows)
#
# Что делает скрипт:
#   1. ставит в профиль два пакета: dsh-wsl (команды в WSL) и dsh-wsl-mode (/wsl on|off);
#   2. раскладывает готовые бинарники node-pty (нужны для постоянного терминала);
#   3. включает dsh-wsl-mode в список бандлов профиля;
#   4. добавляет строку dsh-wsl в cordis.patch.yml.
#
# Запуск (PowerShell), из папки, куда распакован архив:
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
#
# Параметры:
#   -Profile   имя профиля (по умолчанию desktop)
#   -SourceDir папка с dsh-wsl и dsh-wsl-mode (по умолчанию — папка скрипта)

param(
    [string]$Profile = 'desktop',
    [string]$SourceDir = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'

function Fail($message) {
    Write-Host "ОШИБКА: $message" -ForegroundColor Red
    exit 1
}

function Info($message) { Write-Host "  $message" }
function Step($message) { Write-Host "`n== $message" -ForegroundColor Cyan }

# --- 0. Проверки окружения ---------------------------------------------------
Step 'Проверка окружения'

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$Profile"
if (-not (Test-Path $profileDir)) { Fail "профиль не найден: $profileDir (укажите -Profile)" }
Info "профиль: $profileDir"

$cli = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
if (-not (Test-Path $cli)) { Fail "не найден dsh CLI: $cli (DeepSeek Harness установлен?)" }
Info "dsh CLI: $cli"

$source = (Resolve-Path $SourceDir).Path
foreach ($pkg in 'dsh-wsl', 'dsh-wsl-mode') {
    if (-not (Test-Path (Join-Path $source "$pkg\package.json"))) {
        Fail "в $source нет папки $pkg"
    }
}
Info "исходники: $source"

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { Fail 'wsl.exe не найден: установите WSL2 (wsl --install)' }
$raw = ((& wsl.exe -l -q) -join "`n") -replace "`0", ''
$distros = @($raw -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($distros.Count -eq 0) { Fail 'нет ни одного дистрибутива WSL: выполните wsl --install' }
Info ('дистрибутивы: ' + ($distros -join ', '))

# node из рантайма DSH, иначе системный
$node = Get-ChildItem (Join-Path $dshHome 'dsh-runtimes\*\dependencies\node\bin\node.exe') -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $node) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
Info "node: $(if ($node) { $node } else { 'не найден (постоянный терминал будет отключён)' })"

# --- 1. Установка пакетов ----------------------------------------------------
Step 'Установка пакетов (это сетевой шаг: pnpm скачает node-pty)'

foreach ($pkg in 'dsh-wsl', 'dsh-wsl-mode') {
    $spec = "file:$($source.Replace('\', '/'))/$pkg"
    Info "ставлю $pkg"
    # pnpm возвращает код 1 из-за заблокированного build-скрипта node-pty — это
    # ожидаемо, поэтому ошибку не пробрасываем: результат проверяем по манифесту.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $cli plugin --profile $Profile add $spec *> $null
    } finally {
        $ErrorActionPreference = $previous
    }
    $manifest = Get-Content (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json
    if (-not $manifest.dependencies.$pkg) { Fail "пакет $pkg не появился в зависимостях профиля (см. $profileDir\.plugin-manager\logs)" }
}

# --- 2. node-pty: разложить предсобранные бинарники ---------------------------
Step 'node-pty: подготовка бинарников'

$nodePty = Join-Path $profileDir 'node_modules\node-pty'
if ((Test-Path $nodePty) -and $node) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    Push-Location $nodePty
    try { & $node 'scripts\prebuild.js' *> $null } catch { } finally { Pop-Location; $ErrorActionPreference = $previous }
    $probePath = $nodePty.Replace('\', '/')
    $probe = & $node -e "try{require('$probePath');console.log('ok')}catch(e){console.log('fail')}" 2>$null
    if ($probe -eq 'ok') { Info 'node-pty загружается' }
    else { Write-Host '  ВНИМАНИЕ: node-pty не загрузился — постоянный терминал будет недоступен, остальное работает' -ForegroundColor Yellow }
} else {
    Write-Host '  ВНИМАНИЕ: node-pty или node не найдены — постоянный терминал будет недоступен' -ForegroundColor Yellow
}

# --- 3. Бандл dsh-wsl-mode ---------------------------------------------------
Step 'Включение dsh-wsl-mode в композицию профиля'

$manifestPath = Join-Path $profileDir 'package.json'
$text = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
$manifest = $text | ConvertFrom-Json
$bundles = @($manifest.dsh.profile.bundles)
if ($bundles -contains 'dsh-wsl-mode') {
    Info 'уже включён'
} else {
    $manifest.dsh.profile.bundles = @($bundles + 'dsh-wsl-mode')
    $json = $manifest | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($manifestPath, $json, (New-Object Text.UTF8Encoding($false)))
    Info 'добавлен в dsh.profile.bundles'
}

# --- 4. Строка dsh-wsl в cordis.patch.yml ------------------------------------
Step 'Строка dsh-wsl в cordis.patch.yml'

$patchPath = Join-Path $profileDir 'cordis.patch.yml'
$patch = if (Test-Path $patchPath) { [IO.File]::ReadAllText($patchPath, [Text.Encoding]::UTF8).TrimStart([char]0xFEFF) } else { "[]`n" }
if ($patch -match '(?m)^\s*-\s*id:\s*dsh-wsl\s*$') {
    Info 'строка уже есть'
} else {
    if ($patch.Trim() -eq '[]') { $patch = '' }
    $block = "`n# dsh-wsl: выполнение команд в WSL2`n- insert:`n    - id: dsh-wsl`n      name: 'dsh-wsl'`n"
    $patch = $patch.TrimEnd() + "`n" + $block
    [IO.File]::WriteAllText($patchPath, $patch, (New-Object Text.UTF8Encoding($false)))
    Info 'строка добавлена'
}

# --- Итог --------------------------------------------------------------------
Step 'Готово'
Write-Host @"
Осталось перезапустить DeepSeek Harness (полностью закрыть и открыть).

После запуска:
  * в новой сессии введите  /wsl   — должно ответить "WSL mode is ON";
  * /wsl off  выключает режим для этой сессии, /wsl on — включает;
  * попросите агента выполнить любую linux-команду: ls, uname -a.

Подробности и ручной путь установки — в ИНСТРУКЦИЯ.md.
"@
