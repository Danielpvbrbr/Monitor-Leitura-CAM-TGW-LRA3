import { app, shell, BrowserWindow, ipcMain, Tray, Menu } from 'electron' // Ajustado: Menu adicionado
import { networkInterfaces } from 'os'
import path, { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import express from 'express'
import sqlite3 from 'sqlite3'

const expressApp = express();

expressApp.use(express.text({ type: '*/*', limit: '20mb' }));
expressApp.use(express.json());

expressApp.use(logCamera);

expressApp.post('/', (req, res) => res.sendStatus(200));
expressApp.get('/', (_, res) => res.send('Serviço Monitorando no Electron'));

const PORT = 8083;

// ==========================================
// VARIÁVEIS GLOBAIS (Janela, Gaveta e BD)
// ==========================================
let tray = null;
let mainWindow = null;
let sistemaEncerrando = false;
let db;

// ==========================================
// FUNÇÕES DO SEU MIDDLEWARE
// ==========================================
const extrairTodosCDATA = (xml) => {
  const regex = /<(\w+)[^>]*><!\[CDATA\[(.*?)\]\]><\/\1>/g;
  const objeto = {};
  const listaParaLog = [];
  let match;

  while ((match = regex.exec(xml)) !== null) {
    const chave = match[1];
    const valor = match[2].trim();

    if (!objeto[chave] || valor !== "") {
      objeto[chave] = valor;
    }

    listaParaLog.push(`${chave}: ${valor}`);
  }

  return { objeto, listaParaLog };
};

// ==========================================
// ROTAS IPC (Ponte entre o Banco/SO e o React)
// ==========================================
ipcMain.handle('get-server-info', () => {
  const nets = networkInterfaces();
  let ip = '127.0.0.1';

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ip = net.address;
      }
    }
  }
  return { ip: ip, port: 8083, version: app.getVersion() };
});

ipcMain.handle('get-cameras', () => {
  return new Promise((resolve) => {
    db.all('SELECT * FROM equipamento', (err, rows) => resolve(rows || []));
  });
});

ipcMain.handle('salvar-camera', (event, cam) => {
  return new Promise((resolve) => {
    const macTratado = cam.mac && cam.mac.trim() !== '' ? cam.mac.toLowerCase().trim() : null;

    if (cam.id) {
      db.run('UPDATE equipamento SET nome = ?, mac = ?, ip = ? WHERE id = ?',
        [cam.nome, macTratado, cam.ip, cam.id], function (err) {
          if (err) resolve({ erro: err.message });
          else resolve({ sucesso: true });
        });
    } else {
      db.run('INSERT INTO equipamento (nome, mac, ip) VALUES (?, ?, ?)',
        [cam.nome, macTratado, cam.ip], function (err) {
          if (err) resolve({ erro: err.message });
          else resolve({ sucesso: true });
        });
    }
  });
});

ipcMain.handle('deletar-camera', (event, mac) => {
  return new Promise((resolve) => {
    db.run('DELETE FROM equipamento WHERE mac = ?', [mac], () => resolve(true));
  });
});

ipcMain.handle('get-logs', (event, macFiltro) => {
  return new Promise((resolve) => {
    const query = macFiltro
      ? 'SELECT l.*, e.nome FROM logs_equipamento l JOIN equipamento e ON l.equipamento_mac = e.mac WHERE l.equipamento_mac = ? ORDER BY l.id DESC LIMIT 50'
      : 'SELECT l.*, e.nome FROM logs_equipamento l JOIN equipamento e ON l.equipamento_mac = e.mac ORDER BY l.id DESC LIMIT 50';

    const params = macFiltro ? [macFiltro] : [];

    db.all(query, params, (err, rows) => resolve(rows || []));
  });
});

