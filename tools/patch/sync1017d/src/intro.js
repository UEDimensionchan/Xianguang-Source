// 启动动画：全屏播放 Asset/UI/intro.mp4，播完停在最后一帧（片尾自带“点击任意位置继续”），
// 点鼠标左键淡出进入大厅。播放中按 Esc 直接跳到片尾；浏览器不让带声音自动播放时先静音播放，点一下打开声音。
export function playIntro(src = 'Asset/UI/intro.mp4') {
  return new Promise((resolve) => {
    // index.html 里已经放好并开始播了；没有的话现建一个
    let el = document.getElementById('intro');
    const fresh = !el;
    if (fresh) {
      el = document.createElement('section');
      el.id = 'intro';
      el.innerHTML = `<video playsinline preload="auto"></video><div class="intro-tip">点击开启声音</div>`;
      document.body.appendChild(el);
      el.querySelector('video').src = src;
    }
    const v = el.querySelector('video'), tip = el.querySelector('.intro-tip');
    let ended = false, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.classList.add('out');
      window.removeEventListener('keydown', onKey, true);
      setTimeout(() => { el.remove(); }, 700);
      resolve();
    };
    const toEnd = () => { if (ended) return; ended = true; el.classList.add('ended'); tip.classList.remove('on'); if (v.duration) v.currentTime = Math.max(0, v.duration - 0.05); v.pause(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); toEnd(); }
      else if (ended && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); finish(); }
    };
    window.addEventListener('keydown', onKey, true);
    v.addEventListener('ended', () => { ended = true; el.classList.add('ended'); tip.classList.remove('on'); });
    // 视频加载不了（所有格式都失败）就直接进大厅
    v.addEventListener('error', finish);
    const srcs = v.querySelectorAll('source');
    if (srcs.length) srcs[srcs.length - 1].addEventListener('error', finish);
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (ended) return finish();
      if (v.muted) { v.muted = false; tip.classList.remove('on'); } // 播放中点一下：打开声音
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    if (v.ended) { ended = true; el.classList.add('ended'); }
    else if (fresh || v.paused) v.play().catch(() => { v.muted = true; tip.classList.add('on'); v.play().catch(finish); });
  });
}
