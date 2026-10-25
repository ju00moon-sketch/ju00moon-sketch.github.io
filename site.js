const motionButton = document.querySelector('#motion-toggle');
const motionPair = document.querySelector('#motion-pair');
const motionState = document.querySelector('#motion-state');
const motionImages = [...document.querySelectorAll('[data-animation]')];
let mode = 'paused';
let generation = 0;

function pauseMotion(message = '정지 화면입니다. 재생하면 각 자료의 본래 시간대로 움직입니다.') {
  generation += 1;
  mode = 'paused';
  motionImages.forEach(image => { image.src = image.dataset.still; });
  motionButton.textContent = '비교 재생';
  motionButton.setAttribute('aria-pressed', 'false');
  motionPair.setAttribute('aria-busy', 'false');
  motionState.textContent = message;
}

async function playMotion() {
  const current = ++generation;
  mode = 'loading';
  motionButton.textContent = '재생 준비 취소';
  motionButton.setAttribute('aria-pressed', 'true');
  motionPair.setAttribute('aria-busy', 'true');
  motionState.textContent = '재생 자료를 불러오는 중입니다. 버튼을 다시 누르면 취소합니다.';
  motionImages.forEach(image => { image.src = image.dataset.animation; });
  try {
    await Promise.all(motionImages.map(image => image.decode()));
  } catch {
    if (current === generation) {
      pauseMotion('재생 자료를 불러오지 못했습니다. 다시 재생하거나 아래 원본 파일을 확인해 주세요.');
    }
    return;
  }
  if (current !== generation) return;
  mode = 'playing';
  motionButton.textContent = '재생 정지';
  motionPair.setAttribute('aria-busy', 'false');
  motionState.textContent = '본래 시간대로 반복 재생 중입니다. 재연결 검수 5.5초 · 도트 1.6초 · 기존 3D 약 1.033초. 새 기록은 좌표 오류 수정본이며 완성된 걷기 루프가 아닙니다.';
}

motionButton.addEventListener('click', () => {
  if (mode === 'paused') playMotion();
  else pauseMotion();
});
motionButton.hidden = false;

document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode !== 'paused') pauseMotion('화면을 벗어나 재생을 멈췄습니다. 다시 재생할 수 있습니다.');
});

document.querySelectorAll('figure img').forEach(image => {
  const figure = image.closest('figure');
  const message = figure.querySelector('.image-error');
  const loading = figure.querySelector('.image-loading');
  image.addEventListener('error', () => {
    message.hidden = false;
    if (loading) loading.hidden = true;
  });
  image.addEventListener('load', () => {
    message.hidden = true;
    if (loading) loading.hidden = true;
  });
  if (loading) loading.hidden = image.complete;
  if (image.complete && !image.naturalWidth) message.hidden = false;
});
