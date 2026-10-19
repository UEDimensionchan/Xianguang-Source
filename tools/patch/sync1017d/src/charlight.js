// 角色（VRM / MToon）材质跟着环境光走。
// VRoid 导出的模型自带 matcap（一张“假反光”贴图），MToon 默认不受灯光影响，
// 夜里场景暗下来以后它还是白天的亮度，就成了一圈发亮的怪边缘光。这里统一处理：
//  · rimLightingMix = 1：边缘光 / matcap 乘上实际受光，背光面不再发亮
//  · 再按昼夜、阴天把 matcap 和自发光整体压暗
// 原始数值记在 userData.clBase（纯数字，材质 clone 时会跟着复制，所以第一人称手臂的副本也能还原）
const mats = new Set();
let K = 1, E = 1;

function apply(m) {
  const b = m.userData.clBase;
  if (b.mc && m.matcapFactor) m.matcapFactor.setRGB(b.mc[0] * K, b.mc[1] * K, b.mc[2] * K);
  if (b.em && m.emissive) m.emissive.setRGB(b.em[0] * E, b.em[1] * E, b.em[2] * E);
}

export function registerCharacter(root) {
  root?.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      if (!m.isMToonMaterial || mats.has(m)) continue;
      if (!m.userData.clBase) {
        m.userData.clBase = {
          mc: m.matcapFactor ? m.matcapFactor.toArray() : null,
          em: m.emissive ? m.emissive.toArray() : null,
        };
      }
      m.rimLightingMixFactor = 1;
      mats.add(m);
      apply(m);
    }
  });
}

export function unregisterCharacter(root) {
  root?.traverse((o) => { for (const m of [].concat(o.material || [])) mats.delete(m); });
}

// k：matcap 亮度（白天 1），e：自发光亮度
export function setCharLight(k, e) {
  if (Math.abs(k - K) < 0.004 && Math.abs(e - E) < 0.004) return;
  K = k; E = e;
  for (const m of mats) apply(m);
}
