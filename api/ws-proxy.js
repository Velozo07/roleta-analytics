const { WebSocket, WebSocketServer } = require('ws');
const https = require('https');

const SITE_ID = 18749804;
const PRIMARY_SERVERS = [
  'wss://eu-re-it-mg-api.betconstruct.com/ws',
  'wss://it-mg-api.betconstruct.com/ws',
  'wss://eu-re-it-mg-api.betconstruct.com/smart-api',
];

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Origin': 'https://maxima.bet.br',
  'Referer': 'https://maxima.bet.br/',
};

module.exports = (req, res) => {
  if (req.method === 'GET' && !req.headers.upgrade) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', message: 'WebSocket proxy running' }));
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  wss.handleUpgrade(req, req.socket, Buffer.alloc(0), (ws) => {
    wss.emit('connection', ws, req);
  });

  wss.on('connection', (ws) => {
    const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
    const targetUrl = urlParams.get('url') || PRIMARY_SERVERS[0];
    const siteId = urlParams.get('site_id') || SITE_ID;

    const pingUrl = `https://${new URL(targetUrl).host}/ping?site_id=${siteId}`;

    // Ping para aquecer a sessão
    https.get(pingUrl, { headers: COMMON_HEADERS }, () => {}).on('error', () => {});

    const remoteWs = new WebSocket(`${targetUrl}?site_id=${siteId}`, {
      headers: {
        ...COMMON_HEADERS,
        'Host': new URL(targetUrl).host,
        'Accept-Encoding': 'gzip, deflate, br',
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
      },
      handshakeTimeout: 60000,
      rejectUnauthorized: false,
    });

    const pingInterval = setInterval(() => {
      if (remoteWs.readyState === WebSocket.OPEN) {
        remoteWs.send(JSON.stringify({ command: 'ping' }));
      }
    }, 20000);

    remoteWs.on('open', () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ _proxy_status: 'connected', target: targetUrl }));
      }
    });

    remoteWs.on('message', (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data.toString());
      }
    });

    remoteWs.on('close', (code, reason) => {
      clearInterval(pingInterval);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(code, reason.toString());
      }
    });

    remoteWs.on('error', (err) => {
      clearInterval(pingInterval);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ _proxy_status: 'error', message: err.message }));
        ws.terminate();
      }
    });

    ws.on('message', (data) => {
      if (remoteWs.readyState === WebSocket.OPEN) {
        remoteWs.send(data.toString());
      }
    });

    ws.on('close', () => {
      clearInterval(pingInterval);
      remoteWs.close();
    });
  });
};
