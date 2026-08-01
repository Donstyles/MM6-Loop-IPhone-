const zoom = (x, y, w, h) => `(() => {
  const prev = document.getElementById('__zoom');
  if (prev) prev.remove();
  const all = [...document.querySelectorAll('canvas')].filter((c) => c.id !== '__zoom');
  const c = document.createElement('canvas');
  c.id = '__zoom';
  c.width = 1280; c.height = 960;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  for (const src of all) {
    const s = src.width / 640;
    g.drawImage(src, ${x}*s, ${y}*s, ${w}*s, ${h}*s, 0, 0, 1280, 960);
  }
  c.style.position = 'fixed'; c.style.left = '0'; c.style.top = '0';
  c.style.zIndex = '99999'; c.style.width = '1280px'; c.style.height = '960px';
  document.body.appendChild(c);
})()`;
export default [
  ['zoom-none', `(() => { const p = document.getElementById('__zoom'); if (p) p.remove(); })()`, 100],
  ['title', null, 1200],
  ['zoom-castle', zoom(300, 230, 240, 180), 250],
  ['zoom-tree', zoom(30, 270, 160, 120), 250],
  ['zoom-sky', zoom(0, 180, 320, 140), 250],
];
