// 8 把枪的换弹动画（关键帧）。时间 t 是 0–1 的比例，游戏里按每把枪的换弹时长缩放。
// 坐标都在枪自己的空间里，单位厘米：+X 枪的左侧（左手那边），+Y 向上，+Z 指向枪口。旋转单位是度，绕枪的 X/Y/Z 轴。
//
// 每个关键帧可以写这些通道（没写的通道在这一帧不打关键帧，前后自动插值）：
//   root:  整把枪绕握把的偏移 { r:[x,y,z], p:[x,y,z] }
//   hand:  左手手腕位置，[x,y,z]，或 { at:'骨骼/节点名', off:[x,y,z] } 表示跟着那个部件走，或 'rest' 回到默认握持点
//   bones: 枪的骨骼 { 名字: { p:[位移], r:[旋转], s:缩放 } }，位移/旋转相对默认姿势
//   nodes: 换弹专用的道具节点（新弹匣、霰弹、快速装弹器、火箭弹），{ 名字: { p:[位置], r:[旋转], s:缩放 } }，位置是绝对位置

const shellCycle = (t0, len) => {
  // 霰弹枪：手托着一发霰弹从下方装填口塞进去（hand 是掌心位置）
  const a = t0, b = t0 + len * 0.45, c = t0 + len * 0.8, d = t0 + len;
  return [
    { t: a, nodes: { Reload_Shell: { p: [6, -20, 2], r: [0, 0, 0], s: 1 } }, hand: { at: 'Reload_Shell', off: [0.4, -1.6, -2.4] }, pose: 'shell' },
    { t: b, nodes: { Reload_Shell: { p: [0, -6, 11], s: 1 } }, hand: { at: 'Reload_Shell', off: [0.4, -1.6, -2.4] }, pose: 'shell' },
    { t: c, nodes: { Reload_Shell: { p: [0, -3.5, 16], s: 1 } }, hand: { at: 'Reload_Shell', off: [0.4, -1.6, -2.4] }, pose: 'shell' },
    { t: d, nodes: { Reload_Shell: { p: [0, -3.5, 16], s: 0 } }, hand: [8, -18, 4], pose: 'open' },
  ];
};

