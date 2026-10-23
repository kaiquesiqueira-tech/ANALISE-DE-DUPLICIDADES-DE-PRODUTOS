@echo off
setlocal EnableExtensions
chcp 65001 >nul
title PUBLICAR - Duplicidade de Cadastro
cd /d "%~dp0"

echo.
echo  ==========================================================
echo    PUBLICAR NO GITHUB  -  Duplicidade de Cadastro
echo  ==========================================================
echo    Pasta: %CD%
echo.
echo    Para atualizar a base: coloque as planilhas exportadas do
echo    Protheus - SB1, SBZ e Saldo Fisico - na pasta "planilhas"
echo    antes de rodar o PUBLICAR.
echo.

rem ---- Git instalado? ----
where git >nul 2>nul
if errorlevel 1 goto :semgit

if not exist "index.html" goto :semindex
if not exist "planilhas" mkdir "planilhas"

rem ---- Nome e e-mail do Git configurados? ----
git config user.name >nul 2>nul
if errorlevel 1 call :identidade

rem ---- Pasta ligada a um repositorio? ----
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 call :configurar
if errorlevel 1 goto :fim

for /f "delims=" %%b in ('git symbolic-ref --short HEAD 2^>nul') do set "BR=%%b"
if not defined BR set "BR=main"
git remote get-url origin >nul 2>nul
if errorlevel 1 goto :semremoto

rem ---- 1. Trazer o que ja esta no GitHub, para a medicao nova entrar no historico mais recente ----
echo  [1/5] Buscando o que ja esta no GitHub...
git ls-remote --exit-code --heads origin %BR% >nul 2>nul
if errorlevel 1 goto :passo2
git pull --rebase --autostash -q origin %BR%
if errorlevel 1 goto :conflito

:passo2
rem ---- 2. Node.js, que calcula a medicao no computador ----
echo.
echo  [2/5] Preparando o processamento...
set "TEMPLAN="
for %%f in ("planilhas\*.xlsx" "planilhas\*.csv" "planilhas\*.txt") do set "TEMPLAN=1"
call :acharnode
if defined NODE goto :passo3
if defined TEMPLAN goto :semnode
echo        Sem Node.js: vou publicar so os arquivos baixados pelo site.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Continue'; $dl=$null; try { $dl=(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path } catch { }; if(-not $dl -or -not (Test-Path -LiteralPath $dl)){ $dl=Join-Path $env:USERPROFILE 'Downloads' }; if(-not (Test-Path -LiteralPath $dl)){ Write-Host '       Pasta Downloads nao encontrada.'; exit 0 }; $med=Join-Path 'dados' 'medicoes'; New-Item -ItemType Directory -Force -Path $med | Out-Null; $n=0; Get-ChildItem -LiteralPath $dl -File | Where-Object { $_.Name -match '^s\d{14}( \(\d+\))?\.json$' } | Sort-Object LastWriteTime | ForEach-Object { $nome=($_.Name -replace ' \(\d+\)',''); Move-Item -LiteralPath $_.FullName -Destination (Join-Path $med $nome) -Force; Write-Host ('       + dados/medicoes/' + $nome); $n++ }; foreach($b in @('historico','bloqueios','ncm')){ $alvo=Join-Path 'dados' ($b+'.json'); $h=Get-ChildItem -LiteralPath $dl -File | Where-Object { $_.Name -match ('^'+$b+'( \(\d+\))?\.json$') } | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if($h){ $ok=$true; try { $j=Get-Content -LiteralPath $h.FullName -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $ok=$false }; if(-not $ok){ Write-Host ('       Aviso: '+$b+'.json baixado esta incompleto - ignorado') } elseif((-not (Test-Path -LiteralPath $alvo)) -or ($h.LastWriteTime -gt (Get-Item -LiteralPath $alvo).LastWriteTime)){ Move-Item -LiteralPath $h.FullName -Destination $alvo -Force; Write-Host ('       + dados/'+$b+'.json'); $n++ } } }; if($n -eq 0){ Write-Host '       Nenhum arquivo novo baixado pelo site.' }"
goto :passo4

