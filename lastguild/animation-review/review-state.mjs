// 사용자 프레임 검수 화면의 검수안 상태·시간축·저장 형식입니다(T222 티켓 2026-10-26 사용자 프레임 검수 계약).
// 원본을 고치는 편집기가 아니라 사용자 검수안을 다룹니다. 검토 완료(complete)는 모델 품질 통과가 아닙니다.
// 브라우저와 Node가 함께 쓰는 독립 ES 모듈이며 DOM·localStorage·파일·네트워크를 직접 부르지 않습니다.
// 입력(clip·review·reviewMap·timeline)은 바꾸지 않고 모든 반환 값은 새 객체입니다.
// 오류는 code 속성이 있는 Error로 던집니다: invalid_clip, invalid_review, invalid_timeline, invalid_json, invalid_schema,
// unknown_clip, revision_mismatch, sample_count. 화면 글은 code로 따로 연결합니다.

const SCHEMA = 1;
const REVIEW_KEYS = ['revision', 'keep', 'holds', 'speed', 'timing', 'note', 'complete'];
const TIMINGS = ['compress', 'preserve'];
const MAX_HOLD = 3600;
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;
const MAX_NOTE = 8000;

// 기본 검수안입니다. 전부 남김, 표본마다 클립의 원래 유지 틱, 배속 1, compress, 빈 메모, 미완료입니다.
// 원래 유지 틱은 클립의 holds이며, holds가 없는 클립은 끝이 아닌 표본 1틱·끝 표본 0틱입니다.
// 이 검수안의 시간축이 원본 시간축이며(첫 표본 0초부터 duration초), 화면은 원본 재생에 이 시간축을 따로 씁니다.
export function createReview(clip) {
  const info = requireClip(clip);
  const holds = info.base.slice();
  return {
    revision: info.revision,
    keep: new Array(info.count).fill(true),
    holds,
    speed: 1,
    timing: 'compress',
    note: '',
    complete: false,
  };
}

// 검수안 하나를 그 클립 기준으로 검사합니다. 반환은 { ok, errors }이며 errors는 항목별 첫 문제 설명입니다.
// 클립 자체가 계약 형태가 아니면 code invalid_clip을 던집니다.
export function validateReview(clip, value) {
  const errors = reviewErrors(requireClip(clip), value);
  return { ok: errors.length === 0, errors };
}

// 검수안의 재생 시간축입니다. 시간 단위는 배속 적용 전 초이며 화면이 원본과 검수안 재생 시계에 같은 speed를 적용합니다.
// segments는 남긴 표본마다 하나씩 frames 순서이고, 각 구간은 [start, end)입니다. 끝 표본 0틱은 start === end인 구간입니다.
// compress는 남긴 표본의 틱만 잇습니다. preserve는 제외한 표본의 원래 유지 틱(클립 holds, 없으면 끝이 아닌 표본 1틱·끝 표본 0틱)을
// 직전에 남긴 표본에, 첫 남긴 표본 앞의 제외 구간은 그 첫 표본에 더합니다. 제외한 표본의 수정 holds는 쓰지 않습니다.
// 전부 제외하면 { segments: [], duration: 0, finalFrame: null }입니다. 잘못된 검수안은 code invalid_review를 던집니다.
export function buildTimeline(clip, review) {
  const info = requireClip(clip);
  const errors = reviewErrors(info, review);
  if (errors.length > 0) {
    throw stateError('invalid_review', `검수안이 클립과 맞지 않습니다: ${errors.join(' ')}`);
  }
  const preserve = review.timing === 'preserve';
  const ticks = [];
  let total = 0;
  let leading = 0;
  for (let index = 0; index < info.count; index += 1) {
    const original = info.base[index];
    if (review.keep[index]) {
      const length = review.holds[index] + (ticks.length === 0 ? leading : 0);
      ticks.push({ frame: info.frames[index], start: total, end: total + length });
      total += length;
    } else if (preserve) {
      if (ticks.length === 0) {
        leading += original;
      } else {
        ticks[ticks.length - 1].end += original;
        total += original;
      }
    }
  }
  // 정수 틱을 마지막에 한 번만 초로 바꿔 구간 경계가 누적 오차 없이 서로 같은 값이 되게 합니다.
  return {
    segments: ticks.map((item) => ({ frame: item.frame, start: item.start / info.fps, end: item.end / info.fps })),
    duration: total / info.fps,
    finalFrame: ticks.length > 0 ? ticks[ticks.length - 1].frame : null,
  };
}