export const RELOADS = {
  // ———— 长枪（手掌接触点模式）————
  // 长枪的 hand 是左手掌心贴住的位置（不是手腕），pose 是手型：
  //   rest 托住护木  mag 握住弹匣  charge 勾拉机柄  side 从左侧捏住枪栓/拉柄  sideR 从右侧握住枪栓
  //   flat 手掌按住盖子  shell 捏着一发霰弹  open 空手（扔弹匣、去腰间拿弹匣的途中）
  // 没写 pose 时按接触的部件自动选：Magazine→mag，Charging_Handle→charge，Feed_Cover→flat，Forend→rest，Reload_Shell→shell，'rest'→rest
  AssaultRifle: [
    { t: 0.1, root: { r: [-8, 0, 22], p: [2, -2, 0] }, hand: { at: 'Magazine', off: [1.6, -4, 0.5] } },
    { t: 0.2, bones: { Magazine: { p: [0, 0, 0], r: [0, 0, 0], s: 1 } }, hand: { at: 'Magazine', off: [1.6, -4, 0.5] } },
    { t: 0.3, bones: { Magazine: { p: [0, -13, 1], r: [8, 0, 0] } }, hand: { at: 'Magazine', off: [1.6, -4, 0.5] } },
    { t: 0.38, bones: { Magazine: { p: [3, -38, -4], r: [40, 0, 25], s: 1 } }, hand: [9, -20, -4], pose: 'open' },
    { t: 0.39, bones: { Magazine: { s: 0 } } },
    { t: 0.5, bones: { Magazine: { p: [21, -36, -16], r: [20, 0, -10], s: 0 } }, hand: [22, -30, -14], pose: 'mag' },
    { t: 0.51, bones: { Magazine: { s: 1 } }, hand: { at: 'Magazine', off: [1.6, -4, 0.5] } },
    { t: 0.66, bones: { Magazine: { p: [0, -5, 0], r: [4, 0, 0] } }, hand: { at: 'Magazine', off: [1.6, -4, 0.5] } },
    { t: 0.74, bones: { Magazine: { p: [0, 0, 0], r: [0, 0, 0] } }, hand: { at: 'Magazine', off: [1.6, -5.5, 0.5] } },
    { t: 0.78, root: { r: [-6, 0, 14], p: [1, -1, 0] }, hand: { at: 'Magazine', off: [1.6, -3, 0.5] } },
    { t: 0.84, hand: { at: 'Charging_Handle', off: [1.8, 1.4, 0.8] } },
    { t: 0.89, bones: { Charging_Handle: { p: [0, 0, -7] } }, hand: { at: 'Charging_Handle', off: [1.8, 1.4, 0.8] } },
    { t: 0.92, bones: { Charging_Handle: { p: [0, 0, 0] } }, hand: [3, 9, 0], pose: 'open' },
    { t: 1.0, root: { r: [0, 0, 0], p: [0, 0, 0] }, hand: 'rest' },
  ],

  SMG: [
    { t: 0.1, root: { r: [-8, 0, 22], p: [2, -2, 0] }, hand: { at: 'Magazine', off: [1.7, -6, 0.5] } },
    { t: 0.2, bones: { Magazine: { p: [0, 0, 0], r: [0, 0, 0], s: 1 } }, hand: { at: 'Magazine', off: [1.7, -6, 0.5] } },
    { t: 0.3, bones: { Magazine: { p: [0, -15, 1], r: [8, 0, 0] } }, hand: { at: 'Magazine', off: [1.7, -6, 0.5] } },
    { t: 0.38, bones: { Magazine: { p: [3, -42, -4], r: [40, 0, 25], s: 1 } }, hand: [9, -22, -4], pose: 'open' },
    { t: 0.39, bones: { Magazine: { s: 0 } } },
    { t: 0.5, bones: { Magazine: { p: [21, -30, -12], r: [20, 0, -10], s: 0 } }, hand: [22, -34, -10], pose: 'mag' },
    { t: 0.51, bones: { Magazine: { s: 1 } }, hand: { at: 'Magazine', off: [1.7, -6, 0.5] } },
    { t: 0.66, bones: { Magazine: { p: [0, -5, 0], r: [4, 0, 0] } }, hand: { at: 'Magazine', off: [1.7, -6, 0.5] } },
    { t: 0.74, bones: { Magazine: { p: [0, 0, 0], r: [0, 0, 0] } }, hand: { at: 'Magazine', off: [1.7, -7.5, 0.5] } },
    { t: 0.78, root: { r: [-4, 0, 10], p: [1, -1, 0] }, hand: { at: 'Magazine', off: [1.7, -5, 0.5] } },
    { t: 0.84, hand: { at: 'Bolt', off: [1.4, 0.5, -0.5] }, pose: 'side' },
    { t: 0.89, bones: { Bolt: { p: [0, 0, -6] } }, hand: { at: 'Bolt', off: [1.4, 0.5, -0.5] }, pose: 'side' },
    { t: 0.92, bones: { Bolt: { p: [0, 0, 0] } }, hand: [4, 5, 22], pose: 'open' },
    { t: 1.0, root: { r: [0, 0, 0], p: [0, 0, 0] }, hand: 'rest' },
  ],

  LightMachineGun: [
    { t: 0.1, root: { r: [-6, 0, 12], p: [2, -2, 0] }, hand: { at: 'Feed_Cover', off: [0.5, 1.6, -9] } },
    { t: 0.18, bones: { Feed_Cover: { r: [0, 0, 0] } }, hand: { at: 'Feed_Cover', off: [0.5, 1.6, -9] } },
    { t: 0.26, bones: { Feed_Cover: { r: [65, 0, 0] } }, hand: [4, 14, 4], pose: 'open' },
    { t: 0.32, hand: { at: 'Magazine', off: [8.6, -3, 0] } },
    { t: 0.38, bones: { Magazine: { p: [0, 0, 0], r: [0, 0, 0], s: 1 } }, hand: { at: 'Magazine', off: [8.6, -3, 0] } },
    { t: 0.46, bones: { Magazine: { p: [6, -32, -2], r: [20, 0, 30], s: 1 } }, hand: [14, -18, -2], pose: 'open' },
    { t: 0.47, bones: { Magazine: { s: 0 } } },
    { t: 0.56, bones: { Magazine: { p: [14, -30, -12], r: [10, 0, 0], s: 0 } }, hand: [22, -30, -10], pose: 'mag' },
    { t: 0.57, bones: { Magazine: { s: 1 } }, hand: { at: 'Magazine', off: [8.6, -3, 0] } },
    { t: 0.7, bones: { Magazine: { p: [0, 0, 0], r: [0, 0, 0] } }, hand: { at: 'Magazine', off: [8.6, -3, 0] } },
    { t: 0.76, bones: { Feed_Cover: { r: [65, 0, 0] } }, hand: { at: 'Feed_Cover', off: [0.5, 8, -14] }, pose: 'flat' },
    { t: 0.83, bones: { Feed_Cover: { r: [0, 0, 0] } }, hand: { at: 'Feed_Cover', off: [0.5, 1.6, -9] } },
    { t: 0.87, hand: { at: 'Charging_Handle', off: [-2.2, 0.8, 0] }, pose: 'sideR' },
    { t: 0.91, bones: { Charging_Handle: { p: [0, 0, -8] } }, hand: { at: 'Charging_Handle', off: [-2.2, 0.8, 0] }, pose: 'sideR' },
    { t: 0.94, bones: { Charging_Handle: { p: [0, 0, 0] } }, hand: { at: 'Charging_Handle', off: [-2.2, 0.8, 0] }, pose: 'sideR' },
    { t: 1.0, root: { r: [0, 0, 0], p: [0, 0, 0] }, hand: 'rest' },
  ],

  Sniper: [
    { t: 0.08, root: { r: [-6, 0, -10], p: [1, -2, 0] }, hand: { at: 'Bolt', off: [-3.4, 0.6, 0.5] }, pose: 'sideR' },
    { t: 0.12, bones: { Bolt: { r: [0, 0, 0] } } },
    { t: 0.18, bones: { Bolt: { r: [0, 0, -60] } }, hand: { at: 'Bolt', off: [-2.6, 3.4, 0.5] }, pose: 'sideR' },
    { t: 0.2, bones: { Bolt: { p: [0, 0, 0] } } },
    { t: 0.27, bones: { Bolt: { p: [0, 0, -8] } }, hand: { at: 'Bolt', off: [-2.6, 3.4, 0.5] }, pose: 'sideR' },
    { t: 0.34, root: { r: [-8, 0, 18], p: [2, -2, 0] }, hand: { at: 'Magazine', off: [1.9, -4, 0.5] } },
    { t: 0.4, bones: { Magazine: { p: [0, 0, 0], r: [0, 0, 0], s: 1 } }, hand: { at: 'Magazine', off: [1.9, -4, 0.5] } },
    { t: 0.47, bones: { Magazine: { p: [3, -28, -3], r: [30, 0, 20], s: 1 } }, hand: [9, -16, -4], pose: 'open' },
    { t: 0.48, bones: { Magazine: { s: 0 } } },
    { t: 0.56, bones: { Magazine: { p: [18, -26, -12], r: [10, 0, 0], s: 0 } }, hand: [20, -28, -12], pose: 'mag' },
    { t: 0.57, bones: { Magazine: { s: 1 } }, hand: { at: 'Magazine', off: [1.9, -4, 0.5] } },
    { t: 0.68, bones: { Magazine: { p: [0, 0, 0], r: [0, 0, 0] } }, hand: { at: 'Magazine', off: [1.9, -5.5, 0.5] } },
    { t: 0.75, root: { r: [-6, 0, -10], p: [1, -2, 0] }, hand: { at: 'Bolt', off: [-2.6, 3.4, 0.5] }, pose: 'sideR' },
    { t: 0.8, bones: { Bolt: { p: [0, 0, -8] } }, hand: { at: 'Bolt', off: [-2.6, 3.4, 0.5] }, pose: 'sideR' },
    { t: 0.85, bones: { Bolt: { p: [0, 0, 0], r: [0, 0, -60] } }, hand: { at: 'Bolt', off: [-2.6, 3.4, 0.5] }, pose: 'sideR' },
    { t: 0.9, bones: { Bolt: { r: [0, 0, 0] } }, hand: { at: 'Bolt', off: [-3.4, 0.6, 0.5] }, pose: 'sideR' },
    { t: 1.0, root: { r: [0, 0, 0], p: [0, 0, 0] }, hand: 'rest' },
  ],

  Pistol: [
    { t: 0.12, root: { r: [-15, 0, 22], p: [1, -1, -2] }, hand: [5, -8, 0] },
    { t: 0.16, bones: { Magazine: { p: [0, 0, 0], s: 1 } } },
    { t: 0.28, bones: { Magazine: { p: [0, -25, -3], r: [25, 0, 10], s: 1 } }, hand: [8, -22, -4] },
    { t: 0.29, bones: { Magazine: { s: 0 } } },
    { t: 0.40, bones: { Magazine: { p: [0, -22, 0], r: [0, 0, 0], s: 0 } }, hand: [6, -24, -2] },
    { t: 0.41, bones: { Magazine: { s: 1 } }, hand: { at: 'Magazine', off: [2, -8.5, 0] } },
    { t: 0.60, bones: { Magazine: { p: [0, -2, 0] } }, hand: { at: 'Magazine', off: [2, -8.5, 0] } },
    { t: 0.66, bones: { Magazine: { p: [0, 0, 0] } }, hand: { at: 'Magazine', off: [2, -7, 0] } },
    { t: 0.74, root: { r: [-8, 0, 8], p: [0, 0, -2] }, hand: { at: 'Slide', off: [0, 3, -9] } },
    { t: 0.80, bones: { Slide: { p: [0, 0, -3.5] } }, hand: { at: 'Slide', off: [0, 3, -9] } },
    { t: 0.83, bones: { Slide: { p: [0, 0, 0] } }, hand: [4, 0, -4] },
    { t: 1.0, root: { r: [0, 0, 0], p: [0, 0, 0] }, hand: 'rest' },
  ],

  Revolver: [
    { t: 0.10, root: { r: [-12, 0, -25], p: [1, -1, -2] }, hand: [4, -2, 8] },
    { t: 0.14, bones: { Cylinder_Frame: { r: [0, 0, 0] } } },
    { t: 0.22, bones: { Cylinder_Frame: { r: [0, 0, -80] } }, hand: [6, 0, 6] },
    { t: 0.28, bones: { Ejector_Rod: { p: [0, 0, 0] } } },
    { t: 0.31, bones: { Ejector_Rod: { p: [0, 0, -3] } }, hand: [5, 0, 12] },
    { t: 0.35, bones: { Ejector_Rod: { p: [0, 0, 0] } } },
    { t: 0.40, hand: [9, -24, -4], nodes: { Reload_Speedloader: { p: [8, -22, -2], s: 0 } } },
    { t: 0.42, nodes: { Reload_Speedloader: { p: [8, -22, -2], s: 1 } }, hand: { at: 'Reload_Speedloader', off: [1, -3, -3] } },
    { t: 0.62, nodes: { Reload_Speedloader: { p: [3.4, -0.1, -2] } }, hand: { at: 'Reload_Speedloader', off: [1, -3, -3] } },
    { t: 0.70, nodes: { Reload_Speedloader: { p: [3.4, -0.1, 2.2], s: 1 } }, hand: { at: 'Reload_Speedloader', off: [1, -3, -3] } },
    { t: 0.72, nodes: { Reload_Speedloader: { s: 0 } }, hand: [6, 0, 6] },
    { t: 0.78, bones: { Cylinder_Frame: { r: [0, 0, -80] } } },
    { t: 0.85, bones: { Cylinder_Frame: { r: [0, 0, 0] } }, hand: [3, -1, 7] },
    { t: 1.0, root: { r: [0, 0, 0], p: [0, 0, 0] }, hand: 'rest' },
  ],

  Shotgun: [
    { t: 0.08, root: { r: [-6, 0, 28], p: [2, -2, 0] }, hand: [8, -18, 4], pose: 'open', nodes: { Reload_Shell: { p: [6, -20, 2], s: 0 } } },
    ...shellCycle(0.12, 0.17),
    ...shellCycle(0.31, 0.17),
    ...shellCycle(0.5, 0.17),
    { t: 0.72, root: { r: [-4, 0, 8], p: [1, -1, 0] }, hand: { at: 'Forend', off: [0.4, -2.8, -4] } },
    { t: 0.8, bones: { Forend: { p: [0, 0, -9] } }, hand: { at: 'Forend', off: [0.4, -2.8, -4] } },
    { t: 0.86, bones: { Forend: { p: [0, 0, 0] } }, hand: { at: 'Forend', off: [0.4, -2.8, -4] } },
    { t: 1.0, root: { r: [0, 0, 0], p: [0, 0, 0] }, hand: 'rest' },
  ],

  RocketLauncher: [
    // 发射筒很长（炮尾在握把后面 63cm），换弹时把它从肩上放下、横到胸前，炮尾转到身体左侧，左手够得到
    { t: 0.14, root: { r: [0, -70, 0], p: [-5, -18, 18] }, hand: { at: 'Breech', off: [3, -2, 4] } },
    { t: 0.20, bones: { Breech: { r: [0, 0, 0] } }, hand: { at: 'Breech', off: [3, -2, 4] } },
    { t: 0.28, bones: { Breech: { r: [0, -100, 0] } }, hand: { at: 'Breech', off: [8, -2, -6] } },
    { t: 0.36, hand: [12, -25, -40], nodes: { Reload_Rocket: { p: [12.6, -27, -43], r: [0, 0, 0], s: 0 } } },
    { t: 0.38, nodes: { Reload_Rocket: { p: [12.6, -27, -43], s: 1 } }, hand: { at: 'Reload_Rocket', off: [2, -5, -10] } },
    { t: 0.56, nodes: { Reload_Rocket: { p: [2, -2, -72] } }, hand: { at: 'Reload_Rocket', off: [2, -5, -10] } },
    { t: 0.70, nodes: { Reload_Rocket: { p: [0, 0, -50], s: 1 } }, hand: { at: 'Reload_Rocket', off: [2, -5, -10] } },
    { t: 0.71, nodes: { Reload_Rocket: { s: 0 } } },
    { t: 0.76, bones: { Breech: { r: [0, -100, 0] } }, hand: { at: 'Breech', off: [8, -2, -6] } },
    { t: 0.84, bones: { Breech: { r: [0, 0, 0] } }, hand: { at: 'Breech', off: [3, -2, 4] } },
    { t: 0.88, root: { r: [0, -70, 0], p: [-5, -18, 18] } },
    { t: 1.0, root: { r: [0, 0, 0], p: [0, 0, 0] }, hand: 'rest' },
  ],
};
