// Data source. Live backend by default; open with ?api=mock to rehearse
// without the backend running.
(function () {
  'use strict';

  const USE_MOCK = false;
  const API_BASE = 'http://localhost:8000';

  const override = new URLSearchParams(location.search).get('api');
  const mock = override ? override !== 'live' : USE_MOCK;

  async function request(path, init) {
    const res = await fetch(API_BASE + path, init);
    if (!res.ok) {
      const err = new Error(`${res.status} ${path}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  const LiveAPI = {
    getBaseline: () => request('/api/detections/baseline'),
    getFused: () => request('/api/detections/fused'),
    explain: (body) =>
      request('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };

  window.API = mock ? window.MockAPI : LiveAPI;
  window.API_SOURCE = mock ? 'mock' : API_BASE;
})();