// 시간축의 한 시각에 보일 표본 frame 번호입니다. 구간 경계 시각은 다음 구간, duration 이상은 finalFrame입니다.
// 음수 시각은 첫 구간입니다. segments가 비면 null입니다. seconds가 숫자가 아니거나 NaN이면 code invalid_timeline을 던집니다.
export function sampleTimeline(timeline, seconds) {
  if (!isPlainObject(timeline) || !Array.isArray(timeline.segments) || typeof timeline.duration !== 'number'
    || Number.isNaN(timeline.duration)) {
    throw stateError('invalid_timeline', 'timeline은 { segments, duration, finalFrame } 형태여야 합니다.');
  }
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) {
    throw stateError('invalid_timeline', 'seconds는 숫자여야 합니다.');
  }
  const segments = timeline.segments;
  if (segments.length === 0) {
    return null;
  }
  if (seconds >= timeline.duration) {
    return timeline.finalFrame;
  }
  const time = Math.max(seconds, 0);
  // start ≤ time인 마지막 구간입니다. 구간은 시작 순서로 붙어 있고 길이 0 구간은 끝 표본(start === duration)뿐입니다.
  let low = 0;
  let high = segments.length - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (segments[middle].start <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return segments[found].frame;
}

// 저장 문서 { schema: 1, clips: { [id]: review } }의 JSON 문자열입니다. reviewMap은 일반 객체 또는 Map입니다.
// 클립 순서대로 reviewMap에 있는 검수안만 쓰고, 알 수 없는 id나 잘못된 검수안이 하나라도 있으면 던지고 아무것도 만들지 않습니다.
export function serializeReviews(clips, reviewMap) {
  const catalog = requireCatalog(clips);
  const entries = mapEntries(reviewMap);
  for (const id of entries.keys()) {
    if (!catalog.has(id)) {
      throw stateError('unknown_clip', `알 수 없는 클립의 검수안입니다: ${id}`);
    }
  }
  const saved = [];
  for (const [id, info] of catalog) {
    if (!entries.has(id)) {
      continue;
    }
    const review = entries.get(id);
    const errors = reviewErrors(info, review);
    if (errors.length > 0) {
      throw stateError('invalid_review', `${id}: ${errors.join(' ')}`);
    }
    saved.push([id, copyReview(review)]);
  }
  return JSON.stringify({ schema: SCHEMA, clips: Object.fromEntries(saved) });
}

// 저장 문서를 읽어 검증된 reviewMap(일반 객체)을 돌려줍니다. 알려진 클립 id·같은 revision·정확한 표본 수의 검수안만 받으며,
// 하나라도 맞지 않으면 던지고 결과를 돌려주지 않습니다. 그래서 화면은 실패한 파일을 기존 초안에 부분 반영할 수 없습니다.
export function parseReviews(clips, text) {
  const catalog = requireCatalog(clips);
  if (typeof text !== 'string') {
    throw stateError('invalid_json', '검수 저장 내용은 문자열이어야 합니다.');
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw stateError('invalid_json', '검수 저장 파일이 올바른 JSON이 아닙니다.');
  }
  if (!isPlainObject(document) || !exactKeys(document, ['schema', 'clips']) || document.schema !== SCHEMA
    || !isPlainObject(document.clips)) {
    throw stateError('invalid_schema', '검수 저장 파일은 { schema: 1, clips: { [id]: review } } 형식이어야 합니다.');
  }
  const loaded = [];
  for (const id of Object.keys(document.clips)) {
    const info = catalog.get(id);
    if (info === undefined) {
      throw stateError('unknown_clip', `알 수 없는 클립의 검수안입니다: ${id}`);
    }
    const review = document.clips[id];
    if (isPlainObject(review) && review.revision !== info.revision) {
      throw stateError('revision_mismatch', `${id}: 검수안 revision이 현재 클립과 다릅니다.`);
    }
    if (isPlainObject(review) && Array.isArray(review.keep) && Array.isArray(review.holds)
      && (review.keep.length !== info.count || review.holds.length !== info.count)) {
      throw stateError('sample_count', `${id}: 검수안 표본 수가 현재 클립의 ${info.count}개와 다릅니다.`);
    }
    const errors = reviewErrors(info, review);
    if (errors.length > 0) {
      throw stateError('invalid_review', `${id}: ${errors.join(' ')}`);
    }
    loaded.push([id, copyReview(review)]);
  }
  return Object.fromEntries(loaded);
}

