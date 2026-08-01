const zoom = (x, y, w, h) => `(() => {
  const all = [...document.querySelectorAll('canvas')];
  const c = document.createElement('canvas');
  c.width = 1280; c.height = 960;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  for (const src of all) {
    const s = src.width / 640;
    g.drawImage(src, ${x}*s, ${y}*s, ${w}*s, ${h}*s, 0, 0, 1280, 960);
  }
  document.body.innerHTML = '';
  document.body.style.margin = '0';
  c.style.position = 'fixed'; c.style.left = '0'; c.style.top = '0';
  document.body.appendChild(c);
})()`;
export default [
  ['title', null, 1200],
  ['zoom-castle', zoom(280, 110, 240, 180), 300],
];
