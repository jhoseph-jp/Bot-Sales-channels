<#
.SYNOPSIS
  Baixa da VPS os backups do banco que ainda nao estao na pasta do Google Drive.

.DESCRIPTION
  O backup e gerado na VPS (scripts/backup-db.js, via cron as 04:20 UTC) e fica em
  /opt/backups/bot-sqlite. Este script roda na maquina Windows, copia para a pasta
  sincronizada do Drive e deixa o proprio Drive levar para a nuvem.

  Baixa TUDO que estiver faltando, nao so o backup do dia: como a VPS guarda 14
  copias, basta o PC ligar uma vez a cada 14 dias para nada se perder.

  Usa o OpenSSH nativo do Windows por caminho absoluto — o Agendador de Tarefas roda
  com PATH diferente do terminal, e depender do PATH e a causa classica de tarefa que
  "funciona no terminal e falha agendada".

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\pull-backups.ps1
#>

[CmdletBinding()]
param(
  [string] $Destino    = 'G:\Meu Drive\OfertaDelas-Backup',
  [string] $VpsHost    = 'root@177.7.38.111',
  [string] $VpsDir     = '/opt/backups/bot-sqlite',
  [string] $Chave      = "$env:USERPROFILE\.ssh\hostinger_vps_new",
  [int]    $Manter     = 90,          # copias mantidas no Drive (a VPS mantem 14)
  [string] $LogPath    = "$env:USERPROFILE\.ofertadelas-backup.log"
)

$ErrorActionPreference = 'Stop'

$SSH = 'C:\Windows\System32\OpenSSH\ssh.exe'
$SCP = 'C:\Windows\System32\OpenSSH\scp.exe'

function Write-Log {
  param([string] $Mensagem)
  $linha = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Mensagem
  Write-Output $linha
  try { Add-Content -Path $LogPath -Value $linha -Encoding utf8 } catch { }
}

try {
  foreach ($exe in @($SSH, $SCP)) {
    if (-not (Test-Path $exe)) { throw "OpenSSH nao encontrado em $exe" }
  }
  if (-not (Test-Path $Chave)) { throw "Chave SSH nao encontrada em $Chave" }

  if (-not (Test-Path $Destino)) {
    New-Item -ItemType Directory -Path $Destino -Force | Out-Null
    Write-Log "pasta de destino criada: $Destino"
  }

  # Lista o que existe na VPS
  $remotos = & $SSH -i $Chave -o BatchMode=yes -o ConnectTimeout=20 $VpsHost `
    "ls -1 $VpsDir/*.sqlite.gz 2>/dev/null | xargs -r -n1 basename"
  if ($LASTEXITCODE -ne 0) { throw "falha ao listar backups na VPS (exit $LASTEXITCODE)" }

  $remotos = @($remotos | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
  if ($remotos.Count -eq 0) { Write-Log 'nenhum backup na VPS'; exit 0 }

  # Baixa so o que falta
  $locais = @(Get-ChildItem -Path $Destino -Filter '*.sqlite.gz' -ErrorAction SilentlyContinue |
              ForEach-Object { $_.Name })
  $faltando = @($remotos | Where-Object { $locais -notcontains $_ })

  if ($faltando.Count -eq 0) {
    Write-Log "ja sincronizado ($($remotos.Count) copias na VPS, $($locais.Count) no Drive)"
  } else {
    foreach ($arquivo in $faltando) {
      # Baixa para .parcial e so renomeia no fim: o Drive nao sobe arquivo pela metade
      $parcial = Join-Path $Destino "$arquivo.parcial"
      $final   = Join-Path $Destino $arquivo
      & $SCP -i $Chave -o BatchMode=yes -o ConnectTimeout=20 "${VpsHost}:$VpsDir/$arquivo" $parcial
      if ($LASTEXITCODE -ne 0) {
        Remove-Item $parcial -Force -ErrorAction SilentlyContinue
        Write-Log "ERRO ao baixar $arquivo (exit $LASTEXITCODE)"
        continue
      }
      Move-Item -Path $parcial -Destination $final -Force
      $kb = [math]::Round((Get-Item $final).Length / 1KB)
      Write-Log "baixado: $arquivo ($kb KB)"
    }
  }

  # Retencao no Drive
  $todos = @(Get-ChildItem -Path $Destino -Filter '*.sqlite.gz' | Sort-Object LastWriteTime -Descending)
  if ($todos.Count -gt $Manter) {
    foreach ($velho in $todos[$Manter..($todos.Count - 1)]) {
      Remove-Item $velho.FullName -Force
      Write-Log "removido antigo: $($velho.Name)"
    }
  }

  # Sobras de download interrompido
  Get-ChildItem -Path $Destino -Filter '*.parcial' -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

  $final = @(Get-ChildItem -Path $Destino -Filter '*.sqlite.gz').Count
  Write-Log "ok: $final copia(s) no Drive"
  exit 0
}
catch {
  Write-Log "ERRO: $($_.Exception.Message)"
  exit 1
}
