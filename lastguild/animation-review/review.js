import { createReview, validateReview, buildTimeline, sampleTimeline, serializeReviews, parseReviews } from './review-state.mjs';

const $ = id => document.getElementById(id);
const storageKey = 'lastguild-animation-review-v1';
let clips = [], reviews = {}, clip, originalTimeline, editedTimeline;
let currentTime = 0, activeFrame = 0, anchorFrame = 0, playing = false, lastTick = 0;
let frameMap = new Map(), cards = new Map(), histories = new Map();
const images = new Map();
const drawState = { original: { key: null, token: 0 }, edited: { key: null, token: 0 } };

function error(message) { $('alert').textContent = message; $('alert').hidden = !message; }
function state() { return reviews[clip.id]; }
function seconds(value) { return `${value.toFixed(3)}초`; }
function totalDuration() { return Math.max(originalTimeline.duration, editedTimeline.duration); }
function save() {
  try { localStorage.setItem(storageKey, serializeReviews(clips, reviews)); $('save-status').textContent = '이 브라우저에 임시 저장됨'; }
  catch { $('save-status').textContent = '브라우저 저장 실패. 검수안 파일을 저장해 주세요.'; }
}
function stop() { playing = false; $('play').textContent = '비교 재생'; }
function remember() {
  const history = histories.get(clip.id) || [];
  history.push(structuredClone(state()));
  if (history.length > 60) history.shift();
  histories.set(clip.id, history);
}
function commit(change) {
  stop();
  try {
    const draft = structuredClone(state()); change(draft);
    const checked = validateReview(clip, draft);
    if (!checked.ok) throw new Error(checked.errors.join(' '));
    remember(); reviews[clip.id] = draft;
    error(''); update(); save();
  } catch (failure) { error(failure.message); }
}
function loadImage(url) {
  if (images.has(url)) return images.get(url);
  const promise = new Promise((resolve, reject) => {
    const image = new Image(); image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('프레임 이미지를 불러오지 못했습니다.'));
    image.src = url;
  });
  images.set(url, promise);
  // 원본 프레임 전체를 디코딩한 채 쌓아 두지 않는다.
  while (images.size > 48) images.delete(images.keys().next().value);
  return promise;
}
function draw(view, frame) {
  const canvas = $(view), context = canvas.getContext('2d'), progress = drawState[view];
  const key = `${clip.id}:${frame}`;
  if (progress.key === key) return;
  progress.key = key;
  const token = ++progress.token;
  const notice = $(`${view}-error`);
  if (frame === null || frame === undefined) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    notice.textContent = '남긴 프레임이 없습니다.'; notice.hidden = false;
    $(`${view}-frame`).textContent = '프레임을 남기면 검수안을 비교할 수 있습니다.'; return;
  }
  const row = frameMap.get(frame);
  if (!row) { error('자료의 프레임 번호를 찾을 수 없습니다.'); return; }
  notice.textContent = '프레임을 불러오는 중입니다.'; notice.hidden = false;
  loadImage(row.image).then(image => {
    if (token !== progress.token) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const zoom = Number($('zoom').value);
    context.drawImage(image, canvas.width * (1 - zoom) / 2, canvas.height * (1 - zoom) / 2,
      canvas.width * zoom, canvas.height * zoom);
    notice.hidden = true;
    $(`${view}-frame`).textContent = `원본 #${frame} · ${seconds(row.time)}`;
  }).catch(failure => {
    if (token !== progress.token) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    notice.textContent = `${failure.message} #${frame}`; notice.hidden = false;
    $('retry-images').hidden = false; stop();
  });
}
function paint() {
  const sourceFrame = sampleTimeline(originalTimeline, currentTime);
  const selectedFrame = sampleTimeline(editedTimeline, currentTime);
  cards.get(activeFrame)?.classList.remove('current');
  activeFrame = sourceFrame ?? clip.first;
  cards.get(activeFrame)?.classList.add('current');
  draw('original', sourceFrame); draw('edited', selectedFrame);
  $('seek').value = currentTime;
  $('time').textContent = `${seconds(currentTime)} / ${seconds(totalDuration())}`;
  $('toggle-current').textContent = state().keep[clip.frames.findIndex(row => row.frame === activeFrame)] ? '현재 프레임 제외' : '현재 프레임 남김';
}
function prefetch() {
  const index = clip.frames.findIndex(row => row.frame === activeFrame);
  for (let offset = 1; offset <= 8; offset++) {
    const row = clip.frames[index + offset];
    if (row) loadImage(row.image).catch(() => {});
  }
}
function tick(now) {
  if (playing) {
    currentTime += (now - lastTick) / 1000 * state().speed;
    const duration = totalDuration();
    if (currentTime >= duration) {
      if ($('loop').checked && duration > 0) currentTime %= duration;
      else { currentTime = duration; stop(); }
    }
    paint(); prefetch();
  }
  lastTick = now;
  requestAnimationFrame(tick);
}
function play() {
  if (playing) { stop(); return; }
  if (totalDuration() <= 0) return;
  if (currentTime >= totalDuration()) currentTime = 0;
  playing = true; lastTick = performance.now(); $('play').textContent = '일시정지';
  prefetch();
}
function showFrame(frame) {
  stop(); const row = frameMap.get(frame);
  if (!row) return;
  currentTime = row.time; paint();
}
function step(delta) {
  const index = clip.frames.findIndex(row => row.frame === activeFrame);
  showFrame(clip.frames[Math.max(0, Math.min(clip.frames.length - 1, index + delta))].frame);
}
function range() {
  const start = Number($('range-start').value), end = Number($('range-end').value);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || !frameMap.has(start) || !frameMap.has(end)) throw new Error('시작과 끝을 실제 프레임 번호로 지정해 주세요.');
  return clip.frames.map((row, index) => ({ row, index })).filter(({ row }) => row.frame >= start && row.frame <= end).map(({ index }) => index);
}
function rangeEdit(change) {
  try { const indexes = range(); commit(draft => change(draft, indexes)); }
  catch (failure) { error(failure.message); }
}
function markRange() {
  const start = Number($('range-start').value), end = Number($('range-end').value);
  for (const [frame, card] of cards) card.classList.toggle('in-range', frame >= start && frame <= end);
}
function renderClips() {
  const search = $('search').value.trim().toLocaleLowerCase();
  const rows = clips.filter(row => `${row.title} ${row.character}`.toLocaleLowerCase().includes(search));
  $('clip-count').textContent = `${clips.length}개 동작 · ${clips.filter(row => reviews[row.id]?.complete).length}개 검토 완료`;
  $('clips').replaceChildren();
  for (const row of rows) {
    const button = document.createElement('button'); button.className = 'clip-button';
    button.setAttribute('aria-current', String(row.id === clip?.id));
    button.append(document.createTextNode(row.title));
    const detail = document.createElement('span');
    detail.textContent = `${row.character} · ${row.frames.length}표본 · ${reviews[row.id]?.complete ? '검토 완료' : '검토 전'}`;
    button.append(detail); button.addEventListener('click', () => selectClip(row.id));
    $('clips').append(button);
  }
  if (!rows.length) { const empty = document.createElement('p'); empty.textContent = '검색에 맞는 동작이 없습니다.'; $('clips').append(empty); }
}
function renderFrames() {
  cards = new Map(); const fragment = document.createDocumentFragment();
  clip.frames.forEach((row, index) => {
    const card = document.createElement('article'); card.className = 'frame-card';
    const button = document.createElement('button'); button.className = 'frame-image'; button.setAttribute('aria-label', `원본 ${row.frame}번 프레임 보기`);
    const image = document.createElement('img'); image.src = row.thumbnail; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.width = 160; image.height = 160;
    image.addEventListener('error', () => { button.title = '썸네일을 불러오지 못했습니다. 누르면 원본을 확인합니다.'; });
    button.append(image); button.addEventListener('click', event => {
      if (event.shiftKey) { $('range-start').value = Math.min(anchorFrame, row.frame); $('range-end').value = Math.max(anchorFrame, row.frame); }
      else { anchorFrame = row.frame; $('range-start').value = row.frame; $('range-end').value = row.frame; }
      markRange(); showFrame(row.frame);
    });
    const label = document.createElement('label'); label.className = 'check';
    const keep = document.createElement('input'); keep.type = 'checkbox'; keep.dataset.keep = index; keep.setAttribute('aria-label', `${row.frame}번 프레임 남김`);
    keep.addEventListener('change', () => commit(draft => { draft.keep[index] = keep.checked; }));
    label.append(keep, document.createTextNode(`#${row.frame}`));
    const holdLabel = document.createElement('label'); holdLabel.className = 'hold-label'; holdLabel.append(document.createTextNode('유지'));
    const hold = document.createElement('input'); hold.type = 'number'; hold.step = 1; hold.min = index === clip.frames.length - 1 ? 0 : 1; hold.max = 3600; hold.dataset.hold = index; hold.setAttribute('aria-label', `${row.frame}번 유지 틱`);
    hold.addEventListener('change', () => { commit(draft => { draft.holds[index] = Number(hold.value); }); hold.value = state().holds[index]; });
    holdLabel.append(hold); card.append(button, label, holdLabel); cards.set(row.frame, card); fragment.append(card);
  });
  $('frames').replaceChildren(fragment);
}
function update() {
  const draft = state(); editedTimeline = buildTimeline(clip, draft);
  currentTime = Math.min(currentTime, totalDuration());
  $('speed').value = draft.speed; $('timing').value = draft.timing;
  $('note').value = draft.note; $('complete').checked = draft.complete;
  $('undo').disabled = !(histories.get(clip.id)?.length);
  const kept = draft.keep.filter(Boolean).length;
  $('edited-count').textContent = `${kept}표본 · ${seconds(editedTimeline.duration)}`;
  $('selection-status').textContent = `${kept}개 남김 · ${clip.frames.length - kept}개 제외`;
  $('seek').max = totalDuration(); $('play').disabled = totalDuration() <= 0;
  clip.frames.forEach((row, index) => {
    const card = cards.get(row.frame); card.classList.toggle('excluded', !draft.keep[index]);
    card.querySelector('[data-keep]').checked = draft.keep[index]; card.querySelector('[data-hold]').value = draft.holds[index];
  });
  drawState.original.key = null; drawState.edited.key = null;
  markRange(); renderClips(); paint();
}
function selectClip(id) {
  stop(); clip = clips.find(row => row.id === id); frameMap = new Map(clip.frames.map(row => [row.frame, row]));
  reviews[id] ||= createReview(clip);
  originalTimeline = buildTimeline(clip, createReview(clip));
  activeFrame = clip.first; anchorFrame = clip.first; currentTime = 0; images.clear();
  for (const view of ['original', 'edited']) { $(view).width = clip.width; $(view).height = clip.height; drawState[view].token++; drawState[view].key = null; }
  $('clip-title').textContent = clip.title;
  $('clip-facts').textContent = `${clip.character} · 원본 ${clip.fps}fps · ${clip.first}~${clip.last}번 · ${clip.frames.length}표본 · ${seconds(clip.duration)}`;
  $('clip-status').textContent = `${clip.status}${clip.notes ? ' · ' + clip.notes : ''}`;
  $('original-count').textContent = `${clip.frames.length}표본 · ${seconds(clip.duration)}`;
  $('timing-help').textContent = `유지 1틱 = 1/${clip.fps}초입니다. 끝 표본의 기본값은 0틱이며 원본 재생은 ${seconds(clip.duration)}에 끝 표본을 표시하고 멈춥니다. 추가 유지 시간은 검수안에만 적용합니다.`;
  for (const id of ['range-start', 'range-end']) { $(id).min = clip.first; $(id).max = clip.last; }
  $('range-start').value = clip.first; $('range-end').value = clip.last; $('interval').max = clip.frames.length;
  renderFrames(); update();
}
$('play').addEventListener('click', play);
$('previous').addEventListener('click', () => step(-1)); $('next').addEventListener('click', () => step(1));
$('seek').addEventListener('input', () => { stop(); currentTime = Number($('seek').value); paint(); });
$('speed').addEventListener('change', () => commit(draft => { draft.speed = Number($('speed').value); }));
$('timing').addEventListener('change', () => commit(draft => { draft.timing = $('timing').value; }));
$('keep-all').addEventListener('click', () => commit(draft => draft.keep.fill(true)));
$('remove-all').addEventListener('click', () => commit(draft => draft.keep.fill(false)));
$('invert').addEventListener('click', () => commit(draft => { draft.keep = draft.keep.map(value => !value); }));
$('toggle-current').addEventListener('click', () => commit(draft => { const index = clip.frames.findIndex(row => row.frame === activeFrame); draft.keep[index] = !draft.keep[index]; }));
$('keep-range').addEventListener('click', () => rangeEdit((draft, indexes) => indexes.forEach(index => { draft.keep[index] = true; })));
$('remove-range').addEventListener('click', () => rangeEdit((draft, indexes) => indexes.forEach(index => { draft.keep[index] = false; })));
$('keep-interval').addEventListener('click', () => rangeEdit((draft, indexes) => {
  const every = Number($('interval').value);
  if (!Number.isInteger(every) || every < 1 || every > clip.frames.length) throw new Error('간격은 1 이상, 전체 표본 수 이하의 정수로 지정해 주세요.');
  indexes.forEach((index, position) => { draft.keep[index] = position % every === 0; });
}));
$('apply-hold').addEventListener('click', () => rangeEdit((draft, indexes) => { const value = Number($('hold').value); indexes.forEach(index => { if (draft.keep[index]) draft.holds[index] = value; }); }));
$('reset-hold').addEventListener('click', () => rangeEdit((draft, indexes) => { const original = createReview(clip); indexes.forEach(index => { draft.holds[index] = original.holds[index]; }); }));
$('range-start').addEventListener('input', markRange); $('range-end').addEventListener('input', markRange);
$('undo').addEventListener('click', () => { stop(); const previous = histories.get(clip.id)?.pop(); if (previous) { reviews[clip.id] = previous; error(''); update(); save(); } });
$('note').addEventListener('input', () => commit(draft => { draft.note = $('note').value; }));
$('complete').addEventListener('change', () => commit(draft => { draft.complete = $('complete').checked; }));
$('search').addEventListener('input', renderClips);
$('retry-images').addEventListener('click', () => { images.clear(); drawState.original.key = null; drawState.edited.key = null; $('retry-images').hidden = true; paint(); });
$('zoom').addEventListener('change', () => { drawState.original.key = null; drawState.edited.key = null; paint(); });
$('export').addEventListener('click', () => {
  const text = serializeReviews(clips, reviews), link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  link.href = url; link.download = `lastguild-animation-review-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('save-status').textContent = '검수안 파일 저장을 요청했습니다. 다운로드 목록을 확인해 주세요.';
});
$('import').addEventListener('click', () => { $('file').value = ''; $('file').click(); });
$('file').addEventListener('change', async () => {
  const file = $('file').files[0]; if (!file) return;
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error('검수안 파일이 너무 큽니다. 4MB 이하 JSON을 선택해 주세요.');
    const imported = parseReviews(clips, await file.text());
    if (!window.confirm('현재 검수안을 파일 내용으로 바꿀까요? 원본 동작은 바뀌지 않습니다.')) return;
    for (const row of clips) {
      if (!Object.hasOwn(imported, row.id)) continue;
      const history = histories.get(row.id) || []; history.push(structuredClone(reviews[row.id])); histories.set(row.id, history.slice(-60));
    }
    reviews = { ...reviews, ...imported }; error(''); selectClip(clip.id); save();
  } catch (failure) { error(`파일을 반영하지 않았습니다. ${failure.message}`); }
});
document.addEventListener('keydown', event => {
  if (!clip || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,select,textarea')) return;
  if (event.code === 'Space' && !event.target.closest('button,a')) { event.preventDefault(); play(); }
  if (event.code === 'ArrowLeft') { event.preventDefault(); step(-1); }
  if (event.code === 'ArrowRight') { event.preventDefault(); step(1); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
async function start() {
  try {
    const response = await fetch('clips.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`동작 목록 응답 오류 (${response.status})`);
    const manifest = await response.json();
    if (manifest.schema !== 1 || !Array.isArray(manifest.clips) || !manifest.clips.length) throw new Error('실제 검수할 동작이 아직 등록되지 않았습니다.');
    clips = manifest.clips;
    if (new Set(clips.map(row => row.id)).size !== clips.length) throw new Error('중복된 동작 식별자가 있습니다.');
    for (const row of clips) {
      reviews[row.id] = createReview(row);
      for (const frame of row.frames) for (const field of ['image', 'thumbnail']) {
        const url = new URL(frame[field], location.href);
        if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('동작 이미지 주소가 같은 사이트의 자료가 아닙니다.');
      }
    }
    try { const saved = localStorage.getItem(storageKey); if (saved) reviews = { ...reviews, ...parseReviews(clips, saved) }; }
    catch (failure) { error(`기존 임시 검수안을 자동으로 덮어쓰지 않았습니다. ${failure.message}`); }
    $('loading').hidden = true; $('app').hidden = false; $('export').disabled = false; $('import').disabled = false;
    $('save-status').textContent = '검수안은 이 브라우저에 임시 저장됩니다.';
    selectClip(clips[0].id); requestAnimationFrame(tick);
  } catch (failure) { $('loading').hidden = true; error(`${failure.message} 새로 고침으로 다시 불러올 수 있습니다.`); }
}
start();
