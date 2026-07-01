const STORAGE_KEY = 'paperQuestState.v10';
const SERVER_STATE_URL = '/api/state';
const state = {};
let selectedPaperId = null;
let serverStorageAvailable = false;

function defaultState() {
  return {
    xp: 0,
    streak: 0,
    xpLog: [],
    chatHistory: [],
    translationHistory: [],
    notes: [],
    papers: []
  };
}

function normalizeState(raw = {}) {
  const base = { ...defaultState(), ...raw };
  base.xp ??= 0;
  base.streak ??= 0;
  base.xpLog ??= [];
  base.chatHistory ??= [];
  base.translationHistory ??= [];
  base.notes ??= [];
  base.papers = Array.isArray(base.papers) ? base.papers.map(migratePaper) : [];
  return base;
}
let searchCache = [];
let selectedTag = '__ALL__';
let tagPage = 1;
let tagPageSize = 5;
let popupTimer = null;
let candidatePage = 1;
let candidateQuery = '';
let duplicateTargetId = null;
const CANDIDATES_PER_PAGE = 9;
const LOCAL_GPT_URL = 'http://localhost:8787/api/chat';
const TRANSLATE_URL = '/api/translate';

const QUESTS = [
  ['abstractRead', '초록 읽기', 10, 'actions'],
  ['contribution', 'Contribution 확인하기', 15, 'quests'],
  ['summary', '논문 내용 요약하기', 20, 'quests'],
  ['connection', '내 연구와 관련점 적기', 20, 'quests']
];

const $ = (id) => document.getElementById(id);

function migratePaper(p) {
  return {
    ...p,
    id: p.id || crypto.randomUUID(),
    time: Number(p.time || 40),
    actions: p.actions || {},
    quests: p.quests || {},
    notes: normalizePaperNotes(p.notes || []),
    tags: Array.isArray(p.tags) ? p.tags : inferTags(p.topic),
  };
}


function normalizePaperNotes(notes = []) {
  return (Array.isArray(notes) ? notes : []).map(n => {
    if (typeof n === 'string') return { id: crypto.randomUUID(), text: n, createdAt: new Date().toISOString() };
    return { id: n.id || crypto.randomUUID(), text: n.text || n.note || '', createdAt: n.createdAt || new Date().toISOString() };
  }).filter(n => n.text);
}

function inferTags(topic = '') {
  return String(topic).split(/[\/,;|]+/).map(t => t.trim()).filter(Boolean).slice(0, 3);
}

function save(options = {}) {
  if (serverStorageAvailable) {
    fetch(SERVER_STATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    }).catch(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      toast('서버 저장 실패: 브라우저 임시 저장소에 저장했습니다.');
    });
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  if (!options.skipRender) render();
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

function showXpPopup(delta, reason) {
  if (delta === 0) return;
  const el = $('xpPopup');
  const sign = delta >= 0 ? '+' : '';
  el.innerHTML = `${sign}${delta} XP<small>${escapeHtml(reason)} · 현재 ${state.xp} XP</small>`;
  el.classList.add('show');
  clearTimeout(popupTimer);
  popupTimer = setTimeout(() => el.classList.remove('show'), 1000);
}

function changeXP(amount, reason, paperTitle = '') {
  const before = state.xp;
  state.xp = Math.max(0, state.xp + amount);
  const actualDelta = state.xp - before;
  if (actualDelta !== 0) {
    state.streak = Math.max(1, state.streak);
    state.xpLog.unshift({ delta: actualDelta, reason, paperTitle, total: state.xp, createdAt: new Date().toISOString() });
    state.xpLog = state.xpLog.slice(0, 80);
    showXpPopup(actualDelta, reason);
  }
  save();
}

function pulseButton(btn) {
  if (!btn) return;
  btn.classList.add('clicked');
  setTimeout(() => btn.classList.remove('clicked'), 140);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button, .file-btn');
  if (btn) pulseButton(btn);
});

function estimateReadTime(paper) {
  const abstractLength = paper.abstract ? paper.abstract.length : 0;
  const citationWeight = Math.min(30, Math.floor((paper.citedBy || 0) / 60));

  // OpenAlex에는 보통 페이지 수가 없어서 초록 길이로 대략 페이지 수 추정
  const estimatedPages = Math.max(4, Math.min(20, Math.ceil(abstractLength / 700) + 6));

  // 정독 기준: 페이지당 30분
  const deepReadTime = estimatedPages * 30;

  // 초록이 길거나 인용이 많으면 조금 더 보정
  return Math.max(60, Math.min(600, deepReadTime + citationWeight));
}

