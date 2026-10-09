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

rem ---- Git instalado? ----
where git >nul 2>nul
if errorlevel 1 goto :semgit

if not exist "index.html" goto :semindex

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

rem ---- 1. Arquivos baixados pelo site ----
echo  [1/4] Trazendo os arquivos baixados pelo site - pasta Downloads...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Continue'; $dl=$null; try { $dl=(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path } catch { }; if(-not $dl -or -not (Test-Path -LiteralPath $dl)){ $dl=Join-Path $env:USERPROFILE 'Downloads' }; if(-not (Test-Path -LiteralPath $dl)){ Write-Host '       Pasta Downloads nao encontrada.'; exit 0 }; $med=Join-Path 'dados' 'medicoes'; New-Item -ItemType Directory -Force -Path $med | Out-Null; $n=0; Get-ChildItem -LiteralPath $dl -File | Where-Object { $_.Name -match '^s\d{14}( \(\d+\))?\.json$' } | Sort-Object LastWriteTime | ForEach-Object { $nome=($_.Name -replace ' \(\d+\)',''); Move-Item -LiteralPath $_.FullName -Destination (Join-Path $med $nome) -Force; Write-Host ('       + dados/medicoes/' + $nome); $n++ }; $alvo=Join-Path 'dados' 'historico.json'; $h=Get-ChildItem -LiteralPath $dl -File | Where-Object { $_.Name -match '^historico( \(\d+\))?\.json$' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if($h){ $ok=$true; try { $j=Get-Content -LiteralPath $h.FullName -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $ok=$false }; if(-not $ok){ Write-Host '       Aviso: historico.json baixado esta incompleto - ignorado' } elseif((-not (Test-Path -LiteralPath $alvo)) -or ($h.LastWriteTime -gt (Get-Item -LiteralPath $alvo).LastWriteTime)){ Move-Item -LiteralPath $h.FullName -Destination $alvo -Force; Write-Host '       + dados/historico.json'; $n++ } }; if($n -eq 0){ Write-Host '       Nenhum arquivo novo baixado pelo site.' }"

rem ---- 2. Registrar alteracoes ----
echo.
echo  [2/4] Registrando as alteracoes...
git add -A
git diff --cached --quiet
if errorlevel 1 goto :commit
echo        Nenhuma alteracao nova nesta pasta.
goto :sincronizar

:commit
git status --short
git commit -q -m "Atualizacao do painel %date% %time:~0,5%"
if errorlevel 1 goto :falhacommit

:sincronizar
rem ---- 3. Trazer o que ja esta no GitHub, ex.: medicao gravada pelo GitHub Actions ----
echo.
echo  [3/4] Buscando o que ja esta no GitHub...
git ls-remote --exit-code --heads origin %BR% >nul 2>nul
if errorlevel 1 goto :enviar
git pull --rebase --autostash -q origin %BR%
if errorlevel 1 goto :conflito

:enviar
rem ---- 4. Enviar ----
echo.
echo  [4/4] Enviando para o GitHub...
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

rem ================= mensagens e rotinas =================
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
