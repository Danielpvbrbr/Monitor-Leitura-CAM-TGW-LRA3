!macro customInstall
  ; Executa o comando silenciosamente para abrir a porta durante a instalação
  ExecWait 'netsh advfirewall firewall add rule name="Estacionamento - Camera LPR" dir=in action=allow protocol=TCP localport=8083'
!macroend

!macro customUnInstall
  ; Remove a regra de porta quando o cliente desinstalar o sistema (mantém o PC limpo)
  ExecWait 'netsh advfirewall firewall delete rule name="Estacionamento - Camera LPR"'
!macroend
