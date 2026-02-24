import { useState, useEffect } from 'react'

function App() {
  const [abaAtiva, setAbaAtiva] = useState('monitor');
  const [cameraFiltro, setCameraFiltro] = useState(null);
  const [cameraEmEdicao, setCameraEmEdicao] = useState(null);

  const [camerasConfiguradas, setCamerasConfiguradas] = useState([]);
  const [logs, setLogs] = useState([]);

  const [serverInfo, setServerInfo] = useState({ ip: 'Carregando...', port: '...', version: '...' });
  const [copiado, setCopiado] = useState(null);

  const [novoId, setNovoId] = useState(null);
  const [novoNome, setNovoNome] = useState('');
  const [novoMac, setNovoMac] = useState('');
  const [novoIp, setNovoIp] = useState('');

  useEffect(() => {
    window.api.getServerInfo().then(info => setServerInfo(info));
    carregarCameras();
    carregarLogs(null);


    window.api.onNovaPlaca((novoLog) => {
      setLogs(logsAntigos => [novoLog, ...logsAntigos].slice(0, 50));
    });

    if (window.api.onAtualizarCameras) {
      window.api.onAtualizarCameras(() => {
        carregarCameras();
      });
    }
  }, []);

  const carregarCameras = async () => {
    const cams = await window.api.getCameras();
    setCamerasConfiguradas(cams);
  };

  const carregarLogs = async (macFiltro) => {
    const registros = await window.api.getLogs(macFiltro);

    const logsFormatados = registros.map(r => ({
      id: r.id,
      nome: r.nome,
      mac: r.equipamento_mac,
      placa: r.placa,
      ip: r.ip_origem,
      data: new Date(r.data_hora).toLocaleDateString('pt-BR'),
      hora: new Date(r.data_hora).toLocaleTimeString('pt-BR')
    }));
    setLogs(logsFormatados);
  };

  const mudarFiltro = (mac) => {
    setAbaAtiva('monitor');
    setCameraFiltro(mac);
    carregarLogs(mac);
  };

  const salvarCamera = async (e) => {
    e.preventDefault();
    if (!novoIp || !novoNome) return alert("Nome e IP são obrigatórios!");

    const macTratado = novoMac.trim() === '' ? null : novoMac;

    const resposta = await window.api.salvarCamera({
      id: novoId,
      nome: novoNome,
      mac: macTratado,
      ip: novoIp
    });

    if (resposta && resposta.erro) {
      if (resposta.erro.includes("UNIQUE constraint failed")) {
        return alert("ERRO: Este endereço MAC já está cadastrado em outra câmera!");
      }
      return alert("Erro ao salvar no banco: " + resposta.erro);
    }

    await carregarCameras();

    setNovoId(null); setNovoNome(''); setNovoMac(''); setNovoIp('');
    setCameraEmEdicao(null);
    setAbaAtiva('monitor');
  };

  const iniciarEdicao = (cam) => {
    setNovoId(cam.id);
    setNovoNome(cam.nome);
    setNovoMac(cam.mac);
    setNovoIp(cam.ip);
    setCameraEmEdicao(cam.mac);
    setAbaAtiva('cadastro');
  };

  const removerCamera = async (macParaRemover) => {
    if (window.confirm("Tem certeza que deseja remover esta câmera do banco?")) {
      await window.api.deletarCamera(macParaRemover);
      await carregarCameras();
      if (cameraFiltro === macParaRemover) mudarFiltro(null);
    }
  };

  const copiarTexto = (texto, campo) => {
    navigator.clipboard.writeText(texto);
    setCopiado(campo);
    setTimeout(() => setCopiado(null), 2000);
  };

  return (
    <div style={{ display: 'flex', height: '96vh', borderRadius: 10, backgroundColor: '#0f172a', color: '#e2e8f0', fontFamily: 'Segoe UI, Tahoma, sans-serif', overflow: 'hidden' }}>

      <div style={{ width: '200px', backgroundColor: '#1e293b', borderRight: '1px solid #334155', display: 'flex', flexDirection: 'column', padding: '15px 10px' }}>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '14px', margin: '0 0 5px 0', color: '#38bdf8', letterSpacing: '1px' }}>MONITOR CÂMERA PPA</h3>
          <span style={{ fontSize: '10px', color: '#64748b', backgroundColor: '#0f172a', padding: '2px 8px', borderRadius: '10px', border: '1px solid #334155' }}>
            v{serverInfo.version}
          </span>
        </div>

        <button onClick={() => mudarFiltro(null)} style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: (abaAtiva === 'monitor' && !cameraFiltro) ? '#3b82f6' : '#334155', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', transition: '0.2s', textAlign: 'left' }}>
          Visão Geral
        </button>

        <button onClick={() => { setNovoId(null); setNovoNome(''); setNovoMac(''); setNovoIp(''); setCameraEmEdicao(null); setAbaAtiva('cadastro'); }} style={{ width: '100%', padding: '10px', marginBottom: '15px', backgroundColor: abaAtiva === 'cadastro' && !cameraEmEdicao ? '#10b981' : '#334155', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', transition: '0.2s', textAlign: 'left' }}>
          Nova Câmera
        </button>

        <div style={{ borderTop: '1px solid #334155', paddingTop: '15px', flex: 1, overflowY: 'auto' }}>
          <h4 style={{ fontSize: '11px', color: '#94a3b8', margin: '0 0 10px 0', textTransform: 'uppercase' }}>Câmeras Ativas</h4>
          {camerasConfiguradas.map((cam, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', marginBottom: '8px', borderRadius: '4px', backgroundColor: cameraFiltro === cam.mac && abaAtiva === 'monitor' ? '#334155' : '#0f172a', borderLeft: cameraFiltro === cam.mac && abaAtiva === 'monitor' ? '3px solid #38bdf8' : '3px solid #10b981' }}>
              <div onClick={() => mudarFiltro(cam.mac)} style={{ cursor: 'pointer', flex: 1, overflow: 'hidden' }}>
                <strong style={{ display: 'block', color: '#e2e8f0', fontSize: '12px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{cam.nome}</strong>
              </div>
              <div style={{ display: 'flex', gap: '5px' }}>
                <button onClick={() => iniciarEdicao(cam)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '2px', color: "#fff" }} title="Editar">Editar</button>
                <button onClick={() => removerCamera(cam.mac)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '2px', color: "#fff" }} title="Excluir">Excluir</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 'auto', borderTop: '1px solid #334155', paddingTop: '15px' }}>
          <h4 style={{ fontSize: '11px', color: '#94a3b8', margin: '0 0 8px 0', textTransform: 'uppercase' }}>Servidor Local</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0f172a', padding: '6px 8px', borderRadius: '4px', border: '1px solid #334155' }}>
              <span style={{ fontSize: '11px', color: '#cbd5e1' }}>IP: <strong>{serverInfo.ip}</strong></span>
              <button onClick={() => copiarTexto(serverInfo.ip, 'ip')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: "#fff" }}>{copiado === 'ip' ? 'Copiado' : 'Copiar'}</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0f172a', padding: '6px 8px', borderRadius: '4px', border: '1px solid #334155' }}>
              <span style={{ fontSize: '11px', color: '#cbd5e1' }}>Porta: <strong>{serverInfo.port}</strong></span>
              <button onClick={() => copiarTexto(serverInfo.port.toString(), 'port')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: "#fff" }}>{copiado === 'port' ? 'Copiado' : 'Copiar'}</button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', overflowY: 'auto' }}>
        {abaAtiva === 'monitor' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid #334155', paddingBottom: '10px' }}>
              <h2 style={{ fontSize: '18px', margin: 0, color: '#f8fafc' }}>
                {cameraFiltro ? `Leituras: ${camerasConfiguradas.find(c => c.mac === cameraFiltro)?.nome}` : "Leituras Gerais"}
              </h2>
              <span style={{ fontSize: '12px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <div style={{ width: '8px', height: '8px', backgroundColor: '#10b981', borderRadius: '50%', boxShadow: '0 0 8px #10b981' }}></div>
                Gravando Online
              </span>
            </div>

            {logs.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#475569', fontSize: '14px' }}>
                Nenhuma leitura no Banco de Dados para esta visualização.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {logs.map((log) => (
                  <div key={log.id} style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '12px 15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#38bdf8' }}>{log.nome}</span>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>IP: {log.ip}</span>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>MAC: {log.mac}</span>
                      <span style={{ fontSize: '11px', color: '#cbd5e1' }}>{log.data} às <strong>{log.hora}</strong></span>
                    </div>
                    <div style={{ backgroundColor: '#fff', color: '#000', padding: '6px 12px', borderRadius: '6px', fontSize: '20px', fontWeight: '900', letterSpacing: '2px', borderTop: '4px solid #003399', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
                      {log.placa}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {abaAtiva === 'cadastro' && (
          <div style={{ maxWidth: '350px' }}>
            <h2 style={{ fontSize: '18px', margin: '0 0 20px 0', color: '#f8fafc', borderBottom: '1px solid #334155', paddingBottom: '10px' }}>
              {cameraEmEdicao ? 'Editar Câmera' : 'Configurar Nova Câmera'}
            </h2>
            <form onSubmit={salvarCamera} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '5px' }}>Nome de Identificação</label>
                <input required placeholder="Ex: Entrada Principal" value={novoNome} onChange={e => setNovoNome(e.target.value)}
                  style={{ width: '100%', padding: '7px', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#0f172a', color: '#fff', outline: 'none' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '5px' }}>Endereço MAC (Opcional)</label>
                <input placeholder="Ex: 58:5b:69:45:8f:91" value={novoMac} onChange={e => setNovoMac(e.target.value)} style={{ width: '100%', padding: '7px', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#0f172a', color: '#fff', outline: 'none', textTransform: 'lowercase' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '5px' }}>Endereço IP</label>
                <input required placeholder="Ex: 192.168.0.100" value={novoIp} onChange={e => setNovoIp(e.target.value)} style={{ width: '100%', padding: '7px', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#0f172a', color: '#fff', outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="submit" style={{ flex: 1, padding: '12px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', transition: '0.2s' }}>
                  {cameraEmEdicao ? 'Atualizar' : 'Salvar'}
                </button>
                {cameraEmEdicao && (
                  <button type="button" onClick={() => { setAbaAtiva('monitor'); setCameraEmEdicao(null); }} style={{ padding: '12px', backgroundColor: '#475569', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
                    Cancelar
                  </button>
                )}
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
