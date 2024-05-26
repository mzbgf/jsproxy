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
  return { body, status, headers };
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
  const urlStr = req.url;
  const urlObj = new URL(req.protocol + '://' + req.get('host') + urlStr);
  const path = urlObj.href.substr(urlObj.origin.length);
  // if (urlObj.protocol === 'http:') {
  //   urlObj.protocol = 'https:';
  //   return makeRes('', 301, {
  //     'strict-transport-security': 'max-age=99999999; includeSubDomains; preload',
  //     'location': urlObj.href,
  //   });
  // }
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
      return fetch(ASSET_URL + path).then(response => ({
        body: response.body,
        status: response.status,
        headers: {
          'content-type': response.headers.get('content-type'),
          'cache-control': 'max-age=600',
        },
      }));
  }
}
async function httpHandler(req, urlStr) {
  const reqInit = {
    method: req.method,
    headers: Object.fromEntries(req.headers),
    redirect: 'manual',
  };
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    reqInit.body = await req.buffer();
  }
  const urlObj = newUrl(urlStr);
  if (!urlObj) {
    return makeRes('invalid url: ' + urlStr, 400);
  }
  for (let i = 0; i <= MAX_RETRY; i++) {
    try {
      const res = await fetch(urlObj.href, reqInit);
      const resHdrNew = {
        'content-type': res.headers.get('content-type'),
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      };
      return makeRes(await res.buffer(), res.status, resHdrNew);
    } catch (err) {
      if (i === MAX_RETRY) {
        return makeRes('fetch error: ' + err.stack, 502);
      }
    }
  }
}
app.options('*', (req, res) => {
  res.status(PREFLIGHT_INIT.status).set(PREFLIGHT_INIT.headers).send();
});
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