:passo3
rem ---- 3. Planilhas da pasta + arquivos baixados pelo site ----
echo.
echo  [3/5] Processando as planilhas e os arquivos baixados pelo site...
set "DL="
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "$d=$null; try { $d=(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path } catch { }; if(-not $d -or -not (Test-Path -LiteralPath $d)){ $d=Join-Path $env:USERPROFILE 'Downloads' }; Write-Output $d"`) do set "DL=%%d"
"%NODE%" scripts\publicar.js --downloads "%DL%" --planilhas planilhas
if errorlevel 1 goto :falhaproc

:passo4
rem ---- 4. Registrar alteracoes ----
echo.
echo  [4/5] Registrando as alteracoes...
git add -A
git diff --cached --quiet
if errorlevel 1 goto :commit
echo        Nenhuma alteracao nova para publicar.
goto :passo5

:commit
git status --short
git commit -q -m "Atualizacao do painel %date% %time:~0,5%"
if errorlevel 1 goto :falhacommit

:passo5
rem ---- 5. Enviar ----
echo.
echo  [5/5] Enviando para o GitHub...
git ls-remote --exit-code --heads origin %BR% >nul 2>nul
if errorlevel 1 goto :push
git pull --rebase --autostash -q origin %BR%
if errorlevel 1 goto :conflito
:push
git push -u origin %BR%
if errorlevel 1 goto :falhapush

echo.
echo  ==========================================================
echo    PUBLICADO COM SUCESSO
echo  ==========================================================
set "SITE="
for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "$u=(git remote get-url origin); if($u -match 'github\.com[:/]+([^/]+)/(.+?)(\.git)?/?$'){ $o=$matches[1].ToLower(); $r=$matches[2]; if($r -ieq ($o+'.github.io')){ 'https://'+$o+'.github.io/' } else { 'https://'+$o+'.github.io/'+$r+'/' } }"`) do set "SITE=%%s"
if not defined SITE goto :fim
echo    Site: %SITE%
echo    O GitHub Pages leva de 1 a 2 minutos para mostrar a versao nova.
echo.
choice /c SN /n /m "   Abrir o site agora? [S/N] "
if errorlevel 2 goto :fim
start "" "%SITE%"
goto :fim