function formatTime(minutes) {
  minutes = Math.round(Number(minutes) || 0);

  const h = Math.floor(minutes / 60);
  const m = minutes % 60;

  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

function relevanceScore(paper) {
  const citationBonus = Math.min(15, Math.floor((paper.citedBy || 0) / 100));
  const recentBonus = paper.year ? Math.max(0, Math.min(10, paper.year - 2016)) : 0;
  const topicLength = String(paper.topic || '').length;
  const base = Math.min(92, 52 + topicLength * 1.5 + Math.max(0, 45 - paper.time));
  return Math.round(Math.max(45, Math.min(98, base + citationBonus + recentBonus)));
}

function renderStats() {
  $('xp').textContent = state.xp;
  $('streak').textContent = state.streak;
  $('addedCount').textContent = state.papers.length;
}

function candidateMatches(p, q) {
  if (!q) return true;
  const haystack = [
    p.title,
    p.topic,
    p.year,
    p.venue,
    ...(p.authors || []),
    ...(p.tags || []),
    p.abstract
  ].join(' ').toLowerCase();
  return haystack.includes(q.toLowerCase());
}

function renderPapers() {
  const filtered = state.papers.filter(p => candidateMatches(p, candidateQuery));
  const totalPages = Math.max(1, Math.ceil(filtered.length / CANDIDATES_PER_PAGE));
  candidatePage = Math.min(Math.max(1, candidatePage), totalPages);
  const start = (candidatePage - 1) * CANDIDATES_PER_PAGE;
  const visible = filtered.slice(start, start + CANDIDATES_PER_PAGE);

  $('candidateSummary').textContent = `총 ${state.papers.length}개 후보 · 현재 ${filtered.length}개 표시 대상`;
  $('candidatePageLabel').textContent = `${candidatePage} / ${totalPages}`;
  $('prevCandidatePage').disabled = candidatePage <= 1;
  $('nextCandidatePage').disabled = candidatePage >= totalPages;

  $('paperList').innerHTML = visible.map(p => {
    const selected = p.id === selectedPaperId ? ' selected' : '';
    return `
    <article class="paper-card${selected}" role="button" tabindex="0" onclick="selectPaper('${p.id}')" onkeydown="handlePaperCardKey(event, '${p.id}')" aria-label="${escapeAttr(p.title)} 선택">
      <h3>${escapeHtml(p.title)}</h3>
      <div class="meta">
        ${escapeHtml(p.topic || '주제 미지정')} · 예상 ${formatTime(p.time)} · 관련도 ${relevanceScore(p)}%${p.year ? ` · ${p.year}` : ''}${p.citedBy ? ` · ${p.citedBy.toLocaleString()} citations` : ''}
      </div>
      ${p.abstract ? `<div class="abstract">${escapeHtml(p.abstract)}</div>` : ''}
      <div class="badges">
        ${(p.tags || []).map(t => `<span class="tag-pill">#${escapeHtml(t)}</span>`).join('') || '<span class="badge">태그 없음</span>'}
      </div>
      <div class="actions">
        <button class="warn" onclick="event.stopPropagation(); dropPaper('${p.id}')">Drop Paper</button>
        ${p.url ? `<a href="${escapeAttr(p.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">논문 열기</a>` : ''}
      </div>
    </article>`;
  }).join('') || '<p class="muted">조건에 맞는 논문 후보가 없습니다. 위에서 검색해 추가하거나 내부 검색어를 지우세요.</p>';
}

function renderQuest() {
  const p = state.papers.find(x => x.id === selectedPaperId);
  if (!p) {
    $('questBox').className = 'quest-box empty';
    $('questBox').textContent = '논문을 선택하면 상세보기와 퀘스트가 나타납니다.';
    $('selectedPaperLabel').textContent = '논문을 먼저 선택하세요.';
    if ($('chatPaperLabel')) $('chatPaperLabel').textContent = '논문을 먼저 선택하세요.';
    return;
  }
  $('selectedPaperLabel').textContent = `현재 노트 대상: ${p.title}`;
  if ($('chatPaperLabel')) $('chatPaperLabel').textContent = `현재 GPT 질문 대상: ${p.title}`;
  $('questBox').className = 'quest-box';
  $('questBox').innerHTML = `
    <div class="paper-detail">
      <strong>${escapeHtml(p.title)}</strong>
      <div class="meta">${escapeHtml(p.topic || '주제 미지정')} · 예상 ${formatTime(p.time)}${p.year ? ` · ${p.year}` : ''}${p.doi ? ` · ${escapeHtml(p.doi)}` : ''}</div>
      <div class="tag-editor">
        <input
          id="tagInput"
          value="${escapeAttr((p.tags || []).join(', '))}"
          placeholder="예: 관련연구, 실험설계, HCI"
          onkeydown="if(event.key === 'Enter'){ event.preventDefault(); saveTags('${p.id}'); }"
        />
        <button type="button" onclick="saveTags('${p.id}')">태그 저장</button>
      </div>
      <div class="badges">${(p.tags || []).map(t => `<span class="tag-pill">#${escapeHtml(t)}</span>`).join('')}</div>
    </div>
    ${QUESTS.map(([key, label, xp, bucket]) => {
      const checked = Boolean(p[bucket]?.[key]);
      return `<label class="quest ${checked ? 'checked' : ''}">
        <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleQuest('${p.id}', '${key}', ${xp}, '${bucket}', this.checked)" />
        <span>${label} <b>${checked ? '완료됨' : `+${xp} XP`}</b></span>
      </label>`;
    }).join('')}
  `;
}

function renderNotes() {
  const p = state.papers.find(x => x.id === selectedPaperId);
  if (!p) {
    $('notes').innerHTML = '';
    return;
  }
  $('notes').innerHTML = (p.notes || []).map(n => `
    <div class="note note-row">
      <div class="note-text">${escapeHtml(n.text || n)}</div>
      <button type="button" class="secondary small-btn" onclick="deleteNote('${p.id}', '${n.id || ''}')">삭제</button>
    </div>
  `).join('') || '<p class="muted small">아직 이 논문에 저장된 노트가 없습니다.</p>';
}

function deleteNote(paperId, noteId) {
  const p = state.papers.find(x => x.id === paperId);
  if (!p) return;
  if (noteId) p.notes = (p.notes || []).filter(n => n.id !== noteId);
  else p.notes = (p.notes || []).slice(1);
  state.notes = (state.notes || []).filter(n => !(n.paperId === paperId && n.id === noteId));
  save();
  toast('연구노트를 삭제했습니다.');
}

function renderChatHistory() {
  const p = state.papers.find(x => x.id === selectedPaperId);
  const rows = (state.chatHistory || []).filter(h => !p || h.paperId === p.id).slice(0, 8);
  if (!$('chatHistory')) return;
  $('chatHistory').innerHTML = rows.map(h => `<div class="note"><strong>${h.mode === 'local-gpt' ? 'GPT 답변' : '질문 기록'}</strong> · ${new Date(h.createdAt).toLocaleString()}\n\nQ. ${escapeHtml(h.question)}${h.answer ? `\n\nA. ${escapeHtml(h.answer)}` : ''}</div>`).join('') || '<p class="muted small">아직 이 논문으로 만든 GPT 질문이 없습니다.</p>';
}

function renderXpLog() {
  $('xpLog').innerHTML = (state.xpLog || []).slice(0, 30).map(item => `
    <div class="xp-row">
      <strong>${item.delta > 0 ? '+' : ''}${item.delta} XP</strong>
      <span>${item.paperTitle ? `<b>${escapeHtml(item.paperTitle)}</b><br>` : ''}${escapeHtml(item.reason)}</span>
      <em>총 ${item.total} XP · ${new Date(item.createdAt).toLocaleString()}</em>
    </div>
  `).join('') || '<p class="muted small">아직 XP 기록이 없습니다.</p>';
}

function tagMap() {
  const map = new Map();
  state.papers.forEach(p => (p.tags || []).forEach(tag => {
    if (!map.has(tag)) map.set(tag, []);
    map.get(tag).push(p);
  }));
  return map;
}

function renderTags() {
  const map = tagMap();
  const tags = [...map.keys()].sort((a, b) => map.get(b).length - map.get(a).length || a.localeCompare(b));
  const allCount = state.papers.length;
  const buttonTags = ['__ALL__', ...tags];
  $('tagCloud').innerHTML = buttonTags.map(tag => {
    const label = tag === '__ALL__' ? '#All' : `#${escapeHtml(tag)} (${map.get(tag).length})`;
    const count = tag === '__ALL__' ? ` (${allCount})` : '';
    return `<button type="button" class="${selectedTag === tag ? 'active' : ''}" onclick="selectTag('${escapeAttr(tag)}')">${label}${count}</button>`;
  }).join('') || '<p class="muted">태그가 없습니다. 논문 상세보기에서 태그를 저장하세요.</p>';

  const visibleTags = selectedTag && selectedTag !== '__ALL__' && map.has(selectedTag) ? [selectedTag] : tags;
  const totalPages = Math.max(1, Math.ceil(visibleTags.length / tagPageSize));
  tagPage = Math.min(Math.max(1, tagPage), totalPages);
  const start = (tagPage - 1) * tagPageSize;
  const pagedTags = visibleTags.slice(start, start + tagPageSize);
  $('tagPageLabel').textContent = `${tagPage} / ${totalPages}`;
  $('prevTagPage').disabled = tagPage <= 1;
  $('nextTagPage').disabled = tagPage >= totalPages;

  $('tagGroups').innerHTML = pagedTags.map(tag => `
    <div class="tag-group">
      <h3>#${escapeHtml(tag)}</h3>
      <ul>${map.get(tag).map(p => `<li><button type="button" class="link-button" onclick="openPaperFromTag('${p.id}')">${escapeHtml(p.title)}</button></li>`).join('')}</ul>
    </div>
  `).join('') || '<p class="muted small">표시할 태그가 없습니다.</p>';
}

function openPaperFromTag(id) {
  selectedPaperId = id;
  const index = state.papers.findIndex(p => p.id === id);
  if (index >= 0) candidatePage = Math.floor(index / CANDIDATES_PER_PAGE) + 1;
  save();
  document.querySelector('#questBox')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderTranslationHistory() {
  const rows = (state.translationHistory || []).slice(0, 12);
  const el = $('translationHistory');
  if (!el) return;
  el.innerHTML = rows.map((item, idx) => `
    <button type="button" class="translation-history-item" onclick="reuseTranslation(${idx})">
      <strong>${escapeHtml(item.text)}</strong>
      <span>${escapeHtml(item.translatedText)}</span>
    </button>
  `).join('') || '<p class="muted small">최근 번역 기록이 없습니다.</p>';
}

function reuseTranslation(index) {
  const item = (state.translationHistory || [])[index];
  if (!item) return;
  $('translateInput').value = item.text;
  $('translateDirection').value = item.langpair || 'en|ko';
  $('translationResult').innerHTML = `<strong>${escapeHtml(item.text)}</strong><br>${escapeHtml(item.translatedText)}`;
}

async function translateWord() {
  const input = $('translateInput');
  const direction = $('translateDirection');
  const status = $('translationStatus');
  const result = $('translationResult');
  const text = input?.value.trim();
  const langpair = direction?.value || 'en|ko';
  if (!text) return toast('번역할 단어를 입력하세요.');
  status.textContent = '번역 중...';
  result.textContent = '';
  try {
    const res = await fetch(TRANSLATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, langpair })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `번역 실패: ${res.status}`);
    const translatedText = data.translatedText || '';
    result.innerHTML = `<strong>${escapeHtml(text)}</strong><br>${escapeHtml(translatedText)}<div class="muted small">${langpair === 'en|ko' ? '영어 → 한국어' : '한국어 → 영어'} · ${escapeHtml(data.source || 'translator')}</div>`;
    state.translationHistory = (state.translationHistory || []).filter(item => !(item.text === text && item.langpair === langpair));
    state.translationHistory.unshift({ text, translatedText, langpair, createdAt: new Date().toISOString() });
    state.translationHistory = state.translationHistory.slice(0, 50);
    status.textContent = '번역 완료';
    save();
  } catch (err) {
    status.textContent = '번역 실패';
    result.textContent = err.message || '번역에 실패했습니다. 인터넷 연결을 확인하세요.';
  }
}