// 클립에서 이 모듈이 쓰는 값만 검사해 꺼냅니다. frames는 first부터 last까지 빠짐없는 연속 frame입니다.
// holds가 없으면 duration은 (last - first) / fps입니다(새 릴리 60fps·0~330·331표본·5.5초).
// holds(선택)는 표본별 원래 유지 틱(각각 1 이상의 정수)이며 duration은 holds 합 / fps입니다. 도트처럼 프레임마다 정해진 시간을 두고 끝 표본도 보여야 할 때 씁니다.
function requireClip(clip) {
  const problem = clipProblem(clip);
  if (problem !== '') {
    throw stateError('invalid_clip', problem);
  }
  const count = clip.frames.length;
  return {
    id: clip.id,
    revision: clip.revision,
    fps: clip.fps,
    count,
    frames: clip.frames.map((item) => item.frame),
    base: clip.holds === undefined
      ? Array.from({ length: count }, (_, index) => (index === count - 1 ? 0 : 1))
      : clip.holds.slice(),
  };
}

function clipProblem(clip) {
  if (!isPlainObject(clip)) {
    return '클립이 객체가 아닙니다.';
  }
  if (typeof clip.id !== 'string' || clip.id === '' || typeof clip.revision !== 'string' || clip.revision === '') {
    return '클립 id·revision은 빈 문자열이 아닌 문자열이어야 합니다.';
  }
  if (!Number.isInteger(clip.fps) || clip.fps < 1) {
    return `${clip.id}: fps는 1 이상의 정수여야 합니다.`;
  }
  if (!Number.isInteger(clip.first) || !Number.isInteger(clip.last) || clip.last < clip.first) {
    return `${clip.id}: first·last는 first ≤ last인 정수여야 합니다.`;
  }
  if (!Array.isArray(clip.frames) || clip.frames.length !== clip.last - clip.first + 1) {
    return `${clip.id}: frames 수가 first~last 표본 수와 다릅니다.`;
  }
  for (let index = 0; index < clip.frames.length; index += 1) {
    const item = clip.frames[index];
    if (!isPlainObject(item) || item.frame !== clip.first + index) {
      return `${clip.id}: frames[${index}]가 연속 frame ${clip.first + index}이 아닙니다.`;
    }
  }
  if (clip.holds !== undefined) {
    if (!Array.isArray(clip.holds) || clip.holds.length !== clip.frames.length) {
      return `${clip.id}: holds는 표본 수와 같은 길이의 배열이어야 합니다.`;
    }
    for (let index = 0; index < clip.holds.length; index += 1) {
      const hold = clip.holds[index];
      if (!Number.isInteger(hold) || hold < 1 || hold > MAX_HOLD) {
        return `${clip.id}: holds[${index}]는 1~${MAX_HOLD} 정수 틱이어야 합니다.`;
      }
    }
    const ticks = clip.holds.reduce((sum, hold) => sum + hold, 0);
    if (typeof clip.duration !== 'number' || !Number.isFinite(clip.duration)
      || Math.abs(clip.duration - ticks / clip.fps) > 1e-9) {
      return `${clip.id}: duration이 holds 합 / fps와 다릅니다.`;
    }
    return '';
  }
  if (typeof clip.duration !== 'number' || !Number.isFinite(clip.duration)
    || Math.abs(clip.duration - (clip.last - clip.first) / clip.fps) > 1e-9) {
    return `${clip.id}: duration이 (last - first) / fps와 다릅니다.`;
  }
  return '';
}

