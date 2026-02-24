import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { networkInterfaces } from 'os'
import path, { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import express from 'express'
import sqlite3 from 'sqlite3'

// ==========================================
// CONFIGURAÇÃO DO SERVIDOR EXPRESS
// ==========================================
const expressApp = express();

expressApp.use(express.text({ type: '*/*', limit: '20mb' }));
expressApp.use(express.json());

expressApp.use(logCamera);

expressApp.post('/', (req, res) => res.sendStatus(200));
expressApp.get('/', (_, res) => res.send('Serviço Monitorando no Electron'));

const PORT = 8083;

// ==========================================
// VARIÁVEL DO BANCO DE DADOS (Iniciada depois)
// ==========================================
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
    // TRATAMENTO: Se vier vazio, transforma em NULL de verdade pro banco não dar erro de UNIQUE
    const macTratado = cam.mac && cam.mac.trim() !== '' ? cam.mac.toLowerCase().trim() : null;

    if (cam.id) { // Edição
      db.run('UPDATE equipamento SET nome = ?, mac = ?, ip = ? WHERE id = ?',
        [cam.nome, macTratado, cam.ip, cam.id], function (err) {
          if (err) resolve({ erro: err.message }); // Devolve o erro para o React
          else resolve({ sucesso: true });
        });
    } else { // Novo
      db.run('INSERT INTO equipamento (nome, mac, ip) VALUES (?, ?, ?)',
        [cam.nome, macTratado, cam.ip], function (err) {
          if (err) resolve({ erro: err.message }); // Devolve o erro para o React
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
// MIDDLEWARE logCamera COM BANCO DE DADOS
// ==========================================
// ==========================================
// MIDDLEWARE logCamera COM AUTO-ATUALIZAÇÃO DE MAC
// ==========================================
async function logCamera(req, res, next) {
  let ipCamera = req.ip || req.socket.remoteAddress;
  if (ipCamera && ipCamera.includes('::ffff:')) ipCamera = ipCamera.split('::ffff:')[1];

  if (req.body && typeof req.body === 'string' && req.body.includes('<?xml')) {
    const { objeto, listaParaLog } = extrairTodosCDATA(req.body);

    if (!objeto.plateNumber || !objeto.mac) return res.sendStatus(200);

    const macRecebido = objeto.mac.toLowerCase();

    // Função interna para salvar o log e enviar pro React (evita repetir código)
    const gravarLogEEnviar = (cameraData) => {
      db.run('INSERT INTO logs_equipamento (equipamento_mac, placa, ip_origem) VALUES (?, ?, ?)',
        [cameraData.mac, objeto.plateNumber, ipCamera], function (err) {

          const windows = BrowserWindow.getAllWindows();
          if (windows.length > 0) {
            windows[0].webContents.send('nova-leitura-placa', {
              id: this.lastID,
              nome: cameraData.nome,
              mac: cameraData.mac,
              placa: objeto.plateNumber,
              ip: ipCamera,
              data: new Date().toLocaleDateString('pt-BR'),
              hora: new Date().toLocaleTimeString('pt-BR')
            });
          }
          return res.sendStatus(200);
        });
    };

    // 1. Tenta achar a câmera pelo MAC recebido
    db.get('SELECT * FROM equipamento WHERE mac = ?', [macRecebido], (err, cameraByMac) => {
      if (cameraByMac) {
        // Achou de primeira pelo MAC! Tudo certo, só gravar o log.
        return gravarLogEEnviar(cameraByMac);
      }

      // 2. Não achou pelo MAC? Então procura se tem alguma câmera salva com esse IP
      db.get('SELECT * FROM equipamento WHERE ip = ?', [ipCamera], (err, cameraByIp) => {
        if (cameraByIp) {
          // Achou pelo IP! Vamos atualizar o MAC dela no banco de dados agora mesmo
          console.log(`[Auto-Update] Atualizando MAC da câmera '${cameraByIp.nome}' (IP: ${ipCamera}) para: ${macRecebido}`);

          db.run('UPDATE equipamento SET mac = ? WHERE id = ?', [macRecebido, cameraByIp.id], (updateErr) => {
            if (updateErr) {
              console.log("Erro ao atualizar MAC automaticamente:", updateErr.message);
              return res.sendStatus(200); // Libera a câmera mesmo com erro no update
            }
            // ======== NOVO: AVISA O REACT PARA RECARREGAR A LISTA ========
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0) {
              windows[0].webContents.send('atualizar-lista-cameras');
            }
            // MAC atualizado com sucesso! Agora grava o log da placa
            cameraByIp.mac = macRecebido; // Atualiza o objeto em memória
            return gravarLogEEnviar(cameraByIp);
          });
        } else {
          // 3. Não achou nem por MAC e nem por IP. É uma câmera totalmente desconhecida.
          console.log(`Câmera MAC ${macRecebido} (IP: ${ipCamera}) ignorada. Não cadastrada.`);
          return res.sendStatus(200);
        }
      });
    });

  } else {
    next();
  }
}

// ==========================================
// CONFIGURAÇÃO DO ELECTRON E STARTUP
// ==========================================
function createWindow() {
  const mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

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

  // ==========================================
  // 1. INICIALIZA O BANCO DE DADOS AQUI (Seguro)
  // ==========================================
  const dbPath = path.join(app.getPath('userData'), 'pdv_database.sqlite');
  db = new sqlite3.Database(dbPath);

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
  // 2. INICIA A TELA E O SERVIDOR EXPRESS
  // ==========================================
  createWindow()

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
