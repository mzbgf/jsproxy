'use strict';
import express from 'express';
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fetch from 'node-fetch';
dotenv.config();

const app = express();
app.use(bodyParser.json());

const port = process.env.PORT || 3000;
const ASSET_URL = 'https://etherdream.github.io/jsproxy';
const JS_VER = 10;
const MAX_RETRY = 1;

const PREFLIGHT_INIT = {
  status: 204,
  headers: {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
    'access-control-max-age': '1728000',
  },
};

function makeRes(body, status = 200, headers = {}) {
  headers['--ver'] = JS_VER;
  headers['access-control-allow-origin'] = '*';
  // return { body, status, headers };
  return new Response(body, {status, headers})
}

function newUrl(urlStr) {
  try {
    return new URL(urlStr);
  } catch (err) {
    return null;
  }
}

app.use(async (req, res) => {
  try {
    const ret = await fetchHandler(req);
    res.status(ret.status).set(ret.headers).send(ret.body);
  } catch (err) {
    const errorRes = makeRes('cfworker error:\n' + err.stack, 502);
    res.status(errorRes.status).set(errorRes.headers).send(errorRes.body);
  }
});

async function fetchHandler(req) {
  // const urlStr = req.url;
  const urlObj = new URL(req.protocol + '://' + req.get('host') + req.originalUrl);
  const path = urlObj.href.substr(urlObj.origin.length);

  if (urlObj.protocol === 'http:') {
    urlObj.protocol = 'https:';
    return makeRes('', 301, {
      'strict-transport-security': 'max-age=99999999; includeSubDomains; preload',
      'location': urlObj.href,
    });
  }

  if (path.startsWith('/http/')) {
    return httpHandler(req, path.substr(6));
  }

  switch (path) {
    case '/http':
      return makeRes('请更新 cfworker 到最新版本!');
    case '/ws':
      return makeRes('not support', 400);
    case '/works':
      return makeRes('it works');
    default:
      return fetch(ASSET_URL + path);
  }
}

async function httpHandler(req, urlStr) {

  if (req.method === 'OPTIONS' &&
      reqHdrRaw.has('access-control-request-headers')
  ) {
    return new Response(null, PREFLIGHT_INIT)
  }

  let acehOld = false
  let rawLen = ''

  const reqHdrNew = new Headers(reqHdrRaw)
  reqHdrNew.set('x-jsproxy', '1')

  const refer = reqHdrNew.get('referer')
  const query = refer.substr(refer.indexOf('?') + 1)
  if (!query) {
    return makeRes('missing params', 403)
  }
  const param = new URLSearchParams(query)

  for (const [k, v] of Object.entries(param)) {
    if (k.substr(0, 2) === '--') {
      // 系统信息
      switch (k.substr(2)) {
      case 'aceh':
        acehOld = true
        break
      case 'raw-info':
        [rawSvr, rawLen, rawEtag] = v.split('|')
        break
      }
    } else {
      // 还原 HTTP 请求头
      if (v) {
        reqHdrNew.set(k, v)
      } else {
        reqHdrNew.delete(k)
      }
    }
  }

  if (!param.has('referer')) {
    reqHdrNew.delete('referer')
  }

  const reqInit = {
    method: req.method,
    headers: reqHdrNew,
    redirect: 'manual',
  }
  if (req.method === 'POST') {
    reqInit.body = req.body
  }
  return proxy(urlObj, reqInit, acehOld, rawLen, 0)
}

async function proxy(urlObj, reqInit, acehOld, rawLen, retryTimes) {
  const res = await fetch(urlObj.href, reqInit)
  const resHdrOld = res.headers
  const resHdrNew = new Headers(resHdrOld)

  let expose = '*'
  
  for (const [k, v] of resHdrOld.entries()) {
    if (k === 'access-control-allow-origin' ||
        k === 'access-control-expose-headers' ||
        k === 'location' ||
        k === 'set-cookie'
    ) {
      const x = '--' + k
      resHdrNew.set(x, v)
      if (acehOld) {
        expose = expose + ',' + x
      }
      resHdrNew.delete(k)
    }
    else if (acehOld &&
      k !== 'cache-control' &&
      k !== 'content-language' &&
      k !== 'content-type' &&
      k !== 'expires' &&
      k !== 'last-modified' &&
      k !== 'pragma'
    ) {
      expose = expose + ',' + k
    }
  }

  if (acehOld) {
    expose = expose + ',--s'
    resHdrNew.set('--t', '1')
  }

  // verify
  if (rawLen) {
    const newLen = resHdrOld.get('content-length') || ''
    const badLen = (rawLen !== newLen)

    if (badLen) {
      if (retryTimes < MAX_RETRY) {
        urlObj = await parseYtVideoRedir(urlObj, newLen, res)
        if (urlObj) {
          return proxy(urlObj, reqInit, acehOld, rawLen, retryTimes + 1)
        }
      }
      return makeRes(res.body, 400, {
        '--error': `bad len: ${newLen}, except: ${rawLen}`,
        'access-control-expose-headers': '--error',
      })
    }

    if (retryTimes > 1) {
      resHdrNew.set('--retry', retryTimes)
    }
  }

  let status = res.status

  resHdrNew.set('access-control-expose-headers', expose)
  resHdrNew.set('access-control-allow-origin', '*')
  resHdrNew.set('--s', status)
  resHdrNew.set('--ver', JS_VER)

  resHdrNew.delete('content-security-policy')
  resHdrNew.delete('content-security-policy-report-only')
  resHdrNew.delete('clear-site-data')

  if (status === 301 ||
      status === 302 ||
      status === 303 ||
      status === 307 ||
      status === 308
  ) {
    status = status + 10
  }

  return new Response(res.body, {
    status,
    headers: resHdrNew,
  })
}

function isYtUrl(urlObj) {
  return (
    urlObj.host.endsWith('.googlevideo.com') &&
    urlObj.pathname.startsWith('/videoplayback')
  )
}

async function parseYtVideoRedir(urlObj, newLen, res) {
  if (newLen > 2000) {
    return null
  }
  if (!isYtUrl(urlObj)) {
    return null
  }
  try {
    const data = await res.text()
    urlObj = new URL(data)
  } catch (err) {
    return null
  }
  if (!isYtUrl(urlObj)) {
    return null
  }
  return urlObj
}

app.options('*', (req, res) => {
  res.status(PREFLIGHT_INIT.status).set(PREFLIGHT_INIT.headers).send();
});
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