function requireCatalog(clips) {
  if (!Array.isArray(clips)) {
    throw stateError('invalid_clip', 'clips는 클립 배열이어야 합니다.');
  }
  const catalog = new Map();
  for (const clip of clips) {
    const info = requireClip(clip);
    if (catalog.has(info.id)) {
      throw stateError('invalid_clip', `같은 클립 id가 두 번 있습니다: ${info.id}`);
    }
    catalog.set(info.id, info);
  }
  return catalog;
}

function mapEntries(reviewMap) {
  if (reviewMap instanceof Map) {
    return new Map(reviewMap);
  }
  if (!isPlainObject(reviewMap)) {
    throw stateError('invalid_review', 'reviewMap은 일반 객체 또는 Map이어야 합니다.');
  }
  return new Map(Object.keys(reviewMap).map((id) => [id, reviewMap[id]]));
}

// 항목별 첫 문제 설명 목록입니다. 빈 배열이면 통과입니다.
function reviewErrors(info, value) {
  if (!isPlainObject(value)) {
    return ['검수안이 객체가 아닙니다.'];
  }
  const errors = [];
  if (!exactKeys(value, REVIEW_KEYS)) {
    errors.push(`검수안 항목은 ${REVIEW_KEYS.join('·')} 일곱 개여야 합니다.`);
  }
  if (value.revision !== info.revision) {
    errors.push('검수안 revision이 클립과 다릅니다.');
  }
  if (!Array.isArray(value.keep) || value.keep.length !== info.count) {
    errors.push(`keep은 표본 수 ${info.count}개의 배열이어야 합니다.`);
  } else {
    for (let index = 0; index < info.count; index += 1) {
      if (typeof value.keep[index] !== 'boolean') {
        errors.push(`keep[${index}]는 참거짓이어야 합니다.`);
        break;
      }
    }
  }
  if (!Array.isArray(value.holds) || value.holds.length !== info.count) {
    errors.push(`holds는 표본 수 ${info.count}개의 배열이어야 합니다.`);
  } else {
    for (let index = 0; index < info.count; index += 1) {
      const hold = value.holds[index];
      const minimum = index === info.count - 1 ? 0 : 1;
      if (!Number.isInteger(hold) || hold < minimum || hold > MAX_HOLD) {
        errors.push(`holds[${index}]는 ${minimum}~${MAX_HOLD} 정수 틱이어야 합니다.`);
        break;
      }
    }
  }
  if (typeof value.speed !== 'number' || !Number.isFinite(value.speed) || value.speed < MIN_SPEED || value.speed > MAX_SPEED) {
    errors.push(`speed는 ${MIN_SPEED}~${MAX_SPEED} 숫자여야 합니다.`);
  }
  if (!TIMINGS.includes(value.timing)) {
    errors.push('timing은 compress 또는 preserve여야 합니다.');
  }
  if (typeof value.note !== 'string' || characters(value.note) > MAX_NOTE) {
    errors.push(`note는 ${MAX_NOTE}자 이하 문자열이어야 합니다.`);
  }
  if (typeof value.complete !== 'boolean') {
    errors.push('complete는 참거짓이어야 합니다.');
  }
  return errors;
}

function copyReview(review) {
  return {
    revision: review.revision,
    keep: review.keep.slice(),
    holds: review.holds.slice(),
    speed: review.speed,
    timing: review.timing,
    note: review.note,
    complete: review.complete,
  };
}

// 메모 글자 수는 유니코드 코드 포인트 수입니다(UTF-16 대리 쌍 하나를 한 글자로 셈).
function characters(text) {
  let count = 0;
  for (const _character of text) {
    count += 1;
    if (count > MAX_NOTE) {
      break;
    }
  }
  return count;
}

function exactKeys(value, keys) {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stateError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
