@echo off
echo ========================================================
echo   Configurando Rede do PDV de Estacionamento...
echo   Liberando porta 8083 para a Camera LPR
echo ========================================================

:: Verifica se esta rodando como Administrador
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] Privilegios de Administrador confirmados.
) else (
    echo [ERRO] Voce precisa rodar este arquivo como Administrador!
    echo Clique com o botao direito e selecione "Executar como Administrador".
    pause
    exit
)

:: Cria a regra no Firewall
netsh advfirewall firewall add rule name="PDV Estacionamento - LPR" dir=in action=allow protocol=TCP localport=8083

echo.
echo ========================================================
echo Configuracao concluida com sucesso! A camera ja pode conectar.
echo ========================================================
pause
