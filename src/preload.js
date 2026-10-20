import * as THREE from 'three';
// 启动预加载：进游戏前把角色模型、枪、动作数据全部下载进内存，之后切角色、进对局、AI 生成都不用再等网络。
// GLTFLoader 走 THREE.Cache（同一个地址第二次加载直接用内存里的数据）；fetch 读的 JSON / 模型用 preloaded()。
THREE.Cache.enabled = true;

const bufs = new Map(); // url → ArrayBuffer
const waits = new Map(); // url → Promise<ArrayBuffer>

// 已经预加载好的数据（没有就返回 null）
export function preloaded(url) { return bufs.get(url) || null; }
// 等某个文件预加载完（不在列表里就立即返回）
export function whenLoaded(url) { return waits.get(url) || Promise.resolve(null); }
// 预加载过的 JSON
export async function preloadedJSON(url) {
  const b = bufs.get(url) || (await whenLoaded(url));
  return b ? JSON.parse(new TextDecoder().decode(b)) : null;
}

// urls：按先后顺序；onProgress(已完成字节, 总字节估计, 已完成个数, 总个数)
export function preloadAll(urls, onProgress, conc = 4) {
  const list = [...new Set(urls.filter(Boolean))];
  const sizes = new Map(), got = new Map();
  let done = 0;
  const report = () => {
    let total = 0, have = 0;
    for (const u of list) { total += sizes.get(u) || 4e6; have += got.get(u) || 0; }
    onProgress?.(have, total, done, list.length);
  };
  const one = async (u) => {
    try {
      const r = await fetch(u);
      if (!r.ok) throw new Error(r.status);
      const len = +r.headers.get('content-length') || 0;
      if (len) sizes.set(u, len);
      let buf;
      if (r.body && r.body.getReader) {
        const rd = r.body.getReader(), parts = [];
        let n = 0;
        for (;;) {
          const { done: end, value } = await rd.read();
          if (end) break;
          parts.push(value); n += value.length; got.set(u, n);
          if (!len) sizes.set(u, Math.max(n, sizes.get(u) || 0));
          report();
        }
        const out = new Uint8Array(n);
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        buf = out.buffer;
      } else buf = await r.arrayBuffer();
      sizes.set(u, buf.byteLength); got.set(u, buf.byteLength);
      bufs.set(u, buf);
      THREE.Cache.add(`file:${u}`, buf); // FileLoader（GLTFLoader 用的）按 "file:地址" 查缓存
      return buf;
    } catch (e) {
      console.warn('预加载失败（进游戏时再按需加载）', u, e);
      got.set(u, sizes.get(u) || 4e6);
      return null;
    } finally { done++; report(); }
  };
  // 先把每个文件的等待登记好，再按并发数依次下载
  const resolvers = new Map();
  for (const u of list) waits.set(u, new Promise((res) => resolvers.set(u, res)));
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const u = list[next++];
      resolvers.get(u)(await one(u));
    }
  };
  report();
  return Promise.all(Array.from({ length: Math.min(conc, list.length) }, worker));
}
