'use strict';
const http = require('http');
const https = require('https');
const { URL } = require('url');
// 静态文件 URL
const ASSET_URL = '<https://etherdream.github.io/jsproxy>';
const JS_VER = 10;
const MAX_RETRY = 1;
/**
 * 生成响应
 * @param {any} body
 * @param {number} status
 * @param {Object<string, string>} headers
 */
function makeRes(body, status = 200, headers = {}) {
  headers['--ver'] = JS_VER;
  headers['access-control-allow-origin'] = '*';
  return { body, status, headers };
}
/**
 * 创建新的 URL 对象
 * @param {string} urlStr 
 */
function newUrl(urlStr) {
  try {
    return new URL(urlStr);
  } catch (err) {
    return null;
  }
}
/**
 * 处理请求
 * @param {http.IncomingMessage} req 
 * @param {http.ServerResponse} res 
 */
async function fetchHandler(req, res) {
  const urlStr = req.url;
  const urlObj = new URL(urlStr, `<http://${req.headers.host}>`);
  const path = urlObj.href.substr(urlObj.origin.length);
  if (urlObj.protocol === 'http:') {
    urlObj.protocol = 'https:';
    const response = makeRes('', 301, {
      'strict-transport-security': 'max-age=99999999; includeSubDomains; preload',
      'location': urlObj.href,
    });
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return;
  }
  if (path.startsWith('/http/')) {
    const response = await httpHandler(req, path.substr(6));
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return;
  }
  let response;
  switch (path) {
    case '/http':
      response = makeRes('请更新 cfworker 到最新版本!');
      break;
    case '/ws':
      response = makeRes('not support', 400);
      break;
    case '/works':
      response = makeRes('it works');
      break;
    default:
      // 静态文件
      response = await fetch(ASSET_URL + path);
      break;
  }
  res.writeHead(response.status, response.headers);
  res.end(response.body);
}
/**
 * 处理 HTTP 请求
 * @param {http.IncomingMessage} req 
 * @param {string} targetUrl 
 */
async function httpHandler(req, targetUrl) {
  const urlObj = newUrl(targetUrl);
  if (!urlObj) {
    return makeRes('invalid url: ' + targetUrl, 400);
  }
  const options = {
    method: req.method,
    headers: req.headers,
  };
  return new Promise((resolve, reject) => {
    const client = urlObj.protocol === 'https:' ? https : http;
    const proxyReq = client.request(urlObj, options, (proxyRes) => {
      let body = '';
      proxyRes.on('data', (chunk) => {
        body += chunk;
      });
      proxyRes.on('end', () => {
        resolve(makeRes(body, proxyRes.statusCode, proxyRes.headers));
      });
    });
    proxyReq.on('error', (err) => {
      resolve(makeRes('proxy error: ' + err.message, 502));
    });
    if (req.method === 'POST' || req.method === 'PUT') {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  });
}
const server = http.createServer(fetchHandler);
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