// ==========================================
// MIDDLEWARE logCamera COM VALIDAÇÃO DE PLACA
// ==========================================
async function logCamera(req, res, next) {
  let ipCamera = req.ip || req.socket.remoteAddress;
  if (ipCamera && ipCamera.includes('::ffff:')) ipCamera = ipCamera.split('::ffff:')[1];

  if (req.body && typeof req.body === 'string' && req.body.includes('<?xml')) {
    const { objeto, listaParaLog } = extrairTodosCDATA(req.body);

    if (!objeto.plateNumber || !objeto.mac) return res.sendStatus(200);

    const placaLimpa = objeto.plateNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const placaValida = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placaLimpa);

    if (!placaValida) {
      console.log(`[Filtro] Leitura ignorada (Placa Inválida): ${objeto.plateNumber}`);
      return res.sendStatus(200);
    }

    const macRecebido = objeto.mac.toLowerCase();

    const gravarLogEEnviar = (cameraData) => {
      db.run('INSERT INTO logs_equipamento (equipamento_mac, placa, ip_origem) VALUES (?, ?, ?)',
        [cameraData.mac, placaLimpa, ipCamera], function (err) {

          const windows = BrowserWindow.getAllWindows();
          if (windows.length > 0) {
            windows[0].webContents.send('nova-leitura-placa', {
              id: this.lastID,
              nome: cameraData.nome,
              mac: cameraData.mac,
              placa: placaLimpa,
              ip: ipCamera,
              data: new Date().toLocaleDateString('pt-BR'),
              hora: new Date().toLocaleTimeString('pt-BR')
            });
          }
          return res.sendStatus(200);
        });
    };

    db.get('SELECT * FROM equipamento WHERE mac = ?', [macRecebido], (err, cameraByMac) => {
      if (cameraByMac) {
        return gravarLogEEnviar(cameraByMac);
      }

      db.get('SELECT * FROM equipamento WHERE ip = ?', [ipCamera], (err, cameraByIp) => {
        if (cameraByIp) {
          console.log(`[Auto-Update] Atualizando MAC da câmera '${cameraByIp.nome}' (IP: ${ipCamera}) para: ${macRecebido}`);

          db.run('UPDATE equipamento SET mac = ? WHERE id = ?', [macRecebido, cameraByIp.id], (updateErr) => {
            if (updateErr) {
              console.log("Erro ao atualizar MAC automaticamente:", updateErr.message);
              return res.sendStatus(200);
            }

            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0) {
              windows[0].webContents.send('atualizar-lista-cameras');
            }

            cameraByIp.mac = macRecebido;
            return gravarLogEEnviar(cameraByIp);
          });
        } else {
          console.log(`Câmera MAC ${macRecebido} (IP: ${ipCamera}) ignorada. Não cadastrada.`);
          return res.sendStatus(200);
        }
      });
    });

  } else {
    next();
  }
}


function createWindow() {
  mainWindow = new BrowserWindow({
    width: 630,
    height: 500,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // INTERCEPTA O BOTÃO "X":
  mainWindow.on('close', (event) => {
    if (!sistemaEncerrando) {
      event.preventDefault(); // Impede o fechamento real
      mainWindow.hide();      // Apenas esconde a janela

      if (tray) {
        tray.displayBalloon({
          title: 'PDV Rodando em 2º Plano',
          content: 'O sistema de câmeras continua registrando as placas.',
          iconType: 'info'
        });
      }
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: true, // Diz pro Windows: "Liga isso quando o usuário entrar"
      path: app.getPath('exe'), // Pega o caminho exato de onde o .exe está salvo
      args: [
        '--processStart', `"${app.getName()}.exe"`,
        '--process-start-args', `"--hidden"`
      ]
    });
  }

  tray = new Tray(icon);
  tray.setToolTip('LPR - Monitor de Câmeras');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Abrir Painel', click: () => { if (mainWindow) mainWindow.show(); } },
    { type: 'separator' },
    {
      label: 'Encerrar Sistema',
      click: () => {
        sistemaEncerrando = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) mainWindow.show();
  });

  // 1. INICIALIZA O BANCO DE DADOS JUNTO AO .EXE
  // ==========================================
  let pastaDoExecutavel;

  if (app.isPackaged) {
    // Se for o sistema compilado (.exe), pega a pasta onde ele foi instalado/colocado
    pastaDoExecutavel = path.dirname(app.getPath('exe'));
  } else {
    // Se for modo de desenvolvimento (npm run dev), pega a raiz do projeto
    pastaDoExecutavel = app.getAppPath();
  }

  const dbPath = path.join(pastaDoExecutavel, 'banco_lpr.sqlite');
  db = new sqlite3.Database(dbPath);
  // ==========================================

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS equipamento (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      mac TEXT UNIQUE,
      ip TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS logs_equipamento (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipamento_mac TEXT,
      placa TEXT,
      ip_origem TEXT,
      data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS configuracoes (
      chave TEXT PRIMARY KEY,
      valor TEXT
    )`);
  });

  // ==========================================
  // INICIA A TELA E O SERVIDOR EXPRESS
  // ==========================================
  createWindow();

  expressApp.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor Express escutando na rede local na porta ${PORT}...`);
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