rem ================= rotinas =================
:acharnode
set "NODE="
set "NODEDIR=%LOCALAPPDATA%\DuplicidadeCadastro\node"
where node >nul 2>nul
if errorlevel 1 goto :acharnode2
node -e "new DecompressionStream('deflate-raw')" >nul 2>nul
if errorlevel 1 goto :acharnode2
set "NODE=node"
echo        Node.js do computador: ok
exit /b 0
:acharnode2
if exist "%NODEDIR%\node.exe" goto :acharnode3
if not defined TEMPLAN exit /b 0
echo        Baixando o Node.js - so na primeira vez, cerca de 30 MB...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12 } catch { }; try { [System.Net.WebRequest]::DefaultWebProxy.Credentials=[System.Net.CredentialCache]::DefaultNetworkCredentials } catch { }; $arq='win-x64'; if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){ $arq='win-arm64' }; $bases=@('https://nodejs.org/dist/latest-v24.x/','https://nodejs.org/dist/latest-v22.x/'); if($env:DUP_NODE_BASE){ $bases=@($env:DUP_NODE_BASE) }; $destino=Join-Path $env:LOCALAPPDATA 'DuplicidadeCadastro'; New-Item -ItemType Directory -Force -Path $destino | Out-Null; $ok=$false; $erro=''; foreach($base in $bases){ if($ok){ break }; try { $sums=[string](Invoke-WebRequest -UseBasicParsing -Uri ($base+'SHASUMS256.txt')).Content; $linha=$sums -split [char]10 | Where-Object { $_ -match ('node-v[0-9.]+-'+$arq+'\.zip\s*$') } | Select-Object -First 1; if(-not $linha){ throw 'versao para Windows nao encontrada' }; $partes=$linha.Trim() -split '\s+'; $hash=$partes[0]; $nome=$partes[1]; $zip=Join-Path $destino $nome; Write-Host ('       Baixando ' + $nome + ' ...'); Invoke-WebRequest -UseBasicParsing -Uri ($base+$nome) -OutFile $zip; if((Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash -ne $hash){ Remove-Item -LiteralPath $zip -Force; throw 'o arquivo baixado nao confere com a assinatura do site' }; $tmp=Join-Path $destino 'tmp'; if(Test-Path -LiteralPath $tmp){ Remove-Item -LiteralPath $tmp -Recurse -Force }; New-Item -ItemType Directory -Force -Path $tmp | Out-Null; $tarOk=$false; if(Get-Command tar -ErrorAction SilentlyContinue){ & tar -xf $zip -C $tmp 2>$null; $tarOk=($LASTEXITCODE -eq 0) }; if(-not $tarOk){ Remove-Item -LiteralPath $tmp -Recurse -Force; Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force }; $pasta=Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1; $alvo=Join-Path $destino 'node'; if(Test-Path -LiteralPath $alvo){ Remove-Item -LiteralPath $alvo -Recurse -Force }; Move-Item -LiteralPath $pasta.FullName -Destination $alvo; Remove-Item -LiteralPath $tmp -Recurse -Force; Remove-Item -LiteralPath $zip -Force; $ok=$true } catch { $erro=$_.Exception.Message } }; if($ok){ Write-Host '       Node.js pronto.' } else { Write-Host ('       Nao consegui baixar o Node.js: ' + $erro); exit 1 }"
if not exist "%NODEDIR%\node.exe" exit /b 0
:acharnode3
set "NODE=%NODEDIR%\node.exe"
echo        Node.js: ok
exit /b 0

rem ================= mensagens =================
:semgit
echo  [ERRO] O Git nao esta instalado neste computador.
echo         Baixe em https://git-scm.com/download/win , instale e rode de novo.
goto :fim

:semindex
echo  [AVISO] Nao achei o index.html nesta pasta.
echo          Coloque o PUBLICAR.bat na pasta principal do app, junto do index.html.
goto :fim

:semremoto
echo  [ERRO] Esta pasta nao esta ligada a nenhum repositorio do GitHub - falta o origin.
echo         Rode no terminal: git remote add origin ENDERECO-DO-REPOSITORIO
goto :fim

:semnode
echo.
echo  [ERRO] Nao consegui preparar o Node.js para processar as planilhas.
echo         Instale o Node.js LTS - https://nodejs.org - e rode o PUBLICAR de novo.
echo         As planilhas continuam na pasta planilhas. Nada foi enviado.
goto :fim

:falhaproc
echo.
echo  Nada foi enviado ao GitHub.
goto :fim

:falhacommit
echo  [ERRO] Nao consegui registrar as alteracoes.
goto :fim

:conflito
git rebase --abort >nul 2>nul
echo.
echo  [ERRO] O GitHub tem alteracoes que conflitam com as suas - geralmente o
echo         dados\historico.json mudou nos dois lados. Nada foi enviado.
echo         Abra a pasta no VS Code, resolva o conflito e rode o PUBLICAR de novo.
goto :fim

:falhapush
echo.
echo  [ERRO] O envio falhou. Verifique a internet e se voce esta logado no GitHub -
echo         na primeira vez abre uma janela de login. Depois rode o PUBLICAR de novo.
goto :fim

:identidade
echo  O Git ainda nao sabe seu nome e e-mail - eles aparecem em cada publicacao.
set "GNOME="
set "GMAIL="
set /p "GNOME=   Seu nome: "
set /p "GMAIL=   Seu e-mail do GitHub: "
if defined GNOME git config --global user.name "%GNOME%"
if defined GMAIL git config --global user.email "%GMAIL%"
echo.
exit /b 0

:configurar
echo  Esta pasta ainda nao esta ligada a um repositorio do GitHub.
echo  Crie um repositorio VAZIO no GitHub, sem README, e copie o endereco dele.
set "URL="
set /p "URL=   Endereco, ex. https://github.com/usuario/app-duplicidades.git : "
if not defined URL goto :cancelado
git init -q -b main 2>nul
if errorlevel 1 git init -q
git symbolic-ref HEAD refs/heads/main
git remote add origin "%URL%"
echo.
exit /b 0

:cancelado
echo  Cancelado.
exit /b 1

:fim
echo.
pause
endlocal