function render() {
  renderStats();
  renderPapers();
  renderQuest();
  renderNotes();
  renderChatHistory();
  renderTags();
  renderXpLog();
  renderTranslationHistory();
}

async function searchPapers(query, yearFilter, limit) {
  const params = new URLSearchParams({ search: query, 'per-page': String(limit), sort: 'relevance_score:desc' });
  if (yearFilter) {
    const [from, to] = yearFilter.split('-');
    params.set('filter', `from_publication_date:${from}-01-01,to_publication_date:${to}-12-31`);
  }
  const url = `/api/search?query=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`검색 실패: ${res.status}`);
  const data = await res.json();
  return (data.results || []).map(normalizeOpenAlexWork).filter(Boolean);
}

function normalizeOpenAlexWork(work) {
  const title = work.title || work.display_name;
  if (!title) return null;
  const authors = (work.authorships || []).slice(0, 12).map(a => a.author?.display_name).filter(Boolean);
  const concepts = (work.concepts || work.topics || []).slice(0, 3).map(c => c.display_name).filter(Boolean);
  const abstract = abstractFromInvertedIndex(work.abstract_inverted_index);
  const url = work.open_access?.oa_url || work.primary_location?.landing_page_url || work.doi || work.id;
  const paper = migratePaper({
    id: crypto.randomUUID(),
    title,
    topic: concepts.join(' / ') || $('searchInput').value.trim(),
    tags: concepts.length ? concepts.slice(0, 3) : inferTags($('searchInput').value.trim()),
    year: work.publication_year,
    authors,
    venue: work.primary_location?.source?.display_name || work.host_venue?.display_name || '',
    citedBy: work.cited_by_count || 0,
    doi: work.doi || '',
    openalexId: work.id || '',
    url,
    abstract,
    time: 40,
    status: 'new',
    source: 'openalex'
  });
  paper.time = estimateReadTime(paper);
  return paper;
}

function abstractFromInvertedIndex(index) {
  if (!index) return '';
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(' ');
}

function renderSearchResults(results) {
  searchCache = results;
  $('searchResults').innerHTML = results.map((p, i) => `
    <article class="result-card compact">
      <div>
        <h3>${escapeHtml(p.title)}</h3>
        <div class="meta">
          ${p.authors.length ? escapeHtml(p.authors.slice(0, 3).join(', ')) + (p.authors.length > 3 ? ' et al. · ' : ' · ') : ''}${p.year || '연도 미상'}${p.venue ? ' · ' + escapeHtml(p.venue) : ''} · ${p.citedBy.toLocaleString()} citations · 예상 ${formatTime(p.time)}
        </div>
      </div>
      <div class="actions">
        <button onclick="addSearchResult(${i})">후보에 추가</button>
        ${p.url ? `<a href="${escapeAttr(p.url)}" target="_blank" rel="noopener">열기</a>` : ''}
      </div>
    </article>
  `).join('') || '<p class="muted">검색 결과가 없습니다. 키워드를 바꿔보세요.</p>';
}

function clearSearchResults(message = '') {
  searchCache = [];
  $('searchResults').innerHTML = '';
  $('searchStatus').textContent = message;
}

function normalizedTitle(title = '') {
  return String(title).toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim();
}

function findDuplicatePaper(paper) {
  const doi = String(paper.doi || '').toLowerCase().replace(/^https?:\/\/doi.org\//, '');
  const openalexId = String(paper.openalexId || '').toLowerCase();
  const title = normalizedTitle(paper.title);
  return state.papers.find(p => {
    const existingDoi = String(p.doi || '').toLowerCase().replace(/^https?:\/\/doi.org\//, '');
    const existingOpenalexId = String(p.openalexId || '').toLowerCase();
    if (doi && existingDoi && doi === existingDoi) return true;
    if (openalexId && existingOpenalexId && openalexId === existingOpenalexId) return true;
    return title && normalizedTitle(p.title) === title;
  });
}

function openDuplicateModal(existingPaper) {
  duplicateTargetId = existingPaper.id;
  $('duplicateMessage').textContent = `“${existingPaper.title}”는 이미 오늘의 논문 후보에 들어 있습니다.`;
  $('duplicateModal').classList.add('show');
  $('duplicateModal').setAttribute('aria-hidden', 'false');
}

function closeDuplicateModal() {
  duplicateTargetId = null;
  $('duplicateModal').classList.remove('show');
  $('duplicateModal').setAttribute('aria-hidden', 'true');
}

function viewDuplicatePaper() {
  if (!duplicateTargetId) return closeDuplicateModal();
  selectedPaperId = duplicateTargetId;
  const index = state.papers.findIndex(p => p.id === duplicateTargetId);
  if (index >= 0) candidatePage = Math.floor(index / CANDIDATES_PER_PAGE) + 1;
  closeDuplicateModal();
  save();
  document.querySelector('#questBox')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function addSearchResult(index) {
  const source = searchCache[index];
  if (!source) return;
  const existing = findDuplicatePaper(source);
  if (existing) {
    openDuplicateModal(existing);
    return;
  }
  const paper = migratePaper({ ...source, id: crypto.randomUUID() });
  state.papers.unshift(paper);
  selectedPaperId = paper.id;
  candidatePage = 1;
  changeXP(5, '실제 논문 후보 추가', paper.title);
  toast(`후보에 추가했습니다. 현재 후보 ${state.papers.length}개입니다.`);
}

function selectPaper(id) {
  selectedPaperId = id;
  save();
}

function handlePaperCardKey(event, id) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    selectPaper(id);
  }
}

function dropPaper(id) {
  const p = state.papers.find(x => x.id === id);
  if (!p) return;

  const ok = confirm(`이 논문을 후보에서 삭제할까요?\n\n${p.title}`);
  if (!ok) return;

  state.papers = state.papers.filter(x => x.id !== id);
  if (selectedPaperId === id) selectedPaperId = state.papers[0]?.id || null;
  save();
  toast('논문을 삭제했습니다.');
}

function toggleQuest(id, key, xp, bucket, checked) {
  const p = state.papers.find(x => x.id === id);
  if (!p) return;
  if (!p[bucket]) p[bucket] = {};
  if (Boolean(p[bucket][key]) === checked) return;
  p[bucket][key] = checked;
  changeXP(checked ? xp : -xp, checked ? `${labelForQuest(key)} 완료` : `${labelForQuest(key)} 취소`, p.title);
}

function labelForQuest(key) {
  const q = QUESTS.find(([k]) => k === key);
  return q ? q[1] : '퀘스트';
}

function saveTags(id) {
  const p = state.papers.find(x => x.id === id);
  if (!p) return;
  p.tags = $('tagInput').value.split(',').map(t => t.trim()).filter(Boolean);
  p.topic = p.tags.join(' / ') || p.topic;
  save();
  toast('태그를 저장했습니다.');
}

function selectTag(tag) {
  selectedTag = tag || '__ALL__';
  tagPage = 1;
  renderTags();
}

function papersForBibExport() {
  if (!selectedTag || selectedTag === '__ALL__') return state.papers;
  return state.papers.filter(p => (p.tags || []).includes(selectedTag));
}

function citationKey(p, idx) {
  const firstAuthor = (p.authors?.[0] || 'paper').split(/\s+/).slice(-1)[0].replace(/[^a-zA-Z0-9]/g, '') || 'paper';
  const firstWord = (p.title || 'work').split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, '') || 'work';
  return `${firstAuthor}${p.year || 'n.d.'}${firstWord}${idx}`.replace(/[^a-zA-Z0-9]/g, '');
}

function bibEscape(str='') {
  return String(str).replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

function toBibTeX(p, idx) {
  const fields = [];
  fields.push(`  title = {${bibEscape(p.title)}}`);
  if (p.authors?.length) fields.push(`  author = {${p.authors.map(bibEscape).join(' and ')}}`);
  if (p.year) fields.push(`  year = {${p.year}}`);
  if (p.venue) fields.push(`  journal = {${bibEscape(p.venue)}}`);
  if (p.doi) fields.push(`  doi = {${String(p.doi).replace(/^https?:\/\/doi.org\//, '')}}`);
  if (p.url) fields.push(`  url = {${p.url}}`);
  return `@article{${citationKey(p, idx)},\n${fields.join(',\n')}\n}`;
}

function exportBibTeX() {
  const papers = papersForBibExport();
  if (!papers.length) return toast('내보낼 논문이 없습니다.');
  const bib = papers.map(toBibTeX).join('\n\n');
  const tagPart = selectedTag ? selectedTag.replace(/[^a-zA-Z0-9가-힣_-]/g, '_') : 'all';
  const blob = new Blob([bib], { type: 'application/x-bibtex;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `paperquest-${tagPart}-${new Date().toISOString().slice(0,10)}.bib`;
  a.click();
  URL.revokeObjectURL(url);
  toast(selectedTag ? `#${selectedTag} 태그 논문 BibTeX를 저장했습니다.` : '전체 논문 BibTeX를 저장했습니다.');
}

function buildChatPrompt() {
  const p = state.papers.find(x => x.id === selectedPaperId);
  const question = $('chatInput').value.trim();
  if (!p) throw new Error('논문을 먼저 선택하세요.');
  if (!question) throw new Error('질문을 입력하세요.');
  return `다음 논문을 읽고 있습니다. 논문 정보를 바탕으로 질문에 답해주세요.\n\n[논문 제목]\n${p.title}\n\n[저자]\n${(p.authors || []).join(', ') || '정보 없음'}\n\n[연도/venue]\n${p.year || '연도 정보 없음'}${p.venue ? ' / ' + p.venue : ''}\n\n[태그]\n${(p.tags || []).map(t => '#' + t).join(' ') || '태그 없음'}\n\n[초록]\n${p.abstract || '초록 정보 없음'}\n\n[내 질문]\n${question}`;
}

async function copyChatPrompt() {
  try {
    const prompt = buildChatPrompt();
    await navigator.clipboard.writeText(prompt);
    const p = state.papers.find(x => x.id === selectedPaperId);
    state.chatHistory.unshift({ paperId: p.id, title: p.title, question: $('chatInput').value.trim(), answer: '', mode: 'copied', createdAt: new Date().toISOString() });
    state.chatHistory = state.chatHistory.slice(0, 80);
    save();
    toast('프롬프트를 복사했습니다. ChatGPT에 붙여넣으면 됩니다.');
  } catch (err) {
    toast(err.message || '프롬프트 복사에 실패했습니다.');
  }
}

async function askLocalGpt() {
  const btn = $('askLocalGptBtn');
  try {
    const prompt = buildChatPrompt();
    const p = state.papers.find(x => x.id === selectedPaperId);
    btn.disabled = true;
    btn.textContent = 'GPT 답변 생성 중...';
    $('gptStatus').textContent = '로컬 GPT 서버에 질문을 보내는 중입니다.';
    const res = await fetch(LOCAL_GPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `GPT 서버 오류: ${res.status}`);
    state.chatHistory.unshift({ paperId: p.id, title: p.title, question: $('chatInput').value.trim(), answer: data.answer || '', mode: 'local-gpt', createdAt: new Date().toISOString() });
    state.chatHistory = state.chatHistory.slice(0, 80);
    $('gptStatus').textContent = '로컬 GPT 서버 연결됨';
    save();
  } catch (err) {
    $('gptStatus').textContent = '로컬 GPT 서버에 연결할 수 없습니다. server.mjs 실행 여부와 API 키를 확인하세요.';
    toast(err.message || 'GPT 질문에 실패했습니다.');
  } finally {
    btn.disabled = false;
    btn.textContent = '사이트에서 GPT에게 질문';
  }
}

async function checkLocalGpt() {
  try {
    const res = await fetch('http://localhost:8787/health');
    if ($('gptStatus')) $('gptStatus').textContent = res.ok ? '로컬 GPT 서버 연결됨' : '로컬 GPT 서버 응답 오류';
  } catch {
    if ($('gptStatus')) $('gptStatus').textContent = '로컬 GPT 서버 꺼짐: 프롬프트 복사 방식을 사용할 수 있습니다.';
  }
}

$('searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = $('searchInput').value.trim();
  const yearFilter = $('yearFilter').value;
  const limit = Number($('resultLimit').value || 3);
  if (!query) return;
  $('searchStatus').textContent = '검색 중...';
  $('searchResults').innerHTML = '';
  try {
    const results = await searchPapers(query, yearFilter, limit);
    $('searchStatus').textContent = `${results.length}개 결과를 찾았습니다.`;
    renderSearchResults(results);
  } catch (err) {
    $('searchStatus').textContent = '검색에 실패했습니다. 인터넷 연결 또는 브라우저 보안 설정을 확인하세요.';
    toast(err.message);
  }
});

$('clearSearchBtn').addEventListener('click', () => clearSearchResults('검색 결과를 접었습니다.'));
$('saveNoteBtn').addEventListener('click', () => {
  const p = state.papers.find(x => x.id === selectedPaperId);
  if (!p) return toast('논문을 먼저 선택하세요.');
  const note = $('noteInput').value.trim();
  if (!note) return toast('노트를 먼저 입력하세요.');
  const noteObj = { id: crypto.randomUUID(), text: `${new Date().toLocaleDateString()}\n${note}`, createdAt: new Date().toISOString() };
  p.notes.unshift(noteObj);
  state.notes.unshift({ id: noteObj.id, paperId: p.id, title: p.title, note, createdAt: noteObj.createdAt });
  $('noteInput').value = '';
  save();
  toast('연구노트를 저장했습니다.');
});

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `paperquest-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$('importInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported.papers)) throw new Error('Invalid backup');
    imported.papers = imported.papers.map(migratePaper);
    imported.notes ??= [];
    imported.xpLog ??= [];
    imported.chatHistory ??= [];
    imported.translationHistory ??= [];
    imported.addedCount ??= imported.papers.length;
    Object.assign(state, imported);
    selectedPaperId = state.papers[0]?.id;
    save();
    toast('백업을 불러왔습니다.');
  } catch {
    toast('백업 파일을 읽을 수 없습니다.');
  } finally {
    e.target.value = '';
  }
});

$('exportBibBtn').addEventListener('click', exportBibTeX);
$('translateBtn')?.addEventListener('click', translateWord);
$('translateInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') translateWord(); });
// GPT 읽기 도우미는 현재 주석 처리했습니다.
// $('askLocalGptBtn')?.addEventListener('click', askLocalGpt);
// $('copyChatPromptBtn')?.addEventListener('click', copyChatPrompt);
// $('openChatGPTBtn')?.addEventListener('click', () => window.open('https://chatgpt.com/', '_blank', 'noopener'));
$('candidateSearch').addEventListener('input', (e) => {
  candidateQuery = e.target.value.trim();
  candidatePage = 1;
  renderPapers();
});
$('prevCandidatePage').addEventListener('click', () => { candidatePage -= 1; renderPapers(); });
$('nextCandidatePage').addEventListener('click', () => { candidatePage += 1; renderPapers(); });
$('tagPageSize')?.addEventListener('change', (e) => { tagPageSize = Number(e.target.value || 5); tagPage = 1; renderTags(); });
$('prevTagPage')?.addEventListener('click', () => { tagPage -= 1; renderTags(); });
$('nextTagPage')?.addEventListener('click', () => { tagPage += 1; renderTags(); });
$('closeDuplicateModal').addEventListener('click', closeDuplicateModal);
$('dismissDuplicateBtn').addEventListener('click', closeDuplicateModal);
$('viewDuplicatePaperBtn').addEventListener('click', viewDuplicatePaper);
$('duplicateModal').addEventListener('click', (e) => { if (e.target.id === 'duplicateModal') closeDuplicateModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDuplicateModal(); });

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function escapeAttr(str) { return escapeHtml(str).replace(/`/g, '&#96;'); }

async function loadInitialState() {
  let loaded = null;
  try {
    const res = await fetch(SERVER_STATE_URL);
    if (res.ok) {
      loaded = await res.json();
      serverStorageAvailable = true;
    }
  } catch {
    serverStorageAvailable = false;
  }

  if (!loaded) {
    const legacy = localStorage.getItem(STORAGE_KEY)
      || localStorage.getItem('paperQuestState.v6')
      || localStorage.getItem('paperQuestState.v5')
      || localStorage.getItem('paperQuestState.v4')
      || localStorage.getItem('paperQuestState.v3')
      || localStorage.getItem('paperQuestState.v2')
      || localStorage.getItem('paperQuestState');
    loaded = legacy ? JSON.parse(legacy) : defaultState();
  }

  Object.assign(state, normalizeState(loaded));
  selectedTag = '__ALL__';
  selectedPaperId = state.papers[0]?.id || null;
  render();
  checkLocalGpt();
  if (serverStorageAvailable) save({ skipRender: true });
}

loadInitialState();
